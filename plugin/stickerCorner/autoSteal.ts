/*
 * Sticker Corner – takes GIFs into the corner by itself ("stealing"):
 * 1. your favorite GIFs from Discord's own GIF picker → into the corner AND into your Sticker Corner favorites
 * 2. a GIF or Discord sticker you send through Discord's own picker → into the corner
 * Before anything is posted, the server checks whether a sticker that looks exactly the same (1:1) is
 * already there – then that one is used (and made a favorite), nothing is posted twice.
 * Without the right to post in the sticker channel only step "already there → favorite" happens.
 */

import * as DataStore from "@api/DataStore";
import { FluxDispatcher, RestAPI, showToast, UserStore } from "@webpack/common";

import { t } from "./i18n";
import { settings } from "./settings";
import { addFavorite, canPost, hasSticker, matchOnServer, stealToCorner, stickerChannelId } from "./store";
import { favoriteGifs, gifWords, setStolenGifs } from "./suggest";

const KEY = "StickerCorner_stolen";
/** link of the GIF (without expiring parameters) → sticker id, or "x" = cannot be taken (too big, gone) */
let stolen: Record<string, string> = {};
let loaded = false;
/** GIF links already made a favorite once – if you remove the star later, it stays removed */
const FAV_KEY = "StickerCorner_stolenFav";
let favDone = new Set<string>();

function favoriteOnce(key: string, id: string) {
    if (favDone.has(key)) return;
    favDone.add(key);
    DataStore.set(FAV_KEY, [...favDone]);
    addFavorite(id);
}

interface Job { key: string; media: string; name: string; fav: boolean; }
const queue: Job[] = [];
const queued = new Set<string>();
/** checked this session without result (server unreachable, no right to post) → try again next start */
const skipped = new Map<string, number>();
let busy = false;
let added = 0;
let timer: ReturnType<typeof setInterval> | undefined;

const DISCORD_FILE_RE = /^https:\/\/(?:cdn|media)\.discordapp\.(?:com|net)\/attachments\//;
const GIF_LINK_RE = /^https:\/\/(?:tenor\.com|media\.tenor\.com|giphy\.com|media\d*\.giphy\.com|i\.giphy\.com|klipy\.com|media\.discordapp\.net|cdn\.discordapp\.com)\/\S+$/;
const MEDIA_HOST_RE = /^https:\/\/(?:cdn\.discordapp\.com|media\.discordapp\.net|images-ext-\d+\.discordapp\.net|media\.tenor\.com|c\.tenor\.com|static\.klipy\.com|media\d*\.giphy\.com|i\.giphy\.com)\//;
const isMediaFile = (u: string) => { try { return /\.(gif|mp4|webm|webp|png|jpe?g|mov)$/i.test(new URL(u).pathname); } catch { return false; } };

/** same GIF = same link; Discord file links lose their expiring "?ex=…" part */
export const gifKey = (url: string) => DISCORD_FILE_RE.test(url) ? url.split("?")[0] : url;

function save() {
    DataStore.set(KEY, stolen);
    setStolenGifs(stolen);
}

/** Name from the link: tenor.com/view/cat-laugh-gif-123 → "cat laugh" */
function nameFrom(url: string, fallback = "gif"): string {
    let words: string[];
    if (DISCORD_FILE_RE.test(url)) {
        const base = decodeURIComponent(new URL(url).pathname.split("/").pop() ?? "").replace(/\.[^.]+$/, "");
        words = /^[0-9a-f]{12,}$/i.test(base) || /^(image|unknown|img|file|video)\s?\d*$/i.test(base) ? [] : base.split(/[\s_-]+/);
    } else {
        words = gifWords(url).split(/\s+/);
    }
    const clean = [...new Set(words.filter(w => /^[\p{L}\p{N}]{2,}$/u.test(w) && !/^(gif|gifs|tenor|giphy|klipy|the|on)$/i.test(w)))];
    return clean.slice(0, 4).join(" ").slice(0, 40) || fallback;
}

/** Discord file links expire after a day – ask Discord for a fresh one (like its own GIF picker does) */
async function freshLink(url: string): Promise<string> {
    if (!DISCORD_FILE_RE.test(url)) return url;
    const ex = /[?&]ex=([0-9a-f]+)/.exec(url)?.[1];
    if (ex && parseInt(ex, 16) * 1000 > Date.now() + 10 * 60_000) return url;
    try {
        const res: any = await RestAPI.post({ url: "/attachments/refresh-urls", body: { attachment_urls: [url] } });
        return res?.body?.refreshed_urls?.[0]?.refreshed ?? url;
    } catch {
        return url;
    }
}

function enqueue(job: Job) {
    if (!settings.store.autoSteal || !loaded || queued.has(job.key)) return;
    const done = stolen[job.key];
    if (done) {
        if (done !== "x" && job.fav && hasSticker(done)) favoriteOnce(job.key, done);
        return;
    }
    if ((skipped.get(job.key) ?? 0) >= 3) return;
    queued.add(job.key);
    queue.push(job);
    void work();
}

async function work() {
    if (busy) return;
    busy = true;
    try {
        while (queue.length) {
            const job = queue.shift()!;
            try {
                await handle(job);
            } catch (e) {
                console.warn("[StickerCorner] auto steal:", e);
                skipped.set(job.key, (skipped.get(job.key) ?? 0) + 1);
            }
            queued.delete(job.key);
            await new Promise(r => setTimeout(r, 1200)); // gentle on Discord and our server
        }
    } finally {
        busy = false;
        if (added) {
            showToast({ text: t("stolenN", { n: added }), variant: "success" });
            added = 0;
        }
    }
}

async function handle(job: Job) {
    const media = await freshLink(job.media);
    if (!MEDIA_HOST_RE.test(media)) { stolen[job.key] = "x"; return save(); }

    // 1:1 the same one already there? → take that one
    const twin = await matchOnServer(media);
    if (twin === undefined) { skipped.set(job.key, (skipped.get(job.key) ?? 0) + 1); return; }
    if (twin) {
        stolen[job.key] = twin;
        if (job.fav) favoriteOnce(job.key, twin);
        return save();
    }
    if (!canPost()) { skipped.set(job.key, 3); return; }

    const id = await stealToCorner(media, job.name);
    if (id === "big") { stolen[job.key] = "x"; return save(); }
    if (!id) { skipped.set(job.key, (skipped.get(job.key) ?? 0) + 1); return; }
    stolen[job.key] = id;
    if (job.fav) favoriteOnce(job.key, id);
    added++;
    save();
}

/** all favorites from Discord's GIF picker (new ones are picked up every minute) */
function checkFavorites() {
    for (const g of favoriteGifs()) {
        const media = isMediaFile(g.src) ? g.src : isMediaFile(g.url) ? g.url : "";
        if (!media) continue;
        enqueue({ key: gifKey(g.url), media, name: nameFrom(g.url), fav: true });
    }
}

/** I sent a GIF link or a Discord sticker (through Discord's own pickers) */
function onMessageCreate({ message, optimistic }: any) {
    if (optimistic || !message || message.author?.id !== UserStore.getCurrentUser()?.id) return;
    if (message.channel_id === stickerChannelId()) return;
    const content = String(message.content ?? "").trim();
    if (GIF_LINK_RE.test(content)) {
        const e = message.embeds?.[0];
        const candidates = [e?.video?.url, e?.image?.url, e?.thumbnail?.url, content].filter(Boolean) as string[];
        const media = candidates.find(u => MEDIA_HOST_RE.test(u) && isMediaFile(u));
        if (media) enqueue({ key: gifKey(content), media, name: nameFrom(content), fav: false });
    }
    for (const st of message.sticker_items ?? []) {
        // 1 PNG, 2 APNG, 4 GIF – 3 (Lottie) is no picture file
        if (st.format_type === 3 || !/^\d{5,25}$/.test(String(st.id))) continue;
        const ext = st.format_type === 4 ? "gif" : "png";
        enqueue({ key: `sticker:${st.id}`, media: `https://media.discordapp.net/stickers/${st.id}.${ext}?size=320`, name: String(st.name ?? "sticker").slice(0, 40), fav: false });
    }
}

const onSettings = () => setTimeout(checkFavorites, 2000);

export async function startAutoSteal() {
    stolen = await DataStore.get<Record<string, string>>(KEY) ?? {};
    favDone = new Set(await DataStore.get<string[]>(FAV_KEY) ?? []);
    loaded = true;
    setStolenGifs(stolen);
    FluxDispatcher.subscribe("MESSAGE_CREATE", onMessageCreate);
    FluxDispatcher.subscribe("MESSAGE_UPDATE", onMessageCreate); // the GIF preview (embed) often comes a moment later
    FluxDispatcher.subscribe("USER_SETTINGS_PROTO_UPDATE", onSettings);
    // first round once the sticker list is there
    setTimeout(checkFavorites, 15_000);
    timer = setInterval(checkFavorites, 60_000);
}

export function stopAutoSteal() {
    FluxDispatcher.unsubscribe("MESSAGE_CREATE", onMessageCreate);
    FluxDispatcher.unsubscribe("MESSAGE_UPDATE", onMessageCreate);
    FluxDispatcher.unsubscribe("USER_SETTINGS_PROTO_UPDATE", onSettings);
    clearInterval(timer);
    queue.length = 0;
    queued.clear();
}
