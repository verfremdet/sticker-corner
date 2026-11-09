/*
 * Sticker Corner – 🎰 Sticker Slots: three reels full of stickers, pull the lever,
 * the sticker on the middle line wins (three of a kind = JACKPOT). Then send it or spin again.
 * Quiet casino sounds (Kenney, CC0), lights, motion blur, bouncy stops.
 */

import { useEffect, useRef, useState } from "@webpack/common";

import { t } from "./i18n";
import { cl } from "./StickerCorner";
import { play, preloadSounds } from "./sounds";
import { prepareSticker, smallUrl, Sticker } from "./store";
import { Confetti } from "./tickets/extras";

const ROW = 76;            // height of one symbol
const STRIP = 28;          // symbols per reel strip
const STOP_AFTER = [1300, 1750, 2250]; // ms until reel 1/2/3 stops

/** The prize: the sticker that came up two or three times, otherwise the middle one */
const prizeOf = (w: Sticker[]) => w.find(x => w.filter(y => y.id === x.id).length >= 2) ?? w[1];

type Result = "none" | "pair" | "jackpot";

function pick<T>(list: T[]): T {
    return list[Math.floor(Math.random() * list.length)];
}

/** Reel strips: random symbols, the winning one at index STRIP-2 (middle line when stopped) */
function buildStrips(pool: Sticker[]): { strips: Sticker[][]; winners: Sticker[]; } {
    // just for fun, so plenty of luck: 30 % three of a kind, 40 % two of a kind, otherwise three different
    const r = Math.random();
    const a = pick(pool);
    let winners: Sticker[];
    if (r < 0.3 || pool.length < 2) winners = [a, a, a];
    else {
        const others = pool.filter(s => s.id !== a.id);
        const b = pick(others);
        if (r < 0.7) {
            winners = [a, a, b];
            winners.sort(() => Math.random() - 0.5); // pair can be anywhere
        } else {
            const c = pick(others.filter(s => s.id !== b.id).length ? others.filter(s => s.id !== b.id) : others);
            winners = [a, b, c];
        }
    }
    const strips = winners.map(w => {
        const s = Array.from({ length: STRIP }, () => pick(pool));
        s[STRIP - 2] = w;
        return s;
    });
    return { strips, winners };
}

export function SlotMachine({ stickers, favorites, channelId, onSend, onClose }: {
    stickers: Sticker[];
    favorites: Sticker[];
    channelId: string;
    onSend(s: Sticker): void;
    onClose(): void;
}) {
    // every sticker can come up (new ones too); favorites a little more often
    const [pool] = useState(() => [...stickers, ...favorites]);
    const [{ strips, winners }, setSpin] = useState(() => buildStrips(pool));
    const [spinning, setSpinning] = useState(false);
    const [stopped, setStopped] = useState([true, true, true]);
    const [result, setResult] = useState<Result | null>(null);
    const [lever, setLever] = useState(false);
    const [round, setRound] = useState(0);
    const timers = useRef<ReturnType<typeof setTimeout>[]>([]);

    useEffect(() => {
        preloadSounds("lever", "tick", "reel-stop", "win", "jackpot", "cheer");
        return () => timers.current.forEach(clearTimeout);
    }, []);

    const later = (ms: number, fn: () => void) => timers.current.push(setTimeout(fn, ms));

    const spin = () => {
        if (spinning || pool.length === 0) return;
        const next = buildStrips(pool);
        setSpin(next);
        setResult(null);
        setLever(true);
        setRound(r => r + 1);
        play("lever", 0.8);
        later(220, () => setLever(false));

        // the winner is known now → upload it already, so "send" is instant
        prepareSticker(prizeOf(next.winners), channelId);

        later(60, () => {
            setSpinning(true);
            setStopped([false, false, false]);
            // ticks that slow down like a real reel
            let delay = 55;
            let at = 0;
            while (at < STOP_AFTER[2] - 150) {
                const when = at;
                later(when, () => play("tick", 0.35, 0.9 + Math.random() * 0.25));
                at += delay;
                delay = Math.min(delay * 1.07, 210);
            }
            STOP_AFTER.forEach((ms, i) => later(ms, () => {
                setStopped(s => s.map((v, j) => j === i ? true : v));
                play("reel-stop", 0.8, 0.95 + i * 0.06);
            }));
            later(STOP_AFTER[2] + 120, () => {
                setSpinning(false);
                const [a, b, c] = next.winners.map(w => w.id);
                const r: Result = a === b && b === c ? "jackpot" : a === b || b === c || a === c ? "pair" : "none";
                setResult(r);
                if (r === "jackpot") { play("jackpot", 0.9); later(150, () => play("cheer", 0.8)); later(380, () => play("win", 0.7)); }
                else if (r === "pair") play("win", 0.7);
            });
        });
    };

    // first spin right away – that's the fun part
    useEffect(() => { spin(); }, []);

    const winner = prizeOf(winners);
    const resultText = result === "jackpot" ? t("slotJackpot") : result === "pair" ? t("slotPair") : result === "none" ? t("slotWin") : t("slotSpinning");

    return (
        <div className={cl("slot-overlay")} onClick={e => { if (e.target === e.currentTarget && !spinning) onClose(); }}>
            <div className={cl("slot", spinning && "slot-spinning", result === "jackpot" && "slot-jackpot")}>
                {result === "jackpot" && <Confetti key={round} />}
                {["top", "bottom"].map(side => (
                    <div key={side} className={cl("slot-lights", `slot-lights-${side}`)} aria-hidden="true">
                        {Array.from({ length: 12 }, (_, i) => <i key={i} />)}
                    </div>
                ))}
                <div className={cl("slot-title")}>STICKER SLOTS</div>

                <div className={cl("slot-body")}>
                    <div className={cl("slot-window")}>
                        {strips.map((strip, i) => (
                            <div key={i} className={cl("slot-reel")}>
                                <div
                                    key={`${round}-${i}`}
                                    className={cl("slot-strip", !stopped[i] && "slot-strip-blur")}
                                    style={{
                                        transform: `translateY(${-(STRIP - 3) * ROW}px)`,
                                        animationDuration: `${STOP_AFTER[i]}ms`,
                                        ["--slot-from" as any]: "0px",
                                        ["--slot-to" as any]: `${-(STRIP - 3) * ROW}px`,
                                    }}
                                >
                                    {strip.map((s, j) => (
                                        <div key={j} className={cl("slot-symbol")}>
                                            <img src={smallUrl(s)} alt="" draggable={false} />
                                        </div>
                                    ))}
                                </div>
                            </div>
                        ))}
                        <div className={cl("slot-payline")} aria-hidden="true" />
                    </div>

                    <button className={cl("slot-lever", lever && "slot-lever-pulled")} onClick={spin} disabled={spinning} aria-label={t("slotSpin")}>
                        <span className={cl("slot-lever-stick")} />
                        <span className={cl("slot-lever-ball")} />
                    </button>
                </div>

                <div className={cl("slot-result", result && `slot-result-${result}`)}>
                    {resultText}{result && winner ? <b> {winner.name || "Sticker"}</b> : null}
                </div>

                <div className={cl("slot-actions")}>
                    <button className={cl("slot-btn", "slot-btn-spin")} onClick={spin} disabled={spinning}>🎰 {t("slotSpin")}</button>
                    <button className={cl("slot-btn", "slot-btn-send")} onClick={() => winner && onSend(winner)} disabled={spinning || !result}>
                        {t("slotSend")}
                    </button>
                    <button className={cl("slot-btn", "slot-btn-close")} onClick={onClose} disabled={spinning}>✕</button>
                </div>
            </div>
        </div>
    );
}
