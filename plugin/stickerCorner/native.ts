/*
 * Sticker Corner – läuft im Hauptprozess von Discord.
 * 1. Erlaubt dem Plugin, Liste und Bilder vom Sticker-Server zu laden (Content-Security-Policy).
 * 2. Update-Knopf: holt das Plugin aus dem öffentlichen GitHub-Repo und baut Vencord neu.
 *    Quelle ist fest eingetragen (REPO) – es wird nie Code von woanders geladen.
 */

import { CspPolicies, ImageSrc } from "@main/csp";
import { execFile as cpExecFile } from "child_process";
import { IpcMainInvokeEvent } from "electron";
import { cp, rm, stat } from "fs/promises";
import { join } from "path";
import { promisify } from "util";

// Nur diese beiden Adressen darf das Plugin laden – sonst nichts.
CspPolicies["stickers.verfremdet.com"] = ImageSrc;
CspPolicies["stickers.finalstate.de"] = ImageSrc;

const REPO = "https://github.com/verfremdet/sticker-corner";
const execFile = promisify(cpExecFile);

// Wie Vencords eigener Updater: dist/ liegt im Vencord-Quellordner
const VENCORD_DIR = join(__dirname, "..");
const PLUGIN_DIR = join(VENCORD_DIR, "src", "userplugins", "stickerCorner");
const REPO_DIR = join(VENCORD_DIR, "..", "sticker-corner");

// „Zu Sticker Corner hinzufügen“: Bild aus Discord laden (nur Discord-/Tenor-Adressen, max. 10 MB)
const MEDIA_HOSTS = /^(cdn\.discordapp\.com|media\.discordapp\.net|images-ext-\d+\.discordapp\.net|media\.tenor\.com)$/;
const MEDIA_MAX = 10 * 1024 * 1024;

export async function fetchMedia(_: IpcMainInvokeEvent, url: string): Promise<{ data?: Uint8Array; type?: string; error?: "host" | "size" | "http"; }> {
    let u: URL;
    try { u = new URL(url); } catch { return { error: "host" }; }
    if (u.protocol !== "https:" || !MEDIA_HOSTS.test(u.hostname)) return { error: "host" };
    const res = await fetch(u);
    if (!res.ok) return { error: "http" };
    if (Number(res.headers.get("content-length") ?? 0) > MEDIA_MAX) return { error: "size" };
    const data = new Uint8Array(await res.arrayBuffer());
    if (data.length > MEDIA_MAX) return { error: "size" };
    return { data, type: (res.headers.get("content-type") ?? "").split(";")[0] };
}

const exists = (p: string) => stat(p).then(() => true, () => false);
const git = (...args: string[]) => execFile("git", args, { cwd: REPO_DIR, windowsHide: true });

export async function update(_: IpcMainInvokeEvent): Promise<{ ok: boolean; error?: string; }> {
    try {
        if (!await exists(PLUGIN_DIR))
            return { ok: false, error: "Diese Installation wurde nicht mit dem Sticker-Corner-Installer gemacht. Bitte den Installer nochmal ausführen." };

        // 1. Plugin-Code von GitHub holen (eigener Klon neben Vencord)
        if (await exists(join(REPO_DIR, ".git"))) {
            const origin = (await git("remote", "get-url", "origin")).stdout.trim().replace(/\.git$/, "");
            if (origin !== REPO) return { ok: false, error: `Unerwartete Quelle: ${origin}` };
            await git("fetch", "--depth", "1", "origin", "main");
            await git("reset", "--hard", "origin/main");
        } else {
            await execFile("git", ["clone", "--depth", "1", REPO, REPO_DIR], { windowsHide: true });
        }

        const source = join(REPO_DIR, "plugin", "stickerCorner");
        if (!await exists(join(source, "index.tsx"))) return { ok: false, error: "Plugin im Repo nicht gefunden" };

        // 2. Plugin austauschen
        await rm(PLUGIN_DIR, { recursive: true, force: true });
        await cp(source, PLUGIN_DIR, { recursive: true });

        // 3. Vencord neu bauen (wie Vencords Updater)
        const res = await execFile("node", ["scripts/build/build.mjs"], { cwd: VENCORD_DIR, windowsHide: true });
        if (res.stderr.includes("Build failed")) return { ok: false, error: "Bauen fehlgeschlagen" };

        return { ok: true };
    } catch (e: any) {
        return { ok: false, error: String(e?.message ?? e).slice(0, 300) };
    }
}
