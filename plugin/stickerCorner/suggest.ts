/*
 * Sticker Corner – "Fits right now": suggests stickers AND your Discord GIFs that match the chat.
 *
 * Learns per person, only on this PC (DataStore), nothing is sent anywhere:
 *  - Every time you send a sticker or a GIF, the last messages before it are remembered as "context".
 *  - When you open the picker, the current chat is compared with all remembered contexts
 *    (TF-IDF + cosine similarity, newer memories count more) → what you used in similar moments ranks high.
 *  - Cold start / new stickers: words and moods of the chat are matched against sticker names,
 *    categories and GIF links ("tenor.com/view/cat-laugh-…" → cat, laugh).
 *  - Moods: "lol", "xd", 😂 → laugh · "sad", 😭 → sad · "no", "nein" → no · … for chat and names alike.
 *  - Feedback: a suggestion you click is learned again (stronger); suggestions you keep ignoring sink slowly.
 *  - A little exploration so new stickers get a chance.
 */

import * as DataStore from "@api/DataStore";
import { FluxDispatcher, MessageStore, UserSettingsProtoStore, UserStore } from "@webpack/common";

import { categoriesOf } from "./categories";
import type { Sticker } from "./store";

// ── tokens ──────────────────────────────────────────────────────────────
const STOP = new Set(("a an the and or but so to of in on at for is are was were be been it its this that i you he she we they me my your our " +
    "im i'm u ur do does did not just like what who how why when where with from as if then than too very can could would should " +
    "der die das und oder aber zu von im in am an auf ist sind war ich du er sie es wir ihr mich dich mir dir mein dein ein eine einen " +
    "nicht auch noch schon mal ja so wie was wer wo wann warum mit für bei den dem des").split(" "));

const MOODS: Record<string, string[]> = {
    laugh: ["lol", "lmao", "lmfao", "rofl", "xd", "haha", "hahaha", "hehe", "kek", "funny", "lustig", "witzig", "😂", "🤣", "💀", "😹", "joke", "joking", "clown", "🤡"],
    sad: ["sad", "cry", "crying", "traurig", "heul", "sorry", "😭", "😢", "🥺", "😔", "miss", "rip", "depressed", "pain"],
    love: ["love", "lieb", "liebe", "cute", "süß", "suess", "heart", "❤️", "❤", "🥰", "😍", "💕", "💖", "kiss", "babe", "baby", "kitten"],
    angry: ["angry", "mad", "wütend", "wuetend", "hate", "hass", "stfu", "shut", "😡", "🤬", "😠", "grumpy", "annoying"],
    hype: ["hype", "lets", "go", "goo", "gooo", "w", "win", "insane", "krass", "geil", "omg", "🔥", "🚀", "💯", "pog", "slay", "lock"],
    no: ["no", "nope", "nah", "nein", "stop", "never", "niemals", "dont", "don't", "❌", "🚫"],
    yes: ["yes", "yeah", "yep", "ok", "okay", "sure", "true", "facts", "real", "agreed", "genau", "stimmt", "✅", "👍", "mhm"],
    shock: ["what", "wtf", "bruh", "omg", "huh", "excuse", "shock", "scream", "screaming", "😱", "😳", "😨", "🤯", "😮", "diagnosis"],
    gay: ["gay", "twink", "homo", "🏳️‍🌈", "🌈", "slay", "queen"],
    food: ["food", "hungry", "hunger", "eat", "essen", "pizza", "burger", "beer", "bier", "snack", "🍕", "🍔", "🍺", "tomato", "potato", "strawberry"],
    sleep: ["sleep", "tired", "müde", "muede", "night", "nacht", "gn", "bed", "😴", "💤", "dreams", "dream"],
    cringe: ["cringe", "awkward", "peinlich", "embarrassed", "😬", "🫠", "ew", "eww", "blushing"],
    hello: ["hi", "hey", "hello", "hallo", "moin", "servus", "welcome", "willkommen", "👋", "yo", "sup"],
    flirt: ["mamacita", "rizz", "flirt", "hot", "sexy", "😏", "😉", "woah", "daddy", "pretty"],
};
const MOOD_OF = new Map<string, string[]>();
for (const [mood, words] of Object.entries(MOODS)) for (const w of words) MOOD_OF.set(w, [...(MOOD_OF.get(w) ?? []), mood]);

const EMOJI_RE = /\p{Extended_Pictographic}(?:️|‍\p{Extended_Pictographic})*/gu;

function stem(w: string): string {
    if (w.length > 5 && w.endsWith("ing")) return w.slice(0, -3);
    if (w.length > 4 && w.endsWith("ed")) return w.slice(0, -2);
    if (w.length > 4 && w.endsWith("es")) return w.slice(0, -2);
    if (w.length > 3 && w.endsWith("s") && !w.endsWith("ss")) return w.slice(0, -1);
    return w;
}

function normalizeLaugh(w: string): string {
    if (/^(?:ha){2,}h?$|^(?:he){2,}$|^l+o+l+$|^x+d+$|^lmf?a+o+$|^ja{2,}$|^a?ha+$/.test(w)) return "lol";
    return w.replace(/(.)\1{2,}/g, "$1$1"); // "noooo" → "noo"
}

/** text → weighted tokens (words, emojis, moods) */
export function tokenize(text: string, weight = 1, out: Record<string, number> = {}): Record<string, number> {
    const add = (tok: string, w: number) => { out[tok] = (out[tok] ?? 0) + w * weight; };
    const lower = text.toLowerCase();
    // custom emojis <:name:id> → name
    for (const m of lower.matchAll(/<a?:(\w+):\d+>/g)) { add(`w:${m[1]}`, 1); for (const mood of MOOD_OF.get(m[1]) ?? []) add(`m:${mood}`, 1); }
    const plain = lower.replace(/<a?:\w+:\d+>|<[@#][!&]?\d+>|https?:\/\/\S+/g, " ");
    for (const e of plain.match(EMOJI_RE) ?? []) {
        add(`e:${e}`, 1.2);
        for (const mood of MOOD_OF.get(e) ?? []) add(`m:${mood}`, 1.4);
    }
    for (const raw of plain.split(/[^\p{L}\p{N}']+/u)) {
        if (!raw) continue;
        const w = normalizeLaugh(raw.replace(/^'+|'+$/g, ""));
        for (const mood of MOOD_OF.get(w) ?? MOOD_OF.get(raw) ?? []) add(`m:${mood}`, 1.4);
        if (w.length < 2 || STOP.has(w)) continue;
        add(`w:${stem(w)}`, 1);
    }
    return out;
}

/** Words inside GIF links: tenor.com/view/cat-laugh-gif-123 → cat, laugh */
function gifWords(url: string): string {
    try {
        const u = new URL(url);
        return decodeURIComponent(u.pathname).replace(/\.(gif|mp4|webm|png|jpe?g)$/i, "").split(/[/_\-.]+/)
            .filter(p => /^[a-zäöü]{2,}$/i.test(p) && !["view", "gif", "gifs", "media", "tenor", "giphy", "attachments", "external"].includes(p.toLowerCase()))
            .join(" ");
    } catch { return ""; }
}

// ── memory ──────────────────────────────────────────────────────────────
export type ItemKey = string; // "s:<stickerId>" or "g:<gif url>"

export interface GifItem { url: string; src: string; video: boolean; width: number; height: number; }

interface Example { key: ItemKey; at: number; channelId: string; vec: Record<string, number>; }

const MEM_KEY = "StickerCorner_suggestMemory";
const GIF_KEY = "StickerCorner_suggestGifs";
const IGNORE_KEY = "StickerCorner_suggestIgnored";
const MAX_EXAMPLES = 600;
const HALF_LIFE = 45 * 86_400_000;

let examples: Example[] = [];
let knownGifs: Record<string, GifItem> = {};
let ignored: Record<ItemKey, number> = {};
let df: Record<string, number> = {};
let loaded = false;

function rebuildDf() {
    df = {};
    for (const e of examples) for (const t of Object.keys(e.vec)) df[t] = (df[t] ?? 0) + 1;
}

export async function loadMemory() {
    examples = await DataStore.get<Example[]>(MEM_KEY) ?? [];
    knownGifs = await DataStore.get<Record<string, GifItem>>(GIF_KEY) ?? {};
    ignored = await DataStore.get<Record<ItemKey, number>>(IGNORE_KEY) ?? {};
    rebuildDf();
    loaded = true;
}

let saveTimer: ReturnType<typeof setTimeout> | undefined;
function save() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
        DataStore.set(MEM_KEY, examples);
        DataStore.set(GIF_KEY, knownGifs);
        DataStore.set(IGNORE_KEY, ignored);
    }, 1500);
}

/** What was said before: up to 6 messages of the last 15 min, newest weighs most */
export function contextOf(channelId: string, beforeId?: string): Record<string, number> {
    const all = ((MessageStore.getMessages(channelId) as any)?._array as any[] ?? []);
    const me = UserStore.getCurrentUser()?.id;
    const now = Date.now();
    const vec: Record<string, number> = {};
    let n = 0;
    for (let i = all.length - 1; i >= 0 && n < 6; i--) {
        const m = all[i];
        if (beforeId && (m.id === beforeId || BigInt(m.id) >= BigInt(beforeId))) continue;
        if (m.author?.bot) continue;
        const ts = new Date(m.timestamp).getTime();
        if (now - ts > 15 * 60_000 && n > 0) break;
        const text = String(m.content ?? "") + " " + (m.embeds ?? []).map((e: any) => e.url ?? "").map(gifWords).join(" ");
        if (!text.trim()) continue;
        // my own words count a bit less than what the others said
        tokenize(text, [1, 0.75, 0.55, 0.4, 0.3, 0.22][n] * (m.author?.id === me ? 0.7 : 1), vec);
        n++;
    }
    return vec;
}

/** Remember: in this context I sent this */
export function learn(channelId: string, key: ItemKey, gif?: GifItem, beforeId?: string, boost = 1) {
    if (!loaded) return;
    const vec = contextOf(channelId, beforeId);
    if (!Object.keys(vec).length) return;
    if (boost !== 1) for (const k in vec) vec[k] *= boost;
    examples.push({ key, at: Date.now(), channelId, vec });
    if (examples.length > MAX_EXAMPLES) examples = examples.slice(-MAX_EXAMPLES);
    if (gif) knownGifs[gif.url] = gif;
    delete ignored[key];
    rebuildDf();
    save();
}

/** Shown but not used → sinks a little (forgets slowly again) */
export function markIgnored(keys: ItemKey[]) {
    for (const k of keys) ignored[k] = Math.min(5, (ignored[k] ?? 0) + 1);
    save();
}

// ── GIFs I send through Discord's own GIF picker ────────────────────────
const GIF_HOST_RE = /^https:\/\/(?:tenor\.com|media\.tenor\.com|giphy\.com|media\d*\.giphy\.com|i\.giphy\.com|media\.discordapp\.net|cdn\.discordapp\.com|klipy\.com)\//;

function onMessageCreate({ message, optimistic }: any) {
    if (optimistic || !message || message.author?.id !== UserStore.getCurrentUser()?.id) return;
    const content = String(message.content ?? "").trim();
    if (!GIF_HOST_RE.test(content) || /\s/.test(content)) return;
    const embed = message.embeds?.[0];
    const video = embed?.video?.url ?? embed?.video?.proxy_url;
    const thumb = embed?.thumbnail?.url ?? embed?.thumbnail?.proxy_url;
    const gif: GifItem = { url: content, src: video ?? thumb ?? content, video: !!video, width: embed?.video?.width ?? embed?.thumbnail?.width ?? 0, height: embed?.video?.height ?? embed?.thumbnail?.height ?? 0 };
    learn(message.channel_id, `g:${content}`, gif, message.id);
}

export function startSuggest() {
    loadMemory();
    FluxDispatcher.subscribe("MESSAGE_CREATE", onMessageCreate);
}
export function stopSuggest() {
    FluxDispatcher.unsubscribe("MESSAGE_CREATE", onMessageCreate);
}

// ── ranking ─────────────────────────────────────────────────────────────
function tfidf(vec: Record<string, number>): Record<string, number> {
    const N = Math.max(1, examples.length);
    const out: Record<string, number> = {};
    for (const [t, v] of Object.entries(vec)) out[t] = v * Math.log(1 + N / (1 + (df[t] ?? 0)));
    return out;
}

function cosine(a: Record<string, number>, b: Record<string, number>): number {
    let dot = 0, na = 0, nb = 0;
    for (const [t, v] of Object.entries(a)) { na += v * v; if (b[t]) dot += v * b[t]; }
    for (const v of Object.values(b)) nb += v * v;
    return na && nb ? dot / Math.sqrt(na * nb) : 0;
}

const nameVecCache = new Map<string, Record<string, number>>();
function stickerVec(s: Sticker): Record<string, number> {
    const k = s.id + "|" + s.name;
    let v = nameVecCache.get(k);
    if (!v) {
        v = tokenize(s.name);
        for (const c of categoriesOf(s)) v[`w:${c.replace(/s$/, "")}`] = (v[`w:${c}`] ?? 0) + 0.6;
        nameVecCache.set(k, v);
    }
    return v;
}

export interface Suggestion { key: ItemKey; sticker?: Sticker; gif?: GifItem; score: number; }

/**
 * Best matches for the current chat.
 * score = learned similarity (main signal) + name/mood match (cold start) + own habit + channel habit − ignored
 */
export function suggest(channelId: string, stickers: Sticker[], favoriteGifs: GifItem[], myCount: (id: string) => number, limit = 6): Suggestion[] {
    const ctx = contextOf(channelId);
    if (!Object.keys(ctx).length) return [];
    const ctxW = tfidf(ctx);
    const now = Date.now();

    const learned = new Map<ItemKey, number>();
    const inChannel = new Map<ItemKey, number>();
    for (const e of examples) {
        const sim = cosine(ctxW, tfidf(e.vec));
        if (sim <= 0.05) continue;
        const decay = Math.pow(0.5, (now - e.at) / HALF_LIFE);
        learned.set(e.key, (learned.get(e.key) ?? 0) + sim * decay);
        if (e.channelId === channelId) inChannel.set(e.key, (inChannel.get(e.key) ?? 0) + 0.15 * decay);
    }

    const scored: Suggestion[] = [];
    const scoreOf = (key: ItemKey, prior: number, habit: number) => {
        const l = learned.get(key) ?? 0;
        return 1.0 * Math.min(l, 3) + 0.9 * prior + habit + (inChannel.get(key) ?? 0) - 0.12 * (ignored[key] ?? 0);
    };

    for (const s of stickers) {
        const prior = cosine(ctx, stickerVec(s));
        const habit = 0.04 * Math.log1p(myCount(s.id));
        const key = `s:${s.id}`;
        const score = scoreOf(key, prior, habit);
        if (score > 0.12) scored.push({ key, sticker: s, score });
    }

    const gifs = new Map<string, GifItem>([...Object.values(knownGifs), ...favoriteGifs].map(g => [g.url, g]));
    for (const g of gifs.values()) {
        const prior = cosine(ctx, tokenize(gifWords(g.url)));
        const key = `g:${g.url}`;
        const score = scoreOf(key, prior, 0);
        if (score > 0.12) scored.push({ key, gif: g, score });
    }

    scored.sort((a, b) => b.score - a.score);
    const top = scored.slice(0, limit);

    // exploration: sometimes swap the last slot for a fitting-by-name sticker never used yet
    if (top.length >= 3 && Math.random() < 0.15) {
        const fresh = scored.find(s => s.sticker && !learned.has(s.key) && !top.includes(s));
        if (fresh) top[top.length - 1] = fresh;
    }
    return top;
}

/** Your favorite GIFs from Discord's GIF picker (local settings, already on this PC) */
export function favoriteGifs(): GifItem[] {
    try {
        const gifs = (UserSettingsProtoStore as any)?.frecencyWithoutFetchingLatest?.favoriteGifs?.gifs ?? {};
        return Object.entries(gifs).map(([url, g]: [string, any]) => ({
            url,
            src: g.src ?? url,
            video: g.format === 2 || /\.(mp4|webm)(\?|$)/.test(g.src ?? ""),
            width: g.width ?? 0,
            height: g.height ?? 0,
        }));
    } catch {
        return [];
    }
}
