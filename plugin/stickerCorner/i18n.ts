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
    restartHint: "Active after your next Discord restart – whenever it suits you.",
    newIn: "New in {v}",
    openButton: "Sticker Corner",
    whatsNew: "What's new?",
    less: "Less",
    updateNow: "Update now",
    retry: "Try again",
    updating: "Updating … (about 1 min)",
    restart: "Restart Discord",
    notifyTitle: "Sticker Corner {v} is here",
    notifyBody: "New: {item} – update in the “Sticker Corner” tab.",
    notifyBodyPlain: "Update in the “Sticker Corner” tab.",
    popular: "Popular",
    allCategories: "All",
    addToCorner: "Add to Sticker Corner",
    addTitle: "Add to Sticker Corner",
    addNameLabel: "Name (helps with search and categories)",
    addNamePlaceholder: "e.g. sleepy cat",
    addButton: "Add",
    cancel: "Cancel",
    adding: "Adding …",
    added: "Added – everyone has it within 30 s",
    addFailed: "Couldn't add the image",
    tooBig: "Image is too big (max. 10 MB)",
    olderNews: "Earlier versions ({n})",
    rename: "Rename",
    renameTitle: "Rename sticker",
    renameButton: "Save",
    renameNote: "Posted as a reply to the image in the sticker channel – the newest reply is the name for everyone.",
    renameFailed: "Couldn't rename the sticker",
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
    restartHint: "Aktiv nach dem nächsten Discord-Neustart – wann es dir passt.",
    newIn: "Neu in {v}",
    openButton: "Sticker Corner",
    whatsNew: "Was ist neu?",
    less: "Weniger",
    updateNow: "Jetzt updaten",
    retry: "Nochmal versuchen",
    updating: "Wird aktualisiert … (ca. 1 Min)",
    restart: "Discord neu starten",
    notifyTitle: "Sticker Corner {v} ist da",
    notifyBody: "Neu: {item} – Update im Reiter „Sticker Corner“.",
    notifyBodyPlain: "Update im Reiter „Sticker Corner“.",
    popular: "Beliebt",
    allCategories: "Alle",
    addToCorner: "Zu Sticker Corner hinzufügen",
    addTitle: "Zu Sticker Corner hinzufügen",
    addNameLabel: "Name (hilft bei Suche und Kategorien)",
    addNamePlaceholder: "z. B. müde Katze",
    addButton: "Hinzufügen",
    cancel: "Abbrechen",
    adding: "Wird hinzugefügt …",
    added: "Hinzugefügt – in 30 s bei allen",
    addFailed: "Bild konnte nicht hinzugefügt werden",
    tooBig: "Bild ist zu groß (max. 10 MB)",
    olderNews: "Frühere Versionen ({n})",
    rename: "Umbenennen",
    renameTitle: "Sticker umbenennen",
    renameButton: "Speichern",
    renameNote: "Wird als Antwort auf das Bild im Sticker-Channel gepostet – die neueste Antwort ist der Name für alle.",
    renameFailed: "Sticker konnte nicht umbenannt werden",
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
