// Sticker Corner – shared "brain" for the suggestions ("Fits right now").
// Reads the lobby channels: whenever someone sends a GIF (or a Sticker Corner image),
// the messages right before it become an example "in this mood, this GIF was sent".
// Served to the plugin as hashed word bags only – no readable chat text leaves the server.
import { readFile, rename, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { gifWords, hashTok, tokenize } from "./tokens.js";

const GIF_LINK_RE = /^https:\/\/(?:tenor\.com|media\.tenor\.com|giphy\.com|media\d*\.giphy\.com|i\.giphy\.com|klipy\.com|media\.discordapp\.net|cdn\.discordapp\.com)\/\S+$/;
const DISCORD_FILE_RE = /^https:\/\/(?:cdn|media)\.discordapp\.(?:com|net)\/attachments\//;
const WINDOW_MS = 15 * 60_000;
const WEIGHTS = [1, 0.75, 0.55, 0.4, 0.3, 0.22];
const MAX_EXAMPLES = 4000;

/** Discord file links carry expiring parameters – the key is the link without them */
const baseUrl = url => DISCORD_FILE_RE.test(url) ? url.split("?")[0] : url;

const textOf = m => `${m.content ?? ""} ${[...(m.embeds ?? [])].map(e => gifWords(e.url ?? "")).join(" ")}`;

export class Brain {
    constructor(dataDir, store, channelIds) {
        this.store = store;
        this.channelIds = new Set(channelIds);
        this.jsonPath = path.join(dataDir, "brain.json");
        this.stolenPath = path.join(dataDir, "stolen.json");
        this.examples = [];          // { id, k, at, u, v }
        this.items = new Map();      // key → { url, src, media, video, width, height, n, people:Set, slug }
        this.stolen = {};            // key → sticker id (filled by steal.js)
        this.version = 0;
        this.sizeIndex = null;
    }

    /** stolen.json is written by steal.js – read again every minute */
    async load() {
        const raw = await readFile(this.stolenPath, "utf8").catch(() => "{}");
        if (raw !== this.stolenRaw) {
            this.stolenRaw = raw;
            try { this.stolen = JSON.parse(raw); } catch { /* half written – next round */ }
            if (this.version) this.changed();
        }
        if (!this.reloadTimer) this.reloadTimer = setInterval(() => this.load(), 60_000).unref();
    }

    /** sticker files by byte size → recognizes Sticker Corner images sent in the lobby */
    async buildSizeIndex() {
        const idx = new Map();
        for (const s of this.store.stickers.values()) {
            if (s.size) idx.set(s.size, s.id);
            if (s.sendFile) {
                const st = await stat(path.join(this.store.filesDir, s.sendFile)).catch(() => null);
                if (st) idx.set(st.size, s.id);
            }
        }
        this.sizeIndex = idx;
    }

    /** What did this message send? → { key, item } or null */
    itemOf(m) {
        const content = (m.content ?? "").trim();
        if (GIF_LINK_RE.test(content)) {
            const url = baseUrl(content);
            const e = m.embeds?.[0];
            const video = e?.video?.proxyURL ?? e?.video?.url;
            const thumb = e?.thumbnail?.proxyURL ?? e?.thumbnail?.url ?? e?.image?.proxyURL;
            return {
                key: `g:${url}`,
                item: {
                    url,
                    src: video ?? thumb ?? url,
                    media: e?.video?.url ?? e?.thumbnail?.url ?? e?.image?.url ?? content,
                    video: !!video,
                    width: e?.video?.width ?? e?.thumbnail?.width ?? 0,
                    height: e?.video?.height ?? e?.thumbnail?.height ?? 0,
                },
            };
        }
        for (const a of m.attachments?.values?.() ?? []) {
            const sticker = this.sizeIndex?.get(a.size);
            if (sticker && /^image\//.test(a.contentType ?? "")) return { key: `s:${sticker}` };
            // only animated reaction files – never photos of people
            if (/^image\/gif|^video\//.test(a.contentType ?? "")) {
                const url = baseUrl(a.url);
                return { key: `g:${url}`, item: { url, src: a.proxyURL, media: a.url, video: /^video/.test(a.contentType), width: a.width ?? 0, height: a.height ?? 0, name: a.name } };
            }
        }
        return null;
    }

    /** example from the messages before (oldest → newest list, `i` = the GIF message) */
    exampleFrom(list, i, found) {
        const m = list[i];
        const vec = {};
        const at = m.createdTimestamp;
        const own = (m.content ?? "").trim();
        if (own && !GIF_LINK_RE.test(own)) tokenize(textOf(m), 1, vec); // text sent together with the GIF
        let n = 0;
        for (let j = i - 1; j >= 0 && n < 6; j--) {
            const p = list[j];
            if (p.author?.bot) continue;
            if (at - p.createdTimestamp > WINDOW_MS && n > 0) break;
            if (this.itemOf(p)) continue; // a GIF before is no context
            const text = textOf(p);
            if (!text.trim()) continue;
            tokenize(text, WEIGHTS[n] * (p.author?.id === m.author?.id ? 0.7 : 1), vec);
            n++;
        }
        // answered directly → that message counts strongly
        const refId = m.reference?.messageId;
        if (refId) {
            const ref = list.find(p => p.id === refId);
            if (ref && !this.itemOf(ref)) tokenize(textOf(ref), 0.8, vec);
        }
        if (!Object.keys(vec).length) return null;
        const v = {};
        for (const [t, w] of Object.entries(vec)) {
            const h = hashTok(t);
            v[h] = Math.round(((v[h] ?? 0) + w) * 100) / 100;
        }
        return { id: m.id, k: found.key, at, u: hashTok(m.author.id), v };
    }

    remember(m, found) {
        if (!found.item) return;
        const it = this.items.get(found.key) ?? { ...found.item, n: 0, people: new Set() };
        it.n++;
        it.people.add(m.author.id);
        if (found.item.src) Object.assign(it, { src: found.item.src, media: found.item.media }); // newest links win
        this.items.set(found.key, it);
    }

    /** Whole history of every lobby, oldest first */
    async scan(client) {
        await this.buildSizeIndex();
        const examples = [];
        this.items.clear();
        for (const id of this.channelIds) {
            const channel = await client.channels.fetch(id).catch(() => null);
            if (!channel?.isTextBased()) { console.error(`Lobby ${id} nicht lesbar`); continue; }
            const all = [];
            let before;
            for (;;) {
                const batch = await channel.messages.fetch({ limit: 100, before });
                if (!batch.size) break;
                all.push(...batch.values());
                before = batch.last().id;
                if (batch.size < 100) break;
            }
            all.reverse();
            for (let i = 0; i < all.length; i++) {
                const m = all[i];
                if (m.author?.bot) continue;
                const found = this.itemOf(m);
                if (!found) continue;
                this.remember(m, found);
                const ex = this.exampleFrom(all, i, found);
                if (ex) examples.push(ex);
            }
        }
        examples.sort((a, b) => a.at - b.at);
        this.examples = examples.slice(-MAX_EXAMPLES);
        this.changed();
        console.log(`Lernen: ${this.examples.length} Beispiele, ${this.items.size} GIFs aus den Lobbys`);
    }

    /** live: a new message in a lobby */
    async onMessage(m) {
        if (!this.channelIds.has(m.channelId) || m.author?.bot) return;
        if (!this.sizeIndex) await this.buildSizeIndex();
        const found = this.itemOf(m);
        if (!found) return;
        const before = await m.channel.messages.fetch({ limit: 12, before: m.id }).catch(() => null);
        const list = [...(before?.values() ?? [])].reverse();
        list.push(m);
        this.remember(m, found);
        const ex = this.exampleFrom(list, list.length - 1, found);
        if (ex) {
            this.examples.push(ex);
            if (this.examples.length > MAX_EXAMPLES) this.examples.shift();
        }
        this.changed();
    }

    onDelete(id) {
        const i = this.examples.findIndex(e => e.id === id);
        if (i >= 0) { this.examples.splice(i, 1); this.changed(); }
    }

    /** new sticker in the corner → sizes change */
    stickersChanged() { this.sizeIndex = null; }

    changed() {
        this.version = Date.now();
        clearTimeout(this.saveTimer);
        this.saveTimer = setTimeout(() => this.save().catch(e => console.error("brain.json:", e.message)), 5000);
    }

    /** stolen GIF → it is a Sticker Corner sticker now */
    keyOf(k) {
        const id = this.stolen[k];
        return id && this.store.stickers.has(id) ? `s:${id}` : k;
    }

    /** for the plugin: hashed examples + the GIFs that can be sent as a link */
    list() {
        const gifs = {};
        for (const [k, it] of this.items) {
            if (this.keyOf(k) !== k) continue;              // is a sticker now
            if (DISCORD_FILE_RE.test(it.url)) continue;     // file links expire – only usable once stolen
            gifs[it.url] = { src: it.src, video: it.video, width: it.width, height: it.height };
        }
        return {
            version: this.version,
            examples: this.examples.map(({ k, at, u, v }) => ({ k: this.keyOf(k), at, u, v })),
            gifs,
        };
    }

    async save() {
        const items = [...this.items.entries()].map(([k, it]) => ({ ...it, key: k, people: it.people.size }));
        const tmp = this.jsonPath + ".tmp";
        await writeFile(tmp, JSON.stringify({ version: this.version, items }));
        await rename(tmp, this.jsonPath);
    }
}
