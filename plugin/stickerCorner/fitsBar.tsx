/*
 * Sticker Corner – ✨ "Fits right now" as a slim bar right above the message box, in every chat.
 * Updates when new messages come in. Drag the top edge to make it bigger/smaller,
 * click the title to fold it, ✕ hides it in this chat (the picker can show it again).
 */

import * as DataStore from "@api/DataStore";
import { Channel } from "@vencord/discord-types";
import { FluxDispatcher, useEffect, useRef, useState } from "@webpack/common";

import { lang, t } from "./i18n";
import { settings } from "./settings";
import { cl } from "./StickerCorner";
import { myCount, prepareSticker, sendSticker, smallUrl, useStickers } from "./store";
import { favoriteGifs, isCounterMoment, Suggestion, suggest } from "./suggest";
import { sendMessage } from "@utils/discord";

const KEY = "StickerCorner_fitsBar";
const MIN = 34, MAX = 120;

interface BarState { size: number; collapsed: boolean; hidden: Record<string, true>; }
let state: BarState = { size: 56, collapsed: false, hidden: {} };
const listeners = new Set<() => void>();
DataStore.get<BarState>(KEY).then(s => { if (s) { state = { ...state, ...s }; listeners.forEach(l => l()); } });

function update(patch: Partial<BarState>) {
    state = { ...state, ...patch };
    listeners.forEach(l => l());
    DataStore.set(KEY, state);
}

export const isBarHidden = (channelId: string) => !!state.hidden[channelId];
export function setBarHidden(channelId: string, hidden: boolean) {
    const h = { ...state.hidden };
    if (hidden) h[channelId] = true; else delete h[channelId];
    update({ hidden: h });
}

function useBarState() {
    const [, force] = useState(0);
    useEffect(() => {
        const l = () => force(n => n + 1);
        listeners.add(l);
        return () => void listeners.delete(l);
    }, []);
    return state;
}

const de = () => lang() === "de";

export function FitsBar({ channel }: { channel: Channel; }) {
    const bar = useBarState();
    const { stickers, loaded } = useStickers();
    const [fits, setFits] = useState<Suggestion[]>([]);
    const [counter, setCounter] = useState(false);
    const [tick, setTick] = useState(0);
    const [peek, setPeek] = useState<{ f: Suggestion; x: number; } | null>(null);
    const barRef = useRef<HTMLDivElement>(null);

    // new message in this chat → think again (a little later, the store needs a moment)
    useEffect(() => {
        let timer: ReturnType<typeof setTimeout> | undefined;
        const onMsg = ({ channelId, message, optimistic }: any) => {
            if (optimistic || (channelId ?? message?.channel_id) !== channel.id) return;
            clearTimeout(timer);
            timer = setTimeout(() => setTick(n => n + 1), 500);
        };
        FluxDispatcher.subscribe("MESSAGE_CREATE", onMsg);
        return () => { clearTimeout(timer); FluxDispatcher.unsubscribe("MESSAGE_CREATE", onMsg); };
    }, [channel.id]);

    useEffect(() => {
        if (!loaded || !stickers.length) return;
        setFits(suggest(channel.id, stickers, favoriteGifs(), myCount, 10));
        setCounter(isCounterMoment(channel.id));
    }, [loaded, stickers.length, channel.id, tick]);

    // drag the top edge: up = bigger, down = smaller
    const drag = useRef<{ y: number; size: number; } | null>(null);
    const onDown = (e: React.PointerEvent) => {
        drag.current = { y: e.clientY, size: bar.size };
        (e.target as HTMLElement).setPointerCapture(e.pointerId);
    };
    const onMove = (e: React.PointerEvent) => {
        if (!drag.current) return;
        const size = Math.round(Math.min(MAX, Math.max(MIN, drag.current.size + (drag.current.y - e.clientY))));
        if (size !== state.size) { state = { ...state, size }; listeners.forEach(l => l()); }
    };
    const onUp = () => { if (drag.current) { drag.current = null; update({ size: state.size }); } };

    if (!settings.store.fitsBar || bar.hidden[channel.id] || !fits.length) return null;

    const send = (f: Suggestion) => {
        if (f.sticker) sendSticker(f.sticker, channel.id);
        else if (f.gif) sendMessage(channel.id, { content: f.gif.url });
        setTimeout(() => setTick(n => n + 1), 300);
    };

    return (
        <div ref={barRef} className={cl("fb", bar.collapsed && "fb-collapsed")} onMouseLeave={() => setPeek(null)} style={{ ["--fb-size" as any]: `${bar.size}px` }}>
            {!bar.collapsed && (
                <div
                    className={cl("fb-grip")}
                    onPointerDown={onDown}
                    onPointerMove={onMove}
                    onPointerUp={onUp}
                    onPointerCancel={onUp}
                    title={de() ? "Ziehen: größer / kleiner" : "Drag: bigger / smaller"}
                />
            )}
            <div className={cl("fb-head")}>
                <button className={cl("fb-title")} onClick={() => update({ collapsed: !bar.collapsed })}>
                    <span className={cl("fb-arrow")}>{bar.collapsed ? "▸" : "▾"}</span>
                    {counter ? <span className={cl("fb-counter")}>⚔️ {de() ? "Konter!" : "Counter!"}</span> : t("fitsNow")}
                    {bar.collapsed && <span className={cl("fb-count")}>{fits.length}</span>}
                </button>
                <button
                    className={cl("fb-close")}
                    onClick={() => setBarHidden(channel.id, true)}
                    title={de() ? "In diesem Chat ausblenden (im Sticker-Fenster wieder einschaltbar)" : "Hide in this chat (turn it back on in the sticker window)"}
                >✕</button>
            </div>
            {!bar.collapsed && (
                <div className={cl("fb-row")}>
                    {fits.map(f => (
                        <button
                            key={f.key}
                            className={cl("fb-item")}
                            onClick={() => send(f)}
                            onMouseEnter={e => {
                                if (f.sticker) prepareSticker(f.sticker, channel.id);
                                const b = barRef.current?.getBoundingClientRect();
                                const r = e.currentTarget.getBoundingClientRect();
                                if (!b) return;
                                // keep the big preview inside the bar's width
                                const x = Math.min(b.width - 100, Math.max(100, r.left - b.left + r.width / 2));
                                setPeek({ f, x });
                            }}
                            onMouseLeave={() => setPeek(null)}
                        >
                            {f.sticker
                                ? <img src={smallUrl(f.sticker)} alt={f.sticker.name} draggable={false} />
                                : f.gif!.video
                                    ? <video src={f.gif!.src} autoPlay loop muted playsInline />
                                    : <img src={f.gif!.src} alt="GIF" draggable={false} />}
                            {f.gif && <span className={cl("gif-badge")}>GIF</span>}
                        </button>
                    ))}
                </div>
            )}
            {peek && !bar.collapsed && (
                <div key={peek.f.key} className={cl("fb-peek")} style={{ left: peek.x }} aria-hidden="true">
                    {peek.f.sticker
                        ? <img src={smallUrl(peek.f.sticker)} alt="" />
                        : peek.f.gif!.video
                            ? <video src={peek.f.gif!.src} autoPlay loop muted playsInline />
                            : <img src={peek.f.gif!.src} alt="" />}
                    {peek.f.sticker?.name && <div className={cl("fb-peek-name")}>{peek.f.sticker.name}</div>}
                </div>
            )}
        </div>
    );
}
