// Sticker Corner – copies popular lobby GIFs into the sticker channel ("stealing").
// Runs by itself inside the service (index.js): shortly after the start and then every few hours.
// Takes the GIFs the brain saw in the lobbies, skips the ones that look exactly like a sticker
// that is already there (fingerprint.js), and posts the rest silently as the bot.
// The service picks them up like any other post (files named "lobby__…").
import { Routes } from "discord.js";
import { fingerprint } from "./fingerprint.js";
import { gifWords } from "./tokens.js";

const MAX_BYTES = 10 * 1024 * 1024;
const DISCORD_FILE_RE = /^https:\/\/(?:cdn|media)\.discordapp\.(?:com|net)\/attachments\//;
/** at most this many new stickers per run – the rest comes next time */
const PER_RUN = 25;

const EXT_BY_TYPE = { "image/gif": "gif", "image/png": "png", "image/webp": "webp", "image/jpeg": "jpg" };

/** Name from the link: tenor.com/view/cat-laugh-gif-123 → "cat laugh" */
export function nameOf(it) {
    try {
        const n = new URL(it.url).searchParams.get("name");
        if (n) return n.slice(0, 40);
    } catch { /* plain words below */ }
    const words = [...new Set((it.name ? it.name.replace(/\.[^.]+$/, "") : gifWords(it.url)).split(/[\s_-]+/)
        .filter(w => /^[a-zäöü]{2,}$/i.test(w) && !/^(gif|gifs|tiktok|on|the|cecesgif|klipy|tenor|giphy)$/i.test(w)))];
    return words.slice(0, 4).join(" ") || "lobby gif";
}

/** Downloads a GIF/video/image (max. 10 MB) → { buf, type, ext, isVideo } */
export async function download(url) {
    const res = await fetch(url, { signal: AbortSignal.timeout(30_000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    if (Number(res.headers.get("content-length") ?? 0) > MAX_BYTES) throw new Error("zu groß");
    const type = (res.headers.get("content-type") ?? "").split(";")[0];
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length > MAX_BYTES) throw new Error("zu groß");
    const isVideo = type.startsWith("video/");
    const ext = isVideo ? (type.includes("webm") ? "webm" : type.includes("quicktime") ? "mov" : "mp4") : EXT_BY_TYPE[type];
    if (!ext) throw new Error(`Typ ${type}`);
    return { buf, type, ext, isVideo };
}

let running = false;

/**
 * @param {{ brain: import("./brain.js").Brain, store: import("./store.js").Store, rest: import("discord.js").REST, channelId: string, min?: number }} ctx
 */
export async function stealFromLobbies({ brain, store, rest, channelId, min = 2 }) {
    if (running) return;
    running = true;
    let posted = 0, dupes = 0, failed = 0;
    try {
        const candidates = [...brain.items.entries()]
            .map(([key, it]) => ({ ...it, key, people: it.people?.size ?? it.people ?? 0 }))
            .filter(it => !brain.stolen[it.key] && !brain.failed?.has(it.key) && it.media)
            // used at least `min` times or by 2 people; Discord files always (their links expire, so only usable as a sticker)
            .filter(it => it.n >= min || it.people >= 2 || DISCORD_FILE_RE.test(it.url))
            .sort((a, b) => b.n - a.n);

        for (const it of candidates) {
            if (posted >= PER_RUN) break;
            try {
                const { buf, type, ext, isVideo } = await download(it.media);
                const twin = store.findSame(await fingerprint(buf, isVideo));
                if (twin) {
                    // already in the corner → its lobby examples now point to that sticker
                    dupes++;
                    await brain.markStolen(it.key, twin.id);
                    continue;
                }
                const name = nameOf(it);
                const file = `lobby__${name.replace(/[^\p{L}\p{N}]+/gu, "_").slice(0, 40)}.${ext}`;
                const msg = await rest.post(Routes.channelMessages(channelId), {
                    body: { content: `${name} #lobby`, flags: 4096, allowed_mentions: { parse: [] } },
                    files: [{ name: file, data: buf, contentType: type }],
                });
                const id = msg.attachments?.[0]?.id;
                if (id) await brain.markStolen(it.key, id);
                console.log(`Geklaut: ${it.n}× ${name}`);
                posted++;
                // the service must add it before the next one is compared
                for (let i = 0; i < 40 && id && !store.has(id) && !store.dupes[id]; i++) await new Promise(r => setTimeout(r, 500));
                await new Promise(r => setTimeout(r, 1500));
            } catch (e) {
                failed++;
                brain.failed ??= new Set();
                brain.failed.add(it.key); // e.g. link expired – tried again after the next restart
                console.log(`Klauen ! ${it.url}: ${e.message}`);
            }
        }
    } finally {
        running = false;
    }
    if (posted || dupes || failed) console.log(`Klauen fertig: ${posted} neu, ${dupes} schon da, ${failed} Fehler`);
}
