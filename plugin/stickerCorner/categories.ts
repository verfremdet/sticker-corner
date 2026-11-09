/*
 * Sticker Corner – categories, recognized automatically from the sticker name.
 * "sleepy cat" → Cats, "shark in boxers" → Sea. A sticker can be in several categories.
 * Words are compared whole (plural "s" is ignored), English and German.
 */

import { lang } from "./i18n";
import { type Sticker, tagsOf } from "./store";

interface Category {
    id: string;
    en: string;
    de: string;
    words: string[];
}

const CATEGORIES: Category[] = [
    {
        id: "cats", en: "Cats", de: "Katzen",
        words: ["cat", "kitten", "kitty", "kat", "meow", "katze", "kätzchen", "mieze"],
    },
    {
        id: "sea", en: "Sea", de: "Meer",
        words: ["fish", "fih", "shark", "whale", "octopus", "crab", "dolphin", "fisch", "hai", "wal", "krake", "krabbe"],
    },
    {
        id: "animals", en: "Animals", de: "Tiere",
        words: ["dog", "puppy", "rat", "goat", "mouse", "hamster", "frog", "bird", "duck", "bear", "monkey", "horse", "cow",
            "pig", "bunny", "rabbit", "fox", "capybara", "hund", "ratte", "ziege", "maus", "frosch", "vogel", "ente", "bär",
            "affe", "pferd", "kuh", "schwein", "hase", "fuchs"],
    },
    {
        id: "food", en: "Food", de: "Essen",
        words: ["tomato", "potato", "strawberry", "pumpkin", "lollipop", "beer", "pizza", "burger", "cake", "cookie",
            "banana", "apple", "fries", "food", "tomate", "kartoffel", "erdbeer", "erdbeere", "kürbis", "lolli", "bier",
            "kuchen", "keks", "banane", "apfel", "pommes", "essen"],
    },
    {
        id: "people", en: "People", de: "Leute",
        words: ["man", "guy", "girl", "boy", "woman", "clown", "wizard", "sir", "mamacita", "eminem", "perry", "twink",
            "chef", "driver", "mann", "frau", "junge", "mädchen", "typ", "zauberer", "koch"],
    },
    {
        id: "creatures", en: "Creatures", de: "Wesen",
        words: ["alien", "monster", "creature", "chibi", "ghost", "blob", "ball", "head", "wesen", "geist", "kopf"],
    },
    {
        id: "reactions", en: "Reactions", de: "Reaktionen",
        words: ["you", "your", "don't", "stop", "ok", "no", "yes", "woah", "uwu", "bleh", "im", "i'm", "not", "lol",
            "shock", "embarrassed", "panicked", "grumpy", "blushing", "nein", "ja", "peinlich", "schock"],
    },
];

const index = new Map<string, string[]>();
for (const c of CATEGORIES) for (const w of c.words) index.set(w, [...(index.get(w) ?? []), c.id]);

/** Words of a name: lowercase, split on anything that isn't a letter/digit/apostrophe, also compound parts */
function words(name: string): string[] {
    const out: string[] = [];
    for (const w of name.toLowerCase().split(/[^\p{L}\p{N}']+/u)) {
        if (!w) continue;
        out.push(w);
        if (w.length > 3 && w.endsWith("s")) out.push(w.slice(0, -1));
    }
    return out;
}

/** automatic categories from the name */
const cache = new Map<string, string[]>();
export function autoCategoriesOf(s: Sticker): string[] {
    let ids = cache.get(s.name);
    if (!ids) {
        const set = new Set<string>();
        for (const w of words(s.name)) for (const id of index.get(w) ?? []) set.add(id);
        ids = [...set];
        cache.set(s.name, ids);
    }
    return ids;
}

/** "#katzen" / "#cats" → the built-in "cats"; anything else stays its own category "t:<tag>" */
export function tagToCategory(tag: string): string {
    const t = tag.toLowerCase();
    const builtIn = CATEGORIES.find(c => c.id === t || c.en.toLowerCase() === t || c.de.toLowerCase() === t);
    return builtIn ? builtIn.id : `t:${t}`;
}

/** all categories of a sticker: automatic + the ones people added (#tags) */
export function categoriesOf(s: Sticker): string[] {
    return [...new Set([...autoCategoriesOf(s), ...tagsOf(s).map(tagToCategory)])];
}

export function categoryLabel(id: string): string {
    if (id.startsWith("t:")) return id.slice(2).charAt(0).toUpperCase() + id.slice(3);
    const c = CATEGORIES.find(c => c.id === id);
    return c ? (lang() === "de" ? c.de : c.en) : id;
}

export interface CategoryChip {
    id: string;
    label: string;
    count: number;
}

/** Built-in categories with at least 2 stickers + every category somebody added; biggest first */
export function chipsFor(stickers: Sticker[]): CategoryChip[] {
    const counts = new Map<string, number>();
    for (const s of stickers) for (const id of categoriesOf(s)) counts.set(id, (counts.get(id) ?? 0) + 1);
    return [...counts.entries()]
        .filter(([id, n]) => id.startsWith("t:") ? n >= 1 : n >= 2)
        .map(([id, count]) => ({ id, label: categoryLabel(id), count }))
        .sort((a, b) => b.count - a.count);
}

/** Choices for the editor: built-in categories + all added ones */
export function categoryChoices(): { id: string; label: string; tag: string; }[] {
    const de = lang() === "de";
    return CATEGORIES.map(c => ({ id: c.id, label: de ? c.de : c.en, tag: (de ? c.de : c.en).toLowerCase() }));
}
