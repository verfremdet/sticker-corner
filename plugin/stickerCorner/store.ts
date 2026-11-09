/*
 * Sticker Corner – Liste vom Server holen, zuletzt benutzte merken, Bild senden.
 */

import * as DataStore from "@api/DataStore";
import { CloudUpload as TCloudUpload } from "@vencord/discord-types";
import { CloudUploadPlatform } from "@vencord/discord-types/enums";
import { findLazy } from "@webpack";
import { Constants, FluxDispatcher, MessageActions, PendingReplyStore, RestAPI, showToast, SnowflakeUtils, useEffect, useState } from "@webpack/common";

import { settings } from "./settings";

export interface Sticker {
    id: string;
    name: string;
    file: string;
    width: number;
    height: number;
    author: string;
    createdAt: number;
}

const CloudUpload: typeof TCloudUpload = findLazy(m => m.prototype?.trackUploadFinished);

const RECENT_KEY = "StickerCorner_recent";
const RECENT_MAX = 12;
const POLL_MS = 30_000;

let stickers: Sticker[] = [];
let version = 0;
let recent: string[] = [];
let loaded = false;
let failed = false;
let timer: ReturnType<typeof setInterval> | undefined;
const listeners = new Set<() => void>();

const emit = () => listeners.forEach(l => l());
const baseUrl = () => settings.store.serverUrl.replace(/\/+$/, "");

export const fileUrl = (s: Sticker) => `${baseUrl()}/files/${s.file}`;

export async function refresh() {
    try {
        const res = await fetch(`${baseUrl()}/api/stickers`, { cache: "no-cache" });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json() as { version: number; stickers: Sticker[]; };
        const changed = data.version !== version || !loaded || failed;
        version = data.version;
        stickers = data.stickers;
        loaded = true;
        failed = false;
        if (changed) emit();
    } catch (e) {
        console.warn("[StickerCorner] Liste nicht ladbar:", e);
        if (!failed) { failed = true; loaded = true; emit(); }
    }
}

export async function start() {
    recent = await DataStore.get<string[]>(RECENT_KEY) ?? [];
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
        refresh(); // beim Öffnen sofort neu holen
        return () => void listeners.delete(l);
    }, []);
    const byId = new Map(stickers.map(s => [s.id, s]));
    return {
        stickers,
        recent: recent.map(id => byId.get(id)).filter(Boolean) as Sticker[],
        loaded,
        failed,
    };
}

function remember(id: string) {
    recent = [id, ...recent.filter(r => r !== id)].slice(0, RECENT_MAX);
    DataStore.set(RECENT_KEY, recent);
    emit();
}

/** Lädt das Bild und sendet es als normalen Bild-Upload in den Channel. */
export async function sendSticker(sticker: Sticker, channelId: string) {
    remember(sticker.id);

    let blob: Blob;
    try {
        const res = await fetch(fileUrl(sticker));
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        blob = await res.blob();
    } catch {
        showToast({ text: "Sticker konnte nicht geladen werden", variant: "critical" });
        return;
    }

    const ext = sticker.file.split(".").pop();
    const safeName = sticker.name.replace(/[^\p{L}\p{N} _-]/gu, "").trim().replace(/\s+/g, "_") || "sticker";
    const file = new File([blob], `${safeName}.${ext}`, { type: blob.type });

    const reply = PendingReplyStore.getPendingReply(channelId);
    if (reply) FluxDispatcher.dispatch({ type: "DELETE_PENDING_REPLY", channelId });

    const upload = new CloudUpload({ file, isThumbnail: false, platform: CloudUploadPlatform.WEB }, channelId);
    upload.on("complete", () => {
        RestAPI.post({
            url: Constants.Endpoints.MESSAGES(channelId),
            body: {
                channel_id: channelId,
                content: "",
                nonce: SnowflakeUtils.fromTimestamp(Date.now()),
                sticker_ids: [],
                type: 0,
                attachments: [{
                    id: "0",
                    filename: upload.filename,
                    uploaded_filename: upload.uploadedFilename,
                }],
                message_reference: reply ? MessageActions.getSendMessageOptionsForReply(reply)?.messageReference : null,
            },
        }).catch(() => showToast({ text: "Sticker konnte nicht gesendet werden", variant: "critical" }));
    });
    upload.on("error", () => showToast({ text: "Upload fehlgeschlagen", variant: "critical" }));
    upload.upload();
}
