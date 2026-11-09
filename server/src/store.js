// Sticker-Liste: hält alle Sticker im Speicher, speichert sie als stickers.json
// und legt die Bilddateien in DATA_DIR/files ab.
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";

// Discord erlaubt ohne Nitro 10 MB je Upload. Etwas Luft lassen.
const MAX_BYTES = 9.5 * 1024 * 1024;
const MAX_SIDE = 1024;

const EXT_BY_TYPE = {
    "image/png": "png",
    "image/jpeg": "jpg",
    "image/gif": "gif",
    "image/webp": "webp",
};

export const TYPE_BY_EXT = Object.fromEntries(Object.entries(EXT_BY_TYPE).map(([t, e]) => [e, t]));

export function imageExt(attachment) {
    const byType = EXT_BY_TYPE[(attachment.contentType ?? "").split(";")[0]];
    if (byType) return byType;
    const m = /\.(png|jpe?g|gif|webp)$/i.exec(attachment.name ?? "");
    if (!m) return null;
    return m[1].toLowerCase() === "jpeg" ? "jpg" : m[1].toLowerCase();
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
        return { version: this.version, stickers };
    }

    has(id) {
        return this.stickers.has(id);
    }

    idsOfMessage(messageId) {
        return [...this.stickers.values()].filter(s => s.messageId === messageId).map(s => s.id);
    }

    /** Lädt das Bild herunter, verkleinert es bei Bedarf und trägt es ein. */
    async add({ attachment, message }) {
        const ext = imageExt(attachment);
        if (!ext || this.stickers.has(attachment.id)) return false;

        const res = await fetch(attachment.url);
        if (!res.ok) throw new Error(`Download ${attachment.id}: HTTP ${res.status}`);
        let buf = Buffer.from(await res.arrayBuffer());
        let fileExt = ext;

        if (buf.length > MAX_BYTES) {
            const animated = ext === "gif" || ext === "webp";
            buf = await sharp(buf, { animated })
                .resize(MAX_SIDE, MAX_SIDE, { fit: "inside", withoutEnlargement: true })
                .webp({ quality: 85 })
                .toBuffer();
            fileExt = "webp";
        }

        let width = attachment.width ?? 0;
        let height = attachment.height ?? 0;
        try {
            const meta = await sharp(buf, { animated: true }).metadata();
            width = meta.width ?? width;
            height = meta.pageHeight ?? meta.height ?? height;
        } catch { /* Maße von Discord reichen */ }

        const file = `${attachment.id}.${fileExt}`;
        const tmp = path.join(this.filesDir, file + ".tmp");
        await writeFile(tmp, buf);
        await rename(tmp, path.join(this.filesDir, file));

        this.stickers.set(attachment.id, {
            id: attachment.id,
            messageId: message.id,
            name: stickerName(message, attachment),
            file,
            width,
            height,
            size: buf.length,
            author: message.member?.displayName ?? message.author?.globalName ?? message.author?.username ?? "",
            createdAt: message.createdTimestamp,
        });
        this.changed();
        return true;
    }

    updateName(messageId, message) {
        let touched = false;
        for (const id of this.idsOfMessage(messageId)) {
            const s = this.stickers.get(id);
            const name = stickerName(message, { name: s.file });
            if (message.content?.trim() && s.name !== name) {
                s.name = name;
                touched = true;
            }
        }
        if (touched) this.changed();
    }

    async remove(id) {
        const s = this.stickers.get(id);
        if (!s) return;
        this.stickers.delete(id);
        await rm(path.join(this.filesDir, s.file), { force: true });
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

function stickerName(message, attachment) {
    const text = (message.content ?? "").replace(/<a?:\w+:\d+>|https?:\/\/\S+/g, "").trim();
    if (text) return text.slice(0, 60);
    return (attachment.name ?? "Sticker").replace(/\.[^.]+$/, "").replace(/[_-]+/g, " ").slice(0, 60);
}
