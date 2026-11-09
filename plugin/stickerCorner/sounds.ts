/*
 * Sticker Corner – short, quiet sounds (real recordings by Kenney, CC0) from the sticker server.
 * Loaded once, played through WebAudio; can be switched off in the plugin settings.
 */

import { settings } from "./settings";

export type SoundName =
    "tick" | "reel-stop" | "lever" | "win" | "jackpot" | "cheer" | "dice-shake" | "dice-throw" | "troll" | "troll-hit";

let ctx: AudioContext | null = null;
const buffers = new Map<SoundName, Promise<AudioBuffer | null>>();

const baseUrl = () => settings.store.serverUrl.replace(/\/+$/, "");

function load(name: SoundName): Promise<AudioBuffer | null> {
    let p = buffers.get(name);
    if (!p) {
        p = fetch(`${baseUrl()}/sounds/${name}.ogg`)
            .then(r => r.ok ? r.arrayBuffer() : Promise.reject(r.status))
            .then(b => (ctx ??= new AudioContext()).decodeAudioData(b))
            .catch(() => { buffers.delete(name); return null; });
        buffers.set(name, p);
    }
    return p;
}

/** Load sounds ahead so the first play has no delay */
export const preloadSounds = (...names: SoundName[]) => { if (settings.store.sounds) names.forEach(load); };

/** Plays a sound quietly. volume 0–1 on top of the setting; rate = pitch/speed variation */
export async function play(name: SoundName, volume = 1, rate = 1) {
    if (!settings.store.sounds) return;
    const buf = await load(name);
    if (!buf || !ctx) return;
    if (ctx.state === "suspended") await ctx.resume().catch(() => { });
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.playbackRate.value = rate;
    const gain = ctx.createGain();
    gain.gain.value = 0.35 * volume * (settings.store.soundVolume / 100);
    src.connect(gain).connect(ctx.destination);
    src.start();
}
