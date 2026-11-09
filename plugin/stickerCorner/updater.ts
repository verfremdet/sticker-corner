/*
 * Sticker Corner – prüft auf GitHub, ob es eine neue Version gibt, und zeigt die Neuigkeiten.
 */

import { showNotification } from "@api/Notifications";
import * as DataStore from "@api/DataStore";
import { relaunch } from "@utils/native";
import { PluginNative } from "@utils/types";
import { useEffect, useState } from "@webpack/common";

import { lang, t } from "./i18n";
import { VERSION } from "./version";

const UPDATES_URL = "https://raw.githubusercontent.com/verfremdet/sticker-corner/main/updates.json";
const CHECK_MS = 6 * 60 * 60 * 1000;
const NOTIFIED_KEY = "StickerCorner_notifiedVersion";

const Native = VencordNative.pluginHelpers.StickerCorner as PluginNative<typeof import("./native")>;

export interface NewsEntry {
    version: string;
    date: string;
    /** { en: [...], de: [...] } – fehlt eine Sprache, wird Englisch genommen */
    items: Record<string, unknown> | unknown[];
}

/** Neuigkeiten in der aktuellen Sprache */
export function itemsOf(n: NewsEntry): string[] {
    const raw = Array.isArray(n.items) ? n.items : (n.items[lang()] ?? n.items.en);
    return Array.isArray(raw) ? raw.map(String).slice(0, 10) : [];
}

type Status = "idle" | "updating" | "done" | "error";

let latest: string | null = null;
let news: NewsEntry[] = [];
let status: Status = "idle";
let error = "";
let timer: ReturnType<typeof setInterval> | undefined;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach(l => l());

/** "1.10.0" > "1.9.2" */
export function isNewer(a: string, b: string) {
    const pa = a.split(".").map(Number), pb = b.split(".").map(Number);
    for (let i = 0; i < 3; i++) {
        if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) > (pb[i] || 0);
    }
    return false;
}

async function check() {
    try {
        const res = await fetch(`${UPDATES_URL}?t=${Date.now()}`, { cache: "no-cache" });
        if (!res.ok) return;
        const data = await res.json();
        if (typeof data?.version !== "string" || !/^\d+\.\d+\.\d+$/.test(data.version)) return;
        latest = data.version;
        news = (Array.isArray(data.news) ? data.news : [])
            .filter((n: any) => typeof n?.version === "string" && n.items)
            .map((n: any) => ({ version: n.version, date: String(n.date ?? ""), items: n.items }));
        emit();

        if (isNewer(latest!, VERSION) && await DataStore.get(NOTIFIED_KEY) !== latest) {
            DataStore.set(NOTIFIED_KEY, latest);
            const entry = news.find(n => n.version === latest);
            const first = entry ? itemsOf(entry)[0] : undefined;
            showNotification({
                title: t("notifyTitle", { v: latest! }),
                body: first ? t("notifyBody", { item: first }) : t("notifyBodyPlain"),
            });
        }
    } catch { /* offline – nächster Versuch später */ }
}

// "What's new" after an update: shown once per installed version, until OK is clicked
const SEEN_KEY = "StickerCorner_seenVersion";
let seenVersion: string | null = VERSION; // until loaded: show nothing

export function startUpdater() {
    DataStore.get<string>(SEEN_KEY).then(v => { seenVersion = v ?? null; emit(); });
    setTimeout(check, 5_000);
    timer = setInterval(check, CHECK_MS);
}

export function dismissWhatsNew() {
    seenVersion = VERSION;
    DataStore.set(SEEN_KEY, VERSION);
    emit();
}

/** News for the installed version, if not yet confirmed */
export function useWhatsNew() {
    const [, force] = useState(0);
    useEffect(() => {
        const l = () => force(n => n + 1);
        listeners.add(l);
        return () => void listeners.delete(l);
    }, []);
    const entry = news.find(n => n.version === VERSION);
    const show = seenVersion !== VERSION && entry != null;
    return { show, items: entry ? itemsOf(entry) : [] };
}

export function stopUpdater() {
    clearInterval(timer);
}

export async function runUpdate() {
    if (status === "updating") return;
    status = "updating";
    error = "";
    emit();
    const res = await Native.update();
    status = res.ok ? "done" : "error";
    error = res.error ?? "";
    emit();
}

export const restartDiscord = relaunch;

export function useUpdate() {
    const [, force] = useState(0);
    useEffect(() => {
        const l = () => force(n => n + 1);
        listeners.add(l);
        return () => void listeners.delete(l);
    }, []);
    const available = latest != null && isNewer(latest, VERSION);
    return {
        available,
        latest,
        status,
        error,
        // Neuigkeiten seit der installierten Version
        news: news.filter(n => isNewer(n.version, VERSION)),
    };
}
