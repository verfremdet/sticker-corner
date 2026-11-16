// Sticker Corner – "do we have this one already?"
// Fingerprint = aspect ratio + difference hash (64 bits) of the first AND the middle frame.
// Two images count as the same only if both frames match closely, so GIFs that start with
// the same black frame are not mixed up.
import { execFile as execFileCb } from "node:child_process";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import sharp from "sharp";

const execFile = promisify(execFileCb);

/**
 * max. differing bits (of 64). Measured on 162 stickers + 41 stolen lobby GIFs (15.11.2026):
 * the same picture re-encoded (mp4 → gif) differs by 0–6 bits in the first frame,
 * different stickers by 9 or more. The middle frame is less reliable (timing), so it only
 * decides when the first frame is plain (black/one colour – many GIFs start like that).
 */
const MAX_BITS = 6;
const MAX_BITS_MID = 8;
/** aspect ratio may differ by this much (scaling rounds sizes) */
const MAX_RATIO = 0.04;
/** store.js turns videos into GIFs of at most 15 s */
const VIDEO_CAP_MS = 15_000;

/** 9×8 grey thumbnail → 64 bits as 16 hex chars */
async function dhash(img) {
    const px = await sharp(img).flatten({ background: "#000" }).greyscale().resize(9, 8, { fit: "fill" }).raw().toBuffer();
    let hex = "";
    for (let y = 0; y < 8; y++) {
        let byte = 0;
        for (let x = 0; x < 8; x++) byte = (byte << 1) | (px[y * 9 + x] > px[y * 9 + x + 1] ? 1 : 0);
        hex += byte.toString(16).padStart(2, "0");
    }
    return hex;
}

async function videoFrames(buf) {
    const dir = await mkdtemp(path.join(os.tmpdir(), "fp-"));
    try {
        const src = path.join(dir, "in");
        await writeFile(src, buf);
        let duration = 0;
        try {
            const { stdout } = await execFile("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", src], { timeout: 30_000 });
            duration = Number(stdout.trim()) || 0;
        } catch { /* first frame only */ }
        await execFile("ffmpeg", ["-y", "-v", "error", "-i", src, "-frames:v", "1", path.join(dir, "a.png")], { timeout: 60_000 });
        if (duration > 0.2) {
            // the corner keeps at most the first 15 s of a video (store.js) → middle of that part
            await execFile("ffmpeg", ["-y", "-v", "error", "-ss", String(Math.min(duration, VIDEO_CAP_MS / 1000) / 2), "-i", src, "-frames:v", "1", path.join(dir, "b.png")], { timeout: 60_000 }).catch(() => {});
        }
        const files = (await readdir(dir)).filter(f => f.endsWith(".png")).sort();
        const frames = await Promise.all(files.map(f => readFile(path.join(dir, f))));
        const meta = await sharp(frames[0]).metadata();
        return { frames: frames.length > 1 ? frames : [frames[0], frames[0]], width: meta.width, height: meta.height };
    } finally {
        await rm(dir, { recursive: true, force: true });
    }
}

async function imageFrames(buf) {
    const meta = await sharp(buf, { animated: true }).metadata();
    const pages = meta.pages ?? 1;
    const first = await sharp(buf, { page: 0, pages: 1 }).png().toBuffer();
    // middle by time, not by frame count (GIF encoders merge equal frames into longer ones)
    let page = Math.floor(pages / 2);
    const delays = Array.isArray(meta.delay) && meta.delay.length === pages ? meta.delay.map(d => d > 10 ? d : 100) : null;
    if (delays) {
        const half = Math.min(delays.reduce((a, b) => a + b, 0), VIDEO_CAP_MS) / 2;
        let t = 0;
        for (page = 0; page < pages - 1 && t + delays[page] <= half; page++) t += delays[page];
    }
    const mid = pages > 1 ? await sharp(buf, { page, pages: 1 }).png().toBuffer() : first;
    return { frames: [first, mid], width: meta.width, height: meta.pageHeight ?? meta.height };
}

/**
 * @param {Buffer} buf image or video file
 * @param {boolean} isVideo
 * @returns {Promise<{ r: number, h: string[] }>} r = width/height, h = [first, middle] hashes
 */
export async function fingerprint(buf, isVideo) {
    const { frames, width, height } = isVideo ? await videoFrames(buf) : await imageFrames(buf);
    const h = await Promise.all(frames.map(dhash));
    return { r: Math.round((width / Math.max(1, height)) * 1000) / 1000, h };
}

const bits = (a, b) => {
    let n = 0;
    for (let i = 0; i < a.length; i += 2) {
        let x = parseInt(a.slice(i, i + 2), 16) ^ parseInt(b.slice(i, i + 2), 16);
        while (x) { n += x & 1; x >>= 1; }
    }
    return n;
};

/** Looks the same (1:1, maybe re-encoded or scaled)? */
export function same(a, b) {
    if (!a?.h || !b?.h || a.h.length !== b.h.length) return false;
    if (Math.abs(a.r - b.r) > MAX_RATIO * Math.max(a.r, b.r)) return false;
    if (bits(a.h[0], b.h[0]) > MAX_BITS) return false;
    const plain = h => { const n = bits(h, "0000000000000000"); return n < 6 || n > 58; };
    return !(plain(a.h[0]) || plain(b.h[0])) || bits(a.h[1], b.h[1]) <= MAX_BITS_MID;
}
