/*
 * Sticker Corner – loads the list from the server, remembers favorites and recently used, sends images.
 */

import * as DataStore from "@api/DataStore";
import { CloudUpload as TCloudUpload } from "@vencord/discord-types";
import { CloudUploadPlatform } from "@vencord/discord-types/enums";
import { PluginNative } from "@utils/types";
import { findLazy } from "@webpack";
import { Constants, FluxDispatcher, MessageActions, PendingReplyStore, RestAPI, showToast, SnowflakeUtils, useEffect, useState } from "@webpack/common";

import { t } from "./i18n";
import { settings } from "./settings";

export interface Sticker {
    id: string;
    name: string;
    file: string;
    /** small send version (max. 224 px); missing on old servers */
    sendFile?: string;
    width: number;
    height: number;
    author: string;
    createdAt: number;
    /** how often plugin users sent it (for "Popular") */
    uses?: number;
}

/** Sticker channel – the server tells us; fallback for old servers */
const DEFAULT_CHANNEL_ID = "1569211176548573325";
let channelId = DEFAULT_CHANNEL_ID;
export const stickerChannelId = () => channelId;

const POPULAR_MAX = 8;

const CloudUpload: typeof TCloudUpload = findLazy(m => m.prototype?.trackUploadFinished);

const RECENT_KEY = "StickerCorner_recent";
const FAV_KEY = "StickerCorner_favorites";
const RECENT_MAX = 12;
const POLL_MS = 30_000;

const FILE_RE = /^\d+\.(png|jpg|gif|webp)$/;
const SEND_FILE_RE = /^\d+\.s\.(png|jpg|gif|webp)$/;

let stickers: Sticker[] = [];
let version = 0;
let recent: string[] = [];
let favorites: string[] = [];
let loaded = false;
let failed = false;
let timer: ReturnType<typeof setInterval> | undefined;
const listeners = new Set<() => void>();

const emit = () => listeners.forEach(l => l());
const baseUrl = () => settings.store.serverUrl.replace(/\/+$/, "");

export const fileUrl = (s: Sticker) => `${baseUrl()}/files/${s.file}`;
/** Small version for the grid and for sending; falls back to the original */
export const smallUrl = (s: Sticker) => `${baseUrl()}/files/${s.sendFile ?? s.file}`;

/** File names like "91c81a5a8b08…" or "image0" are not real names */
const isJunkName = (n: string) => /^[0-9a-f]{12,}$/i.test(n) || /^(image|unknown|img|file)\s?\d*$/i.test(n);

export async function refresh() {
    try {
        const res = await fetch(`${baseUrl()}/api/stickers`, { cache: "no-cache" });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json() as { version: number; channelId?: string; stickers: Sticker[]; };
        const changed = data.version !== version || !loaded || failed;
        version = data.version;
        if (typeof data.channelId === "string" && /^\d{5,25}$/.test(data.channelId)) channelId = data.channelId;
        // Only take clean entries: file names must be "<number>.<image format>"
        stickers = (Array.isArray(data.stickers) ? data.stickers : [])
            .filter(s => typeof s?.id === "string" && typeof s.file === "string" && FILE_RE.test(s.file))
            .map(s => {
                const name = String(s.name ?? "").slice(0, 60);
                return {
                    ...s,
                    name: isJunkName(name) ? "" : name,
                    author: String(s.author ?? "").slice(0, 40),
                    uses: Number.isFinite(s.uses) ? Math.max(0, Number(s.uses)) : 0,
                    sendFile: typeof s.sendFile === "string" && SEND_FILE_RE.test(s.sendFile) ? s.sendFile : undefined,
                };
            });
        loaded = true;
        failed = false;
        if (changed) emit();
    } catch (e) {
        console.warn("[StickerCorner] could not load list:", e);
        if (!failed) { failed = true; loaded = true; emit(); }
    }
}

export async function start() {
    recent = await DataStore.get<string[]>(RECENT_KEY) ?? [];
    favorites = await DataStore.get<string[]>(FAV_KEY) ?? [];
    refresh();
    timer = setInterval(refresh, POLL_MS);
}

export function stop() {
    clearInterval(timer);
    timer = undefined;
}

export function useStickers() {
    const [, force] = useState(0);
    useEffect(() => {
        const l = () => force(n => n + 1);
        listeners.add(l);
        refresh(); // fetch right away when the picker opens
        return () => void listeners.delete(l);
    }, []);
    const byId = new Map(stickers.map(s => [s.id, s]));
    const pick = (ids: string[]) => ids.map(id => byId.get(id)).filter(Boolean) as Sticker[];
    const popular = stickers
        .filter(s => (s.uses ?? 0) > 0)
        .sort((a, b) => (b.uses ?? 0) - (a.uses ?? 0) || b.createdAt - a.createdAt)
        .slice(0, POPULAR_MAX);
    return {
        stickers,
        popular,
        recent: pick(recent),
        favorites: pick(favorites),
        isFavorite: (id: string) => favorites.includes(id),
        loaded,
        failed,
    };
}

function remember(id: string) {
    recent = [id, ...recent.filter(r => r !== id)].slice(0, RECENT_MAX);
    DataStore.set(RECENT_KEY, recent);
    emit();
}

/** Favorite on/off – unlimited, newest first */
export function toggleFavorite(id: string) {
    favorites = favorites.includes(id) ? favorites.filter(f => f !== id) : [id, ...favorites];
    DataStore.set(FAV_KEY, favorites);
    emit();
}

/** Loads the image and sends it to the channel as a normal image upload. */
export async function sendSticker(sticker: Sticker, channelId: string) {
    remember(sticker.id);

    const original = settings.store.sendSize === "original";
    const fileName = original ? sticker.file : sticker.sendFile ?? sticker.file;

    let blob: Blob;
    try {
        const res = await fetch(`${baseUrl()}/files/${fileName}`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        blob = await res.blob();
    } catch {
        showToast({ text: t("loadFailed"), variant: "critical" });
        return;
    }

    const ext = fileName.split(".").pop();
    const file = new File([blob], `${safeFileName(sticker.name)}.${ext}`, { type: blob.type });

    const reply = PendingReplyStore.getPendingReply(channelId);
    if (reply) FluxDispatcher.dispatch({ type: "DELETE_PENDING_REPLY", channelId });

    const ok = await uploadFile(file, channelId, "", reply ? MessageActions.getSendMessageOptionsForReply(reply)?.messageReference : null);
    if (ok) reportUse(sticker.id);
}

const safeFileName = (name: string) => name.replace(/[^\p{L}\p{N} _-]/gu, "").trim().replace(/\s+/g, "_").slice(0, 40) || "sticker";

/** Counts the send on the server for "Popular" (anonymous, best effort) */
function reportUse(id: string) {
    fetch(`${baseUrl()}/api/used/${id}`, { method: "POST", keepalive: true }).catch(() => { });
}

/** Uploads a file like Discord's own upload and posts it as a message. */
function uploadFile(file: File, channelId: string, content: string, messageReference: unknown = null): Promise<boolean> {
    return new Promise(resolve => {
        const upload = new CloudUpload({ file, isThumbnail: false, platform: CloudUploadPlatform.WEB }, channelId);
        upload.on("complete", () => {
            RestAPI.post({
                url: Constants.Endpoints.MESSAGES(channelId),
                body: {
                    channel_id: channelId,
                    content,
                    nonce: SnowflakeUtils.fromTimestamp(Date.now()),
                    sticker_ids: [],
                    type: 0,
                    attachments: [{
                        id: "0",
                        filename: upload.filename,
                        uploaded_filename: upload.uploadedFilename,
                    }],
                    message_reference: messageReference,
                },
            }).then(() => resolve(true), () => {
                showToast({ text: t("sendFailed"), variant: "critical" });
                resolve(false);
            });
        });
        upload.on("error", () => {
            showToast({ text: t("uploadFailed"), variant: "critical" });
            resolve(false);
        });
        upload.upload();
    });
}

const Native = VencordNative.pluginHelpers.StickerCorner as PluginNative<typeof import("./native")>;
const EXT_BY_TYPE: Record<string, string> = {
    "image/png": "png", "image/jpeg": "jpg", "image/gif": "gif", "image/webp": "webp",
    "video/mp4": "mp4", "video/webm": "webm", "video/quicktime": "mov",
};

/** "Add to Sticker Corner": posts the image into the sticker channel with the name as text. */
export async function addToCorner(src: string, name: string): Promise<boolean> {
    const res = await Native.fetchMedia(src).catch(() => ({ error: "http" as const }));
    if (!("data" in res) || !res.data) {
        showToast({ text: t(res.error === "size" ? "tooBig" : "addFailed"), variant: "critical" });
        return false;
    }
    const pathExt = /\.(png|jpe?g|gif|webp|mp4|webm|mov)(?:$|\?)/i.exec(new URL(src).pathname)?.[1]?.toLowerCase();
    const ext = EXT_BY_TYPE[res.type ?? ""] ?? (pathExt === "jpeg" ? "jpg" : pathExt);
    if (!ext) {
        showToast({ text: t("addFailed"), variant: "critical" });
        return false;
    }
    const file = new File([new Uint8Array(res.data)],`${safeFileName(name)}.${ext}`, { type: res.type || `image/${ext}` });
    const ok = await uploadFile(file, channelId, name.trim().slice(0, 60));
    if (ok) {
        showToast({ text: t("added"), variant: "success" });
        setTimeout(refresh, 5000);
    }
    return ok;
}
