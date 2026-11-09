/*
 * Sticker Corner – Texte auf Englisch (Standard) und Deutsch.
 * "auto": Deutsch, wenn Discord auf Deutsch steht, sonst Englisch.
 */

import { settings } from "./settings";

const en = {
    searchPlaceholder: "Search Sticker Corner",
    loading: "Loading …",
    serverDown: "Can't reach the sticker server.\nTry again in a moment.",
    empty: "No stickers yet.\nPost an image in the sticker channel.",
    noResults: "Nothing found for “{q}”.",
    recent: "Recently used",
    favorites: "Favorites ({n})",
    addFavorite: "Add to favorites (or right-click)",
    removeFavorite: "Remove from favorites",
    all: "All stickers ({n})",
    results: "Results ({n})",
    by: "by {name}",
    loadFailed: "Couldn't load sticker",
    sendFailed: "Couldn't send sticker",
    uploadFailed: "Upload failed",
    updateAvailable: "Update {v} available",
    updateInstalled: "Update installed",
    whatsNew: "What's new?",
    less: "Less",
    updateNow: "Update now",
    retry: "Try again",
    updating: "Updating … (about 1 min)",
    restart: "Restart Discord",
    notifyTitle: "Sticker Corner {v} is here",
    notifyBody: "New: {item} – update in the “Sticker Corner” tab.",
    notifyBodyPlain: "Update in the “Sticker Corner” tab.",
};

const de: typeof en = {
    searchPlaceholder: "Sticker Corner durchsuchen",
    loading: "Lädt …",
    serverDown: "Sticker-Server nicht erreichbar.\nVersuch es gleich nochmal.",
    empty: "Noch keine Sticker.\nPoste ein Bild in den Sticker-Channel.",
    noResults: "Nichts gefunden für „{q}“.",
    recent: "Zuletzt benutzt",
    favorites: "Favoriten ({n})",
    addFavorite: "Zu Favoriten (oder Rechtsklick)",
    removeFavorite: "Aus Favoriten entfernen",
    all: "Alle Sticker ({n})",
    results: "Treffer ({n})",
    by: "von {name}",
    loadFailed: "Sticker konnte nicht geladen werden",
    sendFailed: "Sticker konnte nicht gesendet werden",
    uploadFailed: "Upload fehlgeschlagen",
    updateAvailable: "Update {v} verfügbar",
    updateInstalled: "Update installiert",
    whatsNew: "Was ist neu?",
    less: "Weniger",
    updateNow: "Jetzt updaten",
    retry: "Nochmal versuchen",
    updating: "Wird aktualisiert … (ca. 1 Min)",
    restart: "Discord neu starten",
    notifyTitle: "Sticker Corner {v} ist da",
    notifyBody: "Neu: {item} – Update im Reiter „Sticker Corner“.",
    notifyBodyPlain: "Update im Reiter „Sticker Corner“.",
};

export type Lang = "en" | "de";

export function lang(): Lang {
    const choice = settings.store.language;
    if (choice === "en" || choice === "de") return choice;
    // Discord setzt die eigene Sprache als lang-Attribut ("de", "en-US", …)
    const detected = (document.documentElement.lang || navigator.language || "en").toLowerCase();
    return detected.startsWith("de") ? "de" : "en";
}

export function t(key: keyof typeof en, vars: Record<string, string | number> = {}) {
    const text = (lang() === "de" ? de : en)[key];
    return text.replace(/\{(\w+)\}/g, (_, k) => String(vars[k] ?? ""));
}
