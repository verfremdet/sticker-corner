// Sticker-Liste: hält alle Sticker im Speicher, speichert sie als stickers.json
// und legt die Bilddateien in DATA_DIR/files ab.
// Kurze Videos (mp4, webm, mov) werden per ffmpeg zu GIFs umgewandelt.
import { execFile as cpExecFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rename, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import sharp from "sharp";

const execFile = promisify(cpExecFile);

// Discord erlaubt ohne Nitro 10 MB je Upload. Etwas Luft lassen.
const MAX_BYTES = 9.5 * 1024 * 1024;
const MAX_SIDE = 1024;
// Videos: höchstens so lang wird das GIF, größere Downloads werden gar nicht angefasst
const VIDEO_MAX_SECONDS = 15;
const VIDEO_MAX_DOWNLOAD = 100 * 1024 * 1024;
// Versuche von gut nach klein, bis das GIF unter MAX_BYTES liegt
const GIF_STEPS = [[480, 15], [400, 12], [320, 10], [240, 8]];
// Sende-Version: etwas größer als Discord-Sticker (160 px), damit sie im Chat nicht riesig ist
const SEND_SIDE = 224;

/** Kleine Sende-Version im selben Format (GIF/WebP bleiben animiert) */
async function makeSmall(buf, ext) {
    const animated = ext === "gif" || ext === "webp";
    let img = sharp(buf, { animated }).resize(SEND_SIDE, SEND_SIDE, { fit: "inside", withoutEnlargement: true });
    if (ext === "gif") img = img.gif({ effort: 7 });
    else if (ext === "webp") img = img.webp({ quality: 90 });
    else if (ext === "jpg") img = img.jpeg({ quality: 90 });
    else img = img.png();
    return img.toBuffer();
}

const EXT_BY_TYPE = {
    "image/png": "png",
    "image/jpeg": "jpg",
    "image/gif": "gif",
    "image/webp": "webp",
};
const VIDEO_BY_TYPE = {
    "video/mp4": "mp4",
    "video/webm": "webm",
    "video/quicktime": "mov",
};
const VIDEO_EXTS = new Set(Object.values(VIDEO_BY_TYPE));

export const TYPE_BY_EXT = Object.fromEntries(Object.entries(EXT_BY_TYPE).map(([t, e]) => [e, t]));

/** Dateiendung für unterstützte Bilder und Videos, sonst null */
export function mediaExt(attachment) {
    const type = (attachment.contentType ?? "").split(";")[0];
    const byType = EXT_BY_TYPE[type] ?? VIDEO_BY_TYPE[type];
    if (byType) return byType;
    const m = /\.(png|jpe?g|gif|webp|mp4|webm|mov)$/i.exec(attachment.name ?? "");
    if (!m) return null;
    return m[1].toLowerCase() === "jpeg" ? "jpg" : m[1].toLowerCase();
}

/** Video oder großes GIF → GIF unter MAX_BYTES (oder null, wenn es nicht klein genug wird) */
async function toGif(input, inExt) {
    const dir = await mkdtemp(path.join(os.tmpdir(), "stickercorner-"));
    try {
        const src = path.join(dir, `in.${inExt}`);
        const out = path.join(dir, "out.gif");
        await writeFile(src, input);
        for (const [width, fps] of GIF_STEPS) {
            const filter = `fps=${fps},scale='min(${width},iw)':-2:flags=lanczos,split[a][b];` +
                "[a]palettegen=max_colors=128:stats_mode=diff[p];[b][p]paletteuse=dither=bayer:bayer_scale=4:diff_mode=rectangle";
            await execFile("ffmpeg", ["-y", "-v", "error", "-t", String(VIDEO_MAX_SECONDS), "-i", src,
                "-vf", filter, "-an", "-loop", "0", out], { timeout: 180_000 });
            const gif = await readFile(out);
            if (gif.length <= MAX_BYTES) return gif;
        }
        return null;
    } finally {
        await rm(dir, { recursive: true, force: true });
    }
}

export class Store {
    constructor(dataDir) {
        this.dataDir = dataDir;
        this.filesDir = path.join(dataDir, "files");
        this.jsonPath = path.join(dataDir, "stickers.json");
        /** @type {Map<string, any>} Schlüssel = Attachment-ID */
        this.stickers = new Map();
        this.version = 0;
        this.saveTimer = null;
    }

    async load() {
        await mkdir(this.filesDir, { recursive: true });
        try {
            const data = JSON.parse(await readFile(this.jsonPath, "utf8"));
            for (const s of data.stickers ?? []) this.stickers.set(s.id, s);
            this.version = data.version ?? Date.now();
        } catch {
            this.version = Date.now();
        }
    }

    list() {
        const stickers = [...this.stickers.values()].sort((a, b) => b.createdAt - a.createdAt);
        return { version: this.version, channelId: this.channelId, stickers };
    }

    has(id) {
        return this.stickers.has(id);
    }

    idsOfMessage(messageId) {
        return [...this.stickers.values()].filter(s => s.messageId === messageId).map(s => s.id);
    }

    /** Lädt Bild oder Video herunter, wandelt/verkleinert bei Bedarf und trägt es ein. */
    async add({ attachment, message }) {
        const ext = mediaExt(attachment);
        if (!ext || this.stickers.has(attachment.id)) return false;
        const isVideo = VIDEO_EXTS.has(ext);
        if (isVideo && (attachment.size ?? 0) > VIDEO_MAX_DOWNLOAD) {
            console.log(`Video zu groß, übersprungen: ${attachment.name}`);
            return false;
        }

        const res = await fetch(attachment.url);
        if (!res.ok) throw new Error(`Download ${attachment.id}: HTTP ${res.status}`);
        let buf = Buffer.from(await res.arrayBuffer());
        let fileExt = ext;

        if (isVideo || (ext === "gif" && buf.length > MAX_BYTES)) {
            // Video → GIF; zu großes GIF → kleineres GIF (bleibt animiert, kein Format-Wechsel)
            const gif = await toGif(buf, ext);
            if (!gif) {
                console.log(`Nicht unter 10 MB zu bekommen, übersprungen: ${attachment.name}`);
                return false;
            }
            buf = gif;
            fileExt = "gif";
        } else if (buf.length > MAX_BYTES) {
            const animated = ext === "webp";
            buf = await sharp(buf, { animated })
                .resize(MAX_SIDE, MAX_SIDE, { fit: "inside", withoutEnlargement: true })
                .webp({ quality: 85 })
                .toBuffer();
            fileExt = "webp";
        }

        let width = isVideo ? 0 : attachment.width ?? 0;
        let height = isVideo ? 0 : attachment.height ?? 0;
        try {
            const meta = await sharp(buf, { animated: true }).metadata();
            width = meta.width ?? width;
            height = meta.pageHeight ?? meta.height ?? height;
        } catch { /* Maße von Discord reichen */ }

        const file = `${attachment.id}.${fileExt}`;
        await this.writeAtomic(file, buf);
        const sendFile = await this.writeSmall(attachment.id, buf, fileExt);

        const baseName = stickerName(message, attachment);
        this.stickers.set(attachment.id, {
            id: attachment.id,
            messageId: message.id,
            name: baseName,
            baseName,
            file,
            sendFile,
            width,
            height,
            size: buf.length,
            author: message.member?.displayName ?? message.author?.globalName ?? message.author?.username ?? "",
            createdAt: message.createdTimestamp,
        });
        this.changed();
        return true;
    }

    async writeAtomic(file, buf) {
        const tmp = path.join(this.filesDir, file + ".tmp");
        await writeFile(tmp, buf);
        await rename(tmp, path.join(this.filesDir, file));
    }

    /** Legt <id>.s.<ext> an; bei Fehler sendet das Plugin das Original */
    async writeSmall(id, buf, ext) {
        try {
            const sendFile = `${id}.s.${ext}`;
            await this.writeAtomic(sendFile, await makeSmall(buf, ext));
            return sendFile;
        } catch (e) {
            console.error(`Kleine Version ${id}:`, e.message);
            return undefined;
        }
    }

    /** Für ältere Einträge die kleine Sende-Version nachträglich erzeugen */
    async backfillSmall() {
        let n = 0;
        for (const s of this.stickers.values()) {
            if (s.sendFile) continue;
            const buf = await readFile(path.join(this.filesDir, s.file)).catch(() => null);
            if (!buf) continue;
            s.sendFile = await this.writeSmall(s.id, buf, s.file.split(".").pop());
            if (s.sendFile) n++;
        }
        if (n) {
            console.log(`Kleine Versionen nachgezogen: ${n}`);
            this.changed();
        }
    }

    /** Original-Nachricht bearbeitet: Grundname neu (eine Antwort-Benennung geht weiter vor) */
    updateName(messageId, message) {
        let touched = false;
        for (const id of this.idsOfMessage(messageId)) {
            const s = this.stickers.get(id);
            if (!message.content?.trim()) continue;
            s.baseName = stickerName(message, { name: s.file });
            touched = this.recomputeName(s) || touched;
        }
        if (touched) this.changed();
    }

    /**
     * Antwort auf ein Sticker-Bild = neuer Name. Jede Antwort wird gemerkt;
     * es gilt die neueste. Wird sie gelöscht, gilt wieder die davor (oder der Grundname).
     * @returns true, wenn die Antwort zu einem Sticker gehört
     */
    nameByReply(targetMessageId, reply) {
        const ids = this.idsOfMessage(targetMessageId);
        if (!ids.length) return false;
        const text = cleanText(reply.content);
        let touched = false;
        for (const id of ids) {
            const s = this.stickers.get(id);
            s.names = (s.names ?? []).filter(n => n.id !== reply.id);
            if (text) s.names.push({ id: reply.id, at: reply.createdTimestamp, text: text.slice(0, 60) });
            touched = this.recomputeName(s) || touched;
        }
        if (touched) this.changed();
        return true;
    }

    /** Antwort gelöscht → ihren Namen zurücknehmen */
    dropReply(replyId) {
        let touched = false;
        for (const s of this.stickers.values()) {
            if (!s.names?.some(n => n.id === replyId)) continue;
            s.names = s.names.filter(n => n.id !== replyId);
            this.recomputeName(s);
            touched = true;
        }
        if (touched) this.changed();
    }

    /** Beim Abgleich: Namen aus Antworten entfernen, die es nicht mehr gibt */
    pruneReplies(existingIds) {
        let touched = false;
        for (const s of this.stickers.values()) {
            if (!s.names?.length) continue;
            const kept = s.names.filter(n => existingIds.has(n.id));
            if (kept.length === s.names.length) continue;
            s.names = kept;
            this.recomputeName(s);
            touched = true;
        }
        if (touched) this.changed();
    }

    recomputeName(s) {
        s.baseName ??= s.name;
        const latest = (s.names ?? []).reduce((a, b) => (!a || b.at >= a.at ? b : a), null);
        const name = latest?.text ?? s.baseName;
        if (s.name === name) return false;
        s.name = name;
        return true;
    }

    /** Ein Plugin-Nutzer hat den Sticker gesendet → für „Beliebt“ mitzählen */
    use(id) {
        const s = this.stickers.get(id);
        if (!s) return false;
        s.uses = (s.uses ?? 0) + 1;
        this.changed();
        return true;
    }

    async remove(id) {
        const s = this.stickers.get(id);
        if (!s) return;
        this.stickers.delete(id);
        await rm(path.join(this.filesDir, s.file), { force: true });
        if (s.sendFile) await rm(path.join(this.filesDir, s.sendFile), { force: true });
        this.changed();
    }

    changed() {
        this.version = Date.now();
        clearTimeout(this.saveTimer);
        this.saveTimer = setTimeout(() => this.save().catch(e => console.error("Speichern:", e)), 500);
    }

    async save() {
        const tmp = this.jsonPath + ".tmp";
        await writeFile(tmp, JSON.stringify(this.list(), null, 1));
        await rename(tmp, this.jsonPath);
    }
}

/** Text ohne Custom-Emojis, Erwähnungen und Links */
export function cleanText(content) {
    return (content ?? "").replace(/<a?:\w+:\d+>|<@[!&]?\d+>|<#\d+>|https?:\/\/\S+/g, "").replace(/\s+/g, " ").trim();
}

function stickerName(message, attachment) {
    const text = cleanText(message.content);
    if (text) return text.slice(0, 60);
    return (attachment.name ?? "Sticker").replace(/\.[^.]+$/, "").replace(/[_-]+/g, " ").slice(0, 60);
}
