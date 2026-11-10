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
import { homedir } from "os";
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

/*
 * macOS/Linux: Aus dem Dock gestartet kennt Discord nur /usr/bin:/bin – node aus Homebrew, nvm
 * oder Volta wird dann nicht gefunden ("spawn node ENOENT"). Darum: PATH der Login-Shell holen
 * und die üblichen Ordner anhängen.
 */
let toolEnv: Promise<NodeJS.ProcessEnv> | undefined;
function getEnv() {
    return toolEnv ??= (async () => {
        if (process.platform === "win32") return process.env;
        let shellPath = "";
        try {
            const { stdout } = await execFile(process.env.SHELL || "/bin/zsh",
                ["-ilc", 'printf "\\n__SC__%s__SC__\\n" "$PATH"'], { timeout: 8000 });
            shellPath = /__SC__(.*?)__SC__/.exec(stdout)?.[1] ?? "";
        } catch { /* Shell antwortet nicht – die festen Ordner unten reichen meist */ }
        const home = homedir();
        const dirs = ["/opt/homebrew/bin", "/usr/local/bin", join(home, ".volta", "bin"), join(home, ".local", "bin"), "/usr/bin", "/bin"];
        return { ...process.env, PATH: [shellPath, process.env.PATH, ...dirs].filter(Boolean).join(":") };
    })();
}

const run = async (cmd: string, args: string[], cwd?: string) =>
    execFile(cmd, args, { cwd, windowsHide: true, env: await getEnv(), maxBuffer: 16 * 1024 * 1024 });
const git = (...args: string[]) => run("git", args, REPO_DIR);

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
            await run("git", ["clone", "--depth", "1", REPO, REPO_DIR]);
        }

        const source = join(REPO_DIR, "plugin", "stickerCorner");
        if (!await exists(join(source, "index.tsx"))) return { ok: false, error: "Plugin im Repo nicht gefunden" };

        // 2. Plugin austauschen
        await rm(PLUGIN_DIR, { recursive: true, force: true });
        await cp(source, PLUGIN_DIR, { recursive: true });

        // 3. Vencord neu bauen (wie Vencords Updater)
        const res = await run("node", ["scripts/build/build.mjs"], VENCORD_DIR);
        if (res.stderr.includes("Build failed")) return { ok: false, error: "Bauen fehlgeschlagen" };

        return { ok: true };
    } catch (e: any) {
        if (e?.code === "ENOENT")
            return { ok: false, error: `„${e.path ?? "git/node"}“ wurde nicht gefunden. Bitte den Installationsbefehl nochmal ausführen.` };
        return { ok: false, error: String(e?.message ?? e).slice(0, 300) };
    }
}
