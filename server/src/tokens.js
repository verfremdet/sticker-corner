// Sticker Corner – the same word splitting as the plugin (plugin/stickerCorner/suggest.ts → tokenize, gifWords).
// KEEP BOTH IN SYNC: the plugin compares its tokens with the ones made here.
// Tokens leave the server only as short hashes (hashTok), never as readable chat text.

const STOP = new Set(("a an the and or but so to of in on at for is are was were be been it its this that i you he she we they me my your our " +
    "im i'm u ur do does did not just like what who how why when where with from as if then than too very can could would should " +
    "der die das und oder aber zu von im in am an auf ist sind war ich du er sie es wir ihr mich dich mir dir mein dein ein eine einen " +
    "nicht auch noch schon mal ja so wie was wer wo wann warum mit für bei den dem des").split(" "));

const MOODS = {
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
const MOOD_OF = new Map();
for (const [mood, words] of Object.entries(MOODS)) for (const w of words) MOOD_OF.set(w, [...(MOOD_OF.get(w) ?? []), mood]);

const EMOJI_RE = /\p{Extended_Pictographic}(?:️|‍\p{Extended_Pictographic})*/gu;

function stem(w) {
    if (w.length > 5 && w.endsWith("ing")) return w.slice(0, -3);
    if (w.length > 4 && w.endsWith("ed")) return w.slice(0, -2);
    if (w.length > 4 && w.endsWith("es")) return w.slice(0, -2);
    if (w.length > 3 && w.endsWith("s") && !w.endsWith("ss")) return w.slice(0, -1);
    return w;
}

function normalizeLaugh(w) {
    if (/^(?:ha){2,}h?$|^(?:he){2,}$|^l+o+l+$|^x+d+$|^lmf?a+o+$|^ja{2,}$|^a?ha+$/.test(w)) return "lol";
    return w.replace(/(.)\1{2,}/g, "$1$1");
}

export function tokenize(text, weight = 1, out = {}) {
    const add = (tok, w) => { out[tok] = (out[tok] ?? 0) + w * weight; };
    const lower = text.toLowerCase();
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

export function gifWords(url) {
    try {
        const u = new URL(url);
        return decodeURIComponent(u.pathname).replace(/\.(gif|mp4|webm|png|jpe?g)$/i, "").split(/[/_\-.]+/)
            .filter(p => /^[a-zäöü]{2,}$/i.test(p) && !["view", "gif", "gifs", "media", "tenor", "giphy", "attachments", "external"].includes(p.toLowerCase()))
            .join(" ");
    } catch { return ""; }
}

/** FNV-1a 32 bit over UTF-16 units, base36 – identical in the plugin */
export function hashTok(s) {
    let h = 0x811c9dc5;
    for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
    return h.toString(36);
}
