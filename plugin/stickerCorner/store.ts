/*
 * Sticker Corner – loads the list from the server, remembers favorites and recently used, sends images.
 */

import * as DataStore from "@api/DataStore";
import { CloudUpload as TCloudUpload } from "@vencord/discord-types";
import { CloudUploadPlatform } from "@vencord/discord-types/enums";
import { PluginNative } from "@utils/types";
import { findLazy } from "@webpack";
import { ChannelStore, Constants, FluxDispatcher, MessageActions, PendingReplyStore, PermissionsBits, PermissionStore, RestAPI, showToast, SnowflakeUtils, useEffect, useState } from "@webpack/common";

import { t } from "./i18n";
import { settings } from "./settings";
import { learn } from "./suggest";

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
    /** message in the sticker channel the image came from (for renaming by reply) */
    messageId?: string;
    /** how often plugin users sent it (for "Popular") */
    uses?: number;
    /** shared categories (#tags from replies in the sticker channel) */
    tags?: string[];
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
                    tags: cleanTags(s.tags),
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
    counts = await DataStore.get<Record<string, number>>(COUNT_KEY) ?? {};
    localTags = await DataStore.get<Record<string, string[]>>(LOCAL_TAGS_KEY) ?? {};
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

// personal stats: how often I sent each sticker (local only)
const COUNT_KEY = "StickerCorner_counts";
let counts: Record<string, number> = {};
export const myCount = (id: string) => counts[id] ?? 0;
/** my most sent sticker (sent at least twice) */
export function myTop(): { sticker: Sticker; n: number; } | null {
    let best: { sticker: Sticker; n: number; } | null = null;
    for (const st of stickers) {
        const n = counts[st.id] ?? 0;
        if (n >= 2 && (!best || n > best.n)) best = { sticker: st, n };
    }
    return best;
}

function remember(id: string) {
    recent = [id, ...recent.filter(r => r !== id)].slice(0, RECENT_MAX);
    DataStore.set(RECENT_KEY, recent);
    counts = { ...counts, [id]: (counts[id] ?? 0) + 1 };
    DataStore.set(COUNT_KEY, counts);
    emit();
}

/** Favorite on/off – unlimited, newest first */
export function toggleFavorite(id: string) {
    favorites = favorites.includes(id) ? favorites.filter(f => f !== id) : [id, ...favorites];
    DataStore.set(FAV_KEY, favorites);
    emit();
}

/** May I post in the sticker channel? (add + rename are only offered then) */
export function canPost(): boolean {
    const channel = ChannelStore.getChannel(channelId);
    if (!channel) return false; // no access to the channel at all
    return PermissionStore.can(PermissionsBits.SEND_MESSAGES | PermissionsBits.ATTACH_FILES, channel);
}

/** Rename = reply to the image in the sticker channel; the server takes the newest reply as the name */
// ── names & categories ──────────────────────────────────────────────────
const TAG_OK = /^[\p{L}\p{N}_-]{1,24}$/u;
export function cleanTags(raw: unknown): string[] {
    if (!Array.isArray(raw)) return [];
    return [...new Set(raw.map(t => String(t).toLowerCase().trim().replace(/^#/, "")).filter(t => TAG_OK.test(t) && /\p{L}/u.test(t)))].slice(0, 8);
}

/** Categories only for me (people without access to the sticker channel) */
const LOCAL_TAGS_KEY = "StickerCorner_localTags";
let localTags: Record<string, string[]> = {};

/** shared + my own categories of a sticker */
export const tagsOf = (s: Sticker): string[] => [...new Set([...(s.tags ?? []), ...(localTags[s.id] ?? [])])];

/** every category somebody made, for the editor */
export const allTags = (): string[] => [...new Set([...stickers.flatMap(s => s.tags ?? []), ...Object.values(localTags).flat()])].sort();

/** silent reply to the image in the sticker channel → the server takes it as name and/or #categories */
async function replyInChannel(s: Sticker, content: string): Promise<boolean> {
    if (!s.messageId || !/^\d{5,25}$/.test(s.messageId)) return false;
    const channel = ChannelStore.getChannel(channelId);
    await RestAPI.post({
        url: Constants.Endpoints.MESSAGES(channelId),
        body: {
            content,
            nonce: SnowflakeUtils.fromTimestamp(Date.now()),
            message_reference: { message_id: s.messageId, channel_id: channelId, guild_id: channel?.guild_id },
            allowed_mentions: { parse: [], replied_user: false },
            flags: 4096, // silent
        },
    });
    return true;
}

const tagLine = (tags: string[]) => tags.length ? tags.map(t => `#${t}`).join(" ") : "#-";
const sameTags = (a: string[], b: string[]) => a.length === b.length && a.every(t => b.includes(t));

/**
 * Save name and categories. With access to the sticker channel: for everyone (one silent reply).
 * Without: categories only for me, name stays.
 */
export async function editSticker(s: Sticker, name: string, tags: string[]): Promise<boolean> {
    const cleanName = name.trim().slice(0, 60);
    const newTags = cleanTags(tags);
    if (!canPost()) {
        localTags = { ...localTags, [s.id]: newTags.filter(t => !(s.tags ?? []).includes(t)) };
        DataStore.set(LOCAL_TAGS_KEY, localTags);
        emit();
        return true;
    }
    const nameChanged = !!cleanName && cleanName !== s.name;
    const tagsChanged = !sameTags(newTags, s.tags ?? []);
    if (!nameChanged && !tagsChanged) return true;
    const content = [nameChanged ? cleanName : "", tagsChanged ? tagLine(newTags) : ""].filter(Boolean).join(" ");
    try {
        await replyInChannel(s, content);
    } catch {
        showToast({ text: t("renameFailed"), variant: "critical" });
        return false;
    }
    // show it right away, the server confirms within seconds
    if (nameChanged) s.name = cleanName;
    if (tagsChanged) s.tags = newTags;
    emit();
    setTimeout(refresh, 3000);
    return true;
}

/** New category for several stickers at once */
export async function addTagTo(list: Sticker[], tag: string): Promise<number> {
    const [clean] = cleanTags([tag]);
    if (!clean) return 0;
    let done = 0;
    for (const s of list) {
        if (tagsOf(s).includes(clean)) continue;
        if (await editSticker(s, s.name, [...(canPost() ? s.tags ?? [] : tagsOf(s)), clean])) done++;
        if (canPost()) await new Promise(r => setTimeout(r, 350)); // gentle on Discord's rate limit
    }
    return done;
}

export const findSticker =(pred: (s: Sticker) => boolean) => stickers.find(pred);

// ── fast sending ────────────────────────────────────────────────────────
// Sending used to be: load image → upload to Discord → post message, all after the click.
// Now the first two steps start as soon as the mouse rests on a sticker; the click only posts.
const PREPARE_TTL = 20 * 60_000;
const PREPARE_MAX = 12;
const blobs = new Map<string, Promise<Blob>>();
const prepared = new Map<string, Prepared>();

const sendFileOf = (s: Sticker) => settings.store.sendSize === "original" ? s.file : s.sendFile ?? s.file;

function loadBlob(fileName: string): Promise<Blob> {
    let p = blobs.get(fileName);
    if (!p) {
        p = fetch(`${baseUrl()}/files/${fileName}`).then(r => {
            if (!r.ok) throw new Error(`HTTP ${r.status}`);
            return r.blob();
        });
        p.catch(() => blobs.delete(fileName));
        blobs.set(fileName, p);
    }
    return p;
}

async function stickerFile(s: Sticker): Promise<File> {
    const fileName = sendFileOf(s);
    const blob = await loadBlob(fileName);
    return new File([blob], `${safeFileName(s.name)}.${fileName.split(".").pop()}`, { type: blob.type });
}

/** Sends any file through Discord's own send path (shows up instantly, Discord uploads it) */
export function sendFileNow(file: File, channelId: string): boolean {
    const reply = PendingReplyStore.getPendingReply(channelId);
    if (reply) FluxDispatcher.dispatch({ type: "DELETE_PENDING_REPLY", channelId });
    const messageReference = reply ? MessageActions.getSendMessageOptionsForReply(reply)?.messageReference : undefined;
    const upload = new CloudUpload({ file, isThumbnail: false, platform: CloudUploadPlatform.WEB }, channelId);
    try {
        MessageActions.sendMessage(
            channelId,
            { content: "", tts: false, invalidEmojis: [], validNonShortcutEmojis: [] } as any,
            true,
            { attachmentsToUpload: [upload], ...(messageReference ? { messageReference } : {}) } as any,
        );
        return true;
    } catch {
        uploadFile(file, channelId, "");
        return true;
    }
}

export const fileUrlOf = (s: Sticker) => fileUrl(s);

/** Load the small images in the background (picker open) so a click never waits for our server */
export function warmBlobs(list: Sticker[]) {
    for (const s of list.slice(0, 80)) loadBlob(sendFileOf(s)).catch(() => { });
}

/** Start loading + uploading in the background (hover/focus). Each upload is used once. */
export function prepareSticker(s: Sticker, channelId: string) {
    const key = `${channelId}:${sendFileOf(s)}`;
    const now = Date.now();
    for (const [k, v] of prepared) if (now - v.at > PREPARE_TTL) prepared.delete(k);
    if (prepared.has(key)) return;
    // keep only the newest few; older unused uploads simply expire on Discord's side
    while (prepared.size >= PREPARE_MAX) prepared.delete(prepared.keys().next().value!);
    const entry: Prepared = { at: now, upload: null, done: Promise.resolve(false) };
    entry.done = stickerFile(s).then(file => new Promise<boolean>(resolve => {
        const up = new CloudUpload({ file, isThumbnail: false, platform: CloudUploadPlatform.WEB }, channelId);
        entry.upload = up;
        up.on("complete", () => resolve(true));
        up.on("error", () => resolve(false));
        up.upload();
    })).catch(() => false);
    prepared.set(key, entry);
}

interface Prepared { at: number; upload: TCloudUpload | null; done: Promise<boolean>; }

/**
 * Sends the sticker as a normal image upload through Discord's own send path:
 * the message shows up in the chat immediately (like when you send a picture yourself),
 * and if the upload was prepared on hover, Discord only has to post it.
 */
export async function sendSticker(sticker: Sticker, channelId: string): Promise<boolean> {
    remember(sticker.id);
    learn(channelId, `s:${sticker.id}`); // "Fits right now" learns: in this chat context I used this sticker

    const reply = PendingReplyStore.getPendingReply(channelId);
    if (reply) FluxDispatcher.dispatch({ type: "DELETE_PENDING_REPLY", channelId });
    const messageReference = reply ? MessageActions.getSendMessageOptionsForReply(reply)?.messageReference : undefined;

    const key = `${channelId}:${sendFileOf(sticker)}`;
    const ready = prepared.get(key);
    prepared.delete(key);

    let upload: TCloudUpload | null = null;
    if (ready && Date.now() - ready.at < PREPARE_TTL && await ready.done) upload = ready.upload;
    if (!upload) {
        // not prepared: hand Discord a fresh upload – it shows the "sending" message right away and uploads itself
        let file: File;
        try {
            file = await stickerFile(sticker);
        } catch {
            showToast({ text: t("loadFailed"), variant: "critical" });
            return false;
        }
        upload = new CloudUpload({ file, isThumbnail: false, platform: CloudUploadPlatform.WEB }, channelId);
    }

    try {
        MessageActions.sendMessage(
            channelId,
            { content: "", tts: false, invalidEmojis: [], validNonShortcutEmojis: [] } as any,
            true,
            { attachmentsToUpload: [upload], ...(messageReference ? { messageReference } : {}) } as any,
        );
    } catch (e) {
        console.warn("[StickerCorner] native send failed, falling back:", e);
        const up = await stickerFile(sticker).then(f => cloudUpload(f, channelId)).catch(() => null);
        if (!up || !await postAttachment(channelId, up, "", messageReference ?? null)) return false;
    }
    reportUse(sticker.id);
    return true;
}

const safeFileName = (name: string) => name.replace(/[^\p{L}\p{N} _-]/gu, "").trim().replace(/\s+/g, "_").slice(0, 40) || "sticker";

/** Counts the send on the server for "Popular" (anonymous, best effort) */
function reportUse(id: string) {
    fetch(`${baseUrl()}/api/used/${id}`, { method: "POST", keepalive: true }).catch(() => { });
}

interface Uploaded { filename: string; uploadedFilename: string; }

/** Uploads a file to Discord's storage, like Discord's own upload (not yet a message). */
function cloudUpload(file: File, channelId: string, toastOnError = true): Promise<Uploaded | null> {
    return new Promise(resolve => {
        const upload = new CloudUpload({ file, isThumbnail: false, platform: CloudUploadPlatform.WEB }, channelId);
        upload.on("complete", () => resolve({ filename: upload.filename, uploadedFilename: upload.uploadedFilename! }));
        upload.on("error", () => {
            if (toastOnError) showToast({ text: t("uploadFailed"), variant: "critical" });
            resolve(null);
        });
        upload.upload();
    });
}

/** Posts an uploaded file as a message */
function postAttachment(channelId: string, up: Uploaded, content: string, messageReference: unknown = null, toastOnError = true): Promise<boolean> {
    return RestAPI.post({
        url: Constants.Endpoints.MESSAGES(channelId),
        body: {
            channel_id: channelId,
            content,
            nonce: SnowflakeUtils.fromTimestamp(Date.now()),
            sticker_ids: [],
            type: 0,
            attachments: [{ id: "0", filename: up.filename, uploaded_filename: up.uploadedFilename }],
            message_reference: messageReference,
        },
    }).then(() => true, () => {
        if (toastOnError) showToast({ text: t("sendFailed"), variant: "critical" });
        return false;
    });
}

async function uploadFile(file: File, channelId: string, content: string): Promise<boolean> {
    const up = await cloudUpload(file, channelId);
    return !!up && postAttachment(channelId, up, content);
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
