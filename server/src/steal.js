// Sticker Corner – copies popular lobby GIFs into the sticker channel ("stealing").
// Run by hand on the server:  node --env-file=.env src/steal.js [--dry] [--min=2]
// Takes the GIFs from brain.json (written by the running service), skips the ones that look like
// a sticker that is already there (image fingerprint), and posts the rest silently as the bot.
// The running service picks them up like any other post (files named "lobby__…", tag #lobby).
import { execFile as execFileCb } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { REST, Routes } from "discord.js";
import sharp from "sharp";
import { gifWords } from "./tokens.js";

const execFile = promisify(execFileCb);
const { DISCORD_TOKEN, CHANNEL_ID } = process.env;
const DATA_DIR = process.env.DATA_DIR ?? path.resolve("data");
const DRY = process.argv.includes("--dry");
const MIN = Number(process.argv.find(a => a.startsWith("--min="))?.slice(6) ?? 2);
const MAX_BYTES = 10 * 1024 * 1024;
const DISCORD_FILE_RE = /^https:\/\/(?:cdn|media)\.discordapp\.(?:com|net)\/attachments\//;

/** difference hash of the first frame: 64 bits as 0/1 string */
async function dhash(buf, isVideo) {
    let img = buf;
    if (isVideo) {
        const dir = await mkdtemp(path.join(os.tmpdir(), "steal-"));
        try {
            await writeFile(path.join(dir, "in"), buf);
            await execFile("ffmpeg", ["-y", "-v", "error", "-i", path.join(dir, "in"), "-frames:v", "1", path.join(dir, "f.png")], { timeout: 60_000 });
            img = await readFile(path.join(dir, "f.png"));
        } finally {
            await rm(dir, { recursive: true, force: true });
        }
    }
    const px = await sharp(img, { pages: 1 }).greyscale().resize(9, 8, { fit: "fill" }).raw().toBuffer();
    let bits = "";
    for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) bits += px[y * 9 + x] > px[y * 9 + x + 1] ? "1" : "0";
    return bits;
}
const distance = (a, b) => [...a].reduce((n, c, i) => n + (c !== b[i] ? 1 : 0), 0);

function nameOf(it) {
    try {
        const u = new URL(it.url);
        const n = u.searchParams.get("name");
        if (n) return n.slice(0, 40);
    } catch { /* plain words below */ }
    const words = [...new Set((it.name ? it.name.replace(/\.[^.]+$/, "") : gifWords(it.url)).split(/[\s_-]+/)
        .filter(w => /^[a-zäöü]{2,}$/i.test(w) && !/^(gif|tiktok|on|the|cecesgif)$/i.test(w)))];
    return words.slice(0, 4).join(" ") || "lobby gif";
}

const brain = JSON.parse(await readFile(path.join(DATA_DIR, "brain.json"), "utf8"));
const stolenPath = path.join(DATA_DIR, "stolen.json");
const stolen = JSON.parse(await readFile(stolenPath, "utf8").catch(() => "{}"));
const corner = JSON.parse(await readFile(path.join(DATA_DIR, "stickers.json"), "utf8"));

// fingerprints of everything that is already in the corner
const known = [];
for (const s of corner.stickers ?? []) {
    try { known.push({ id: s.id, hash: await dhash(await readFile(path.join(DATA_DIR, "files", s.file)), false) }); } catch { /* skip */ }
}
console.log(`${known.length} Sticker im Corner, ${brain.items.length} GIFs aus den Lobbys`);

const candidates = brain.items
    .filter(it => !stolen[it.key])
    // used at least MIN times or by 2 people; Discord files always (their links expire, so only usable as a sticker)
    .filter(it => it.n >= MIN || it.people >= 2 || DISCORD_FILE_RE.test(it.url))
    .sort((a, b) => b.n - a.n);

const rest = DRY ? null : new REST({ version: "10" }).setToken(DISCORD_TOKEN);
let posted = 0, dupes = 0, failed = 0;
for (const it of candidates) {
    try {
        const res = await fetch(it.media);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const type = (res.headers.get("content-type") ?? "").split(";")[0];
        const buf = Buffer.from(await res.arrayBuffer());
        if (buf.length > MAX_BYTES) throw new Error("zu groß");
        const isVideo = type.startsWith("video/");
        const ext = isVideo ? (type.includes("webm") ? "webm" : "mp4") : ({ "image/gif": "gif", "image/png": "png", "image/webp": "webp", "image/jpeg": "jpg" })[type];
        if (!ext) throw new Error(`Typ ${type}`);
        const hash = await dhash(buf, isVideo);
        const same = known.find(k => distance(k.hash, hash) <= 10);
        if (same) {
            // already in the corner → its lobby examples now point to that sticker
            dupes++;
            console.log(`= schon da: ${it.url}`);
            if (!DRY && same.id) { stolen[it.key] = same.id; await writeFile(stolenPath, JSON.stringify(stolen, null, 1)); }
            continue;
        }
        known.push({ hash });
        const name = nameOf(it);
        console.log(`${DRY ? "würde klauen" : "+"} ${it.n}× ${name}  (${it.url})`);
        if (DRY) { posted++; continue; }
        const file = `lobby__${name.replace(/[^\p{L}\p{N}]+/gu, "_").slice(0, 40)}.${ext}`;
        const msg = await rest.post(Routes.channelMessages(CHANNEL_ID), {
            body: { content: `${name} #lobby`, flags: 4096, allowed_mentions: { parse: [] } },
            files: [{ name: file, data: buf, contentType: type }],
        });
        stolen[it.key] = msg.attachments?.[0]?.id;
        known[known.length - 1].id = stolen[it.key];
        await writeFile(stolenPath, JSON.stringify(stolen, null, 1));
        posted++;
        await new Promise(r => setTimeout(r, 1500));
    } catch (e) {
        failed++;
        console.log(`! ${it.url}: ${e.message}`);
    }
}
console.log(`Fertig: ${posted} ${DRY ? "würden geklaut" : "geklaut"}, ${dupes} schon im Corner, ${failed} Fehler`);
