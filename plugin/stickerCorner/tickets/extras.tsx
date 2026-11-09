/*
 * Ticket helper extras: profile line (age, account, joined, mutual servers), vibe-check dice,
 * confetti when everyone voted "in", sound + shake when someone votes "troll".
 */

import { classNameFactory } from "@utils/css";
import { Constants, GuildMemberStore, MessageStore, RestAPI, SnowflakeUtils, useEffect, useRef, useState, useStateFromStores } from "@webpack/common";

import { lang } from "../i18n";
import { play, preloadSounds } from "../sounds";
import { ageOn, findAge } from "./age";
import { GUILD_ID, VIBE_QUESTIONS } from "./config";

const cl = classNameFactory("vc-sct-");
const de = () => lang() === "de";

// ── time spans like "3 J." / "2 Tage" / "5 h" ──────────────────────────
function span(ms: number): string {
    const d = de();
    const h = ms / 3_600_000, days = h / 24, years = days / 365.25, months = days / 30.44;
    if (years >= 1) return d ? `${Math.floor(years)} J.` : `${Math.floor(years)} y`;
    if (months >= 1) return d ? `${Math.floor(months)} Mon.` : `${Math.floor(months)} mo`;
    if (days >= 1) return d ? `${Math.floor(days)} ${Math.floor(days) === 1 ? "Tag" : "Tage"}` : `${Math.floor(days)} d`;
    return `${Math.max(1, Math.floor(h))} h`;
}

// mutual servers come from the profile – fetched once per person
const mutualCache = new Map<string, Promise<number | null>>();
function mutualGuilds(userId: string): Promise<number | null> {
    let p = mutualCache.get(userId);
    if (!p) {
        p = RestAPI.get({ url: Constants.Endpoints.USER_PROFILE(userId), query: { with_mutual_guilds: true, guild_id: GUILD_ID } })
            .then(r => Array.isArray(r.body?.mutual_guilds) ? r.body.mutual_guilds.filter((g: any) => g.id !== GUILD_ID).length : null)
            .catch(() => null);
        mutualCache.set(userId, p);
    }
    return p;
}

/** One line with the most important facts about the person who opened the ticket */
export function CreatorInfo({ channelId, creatorId }: { channelId: string; creatorId: string; }) {
    const texts = useStateFromStores([MessageStore], () =>
        ((MessageStore.getMessages(channelId) as any)?._array as any[] ?? [])
            .filter(m => m.author?.id === creatorId).map(m => String(m.content ?? "")),
    undefined, (a: string[], b: string[]) => a.length === b.length && a.every((x, i) => x === b[i]));
    const age = findAge(texts);

    const created = SnowflakeUtils.extractTimestamp(creatorId);
    const joinedAt = GuildMemberStore.getMember(GUILD_ID, creatorId)?.joinedAt;
    const joined = joinedAt ? new Date(joinedAt).getTime() : null;
    const [mutual, setMutual] = useState<number | null>(null);
    useEffect(() => { mutualGuilds(creatorId).then(setMutual); }, [creatorId]);

    const now = Date.now();
    const newAccount = now - created < 30 * 86_400_000;
    const ageText = age
        ? (age.min === age.max ? `${age.min}` : `${age.min}–${age.max}`) + (de() ? " Jahre" : " y/o")
        : null;
    const ageLevel = !age ? "open" : age.max < 16 ? "bad" : age.min < 18 ? "warn" : "good";
    const birthday = age?.date && ageOn(age.date) !== ageOn(age.date, new Date(now - 86_400_000));

    return (
        <div className={cl("info")}>
            <span className={cl("fact", `fact-${ageLevel}`)} title={age ? `${de() ? "Gefunden" : "Found"}: ${age.source}` : undefined}>
                🎂 {ageText ?? (de() ? "Alter fehlt" : "no age yet")}{birthday ? " 🎉" : ""}
            </span>
            <span className={cl("fact", newAccount && "fact-bad")} title={new Date(created).toLocaleString()}>
                🪪 {de() ? "Account" : "account"} {span(now - created)}{newAccount ? " ⚠" : ""}
            </span>
            {joined && (
                <span className={cl("fact")} title={new Date(joined).toLocaleString()}>
                    📥 {de() ? "hier seit" : "joined"} {span(now - joined)}
                </span>
            )}
            {mutual != null && (
                <span className={cl("fact")}>
                    🤝 {mutual} {de() ? (mutual === 1 ? "gemeinsamer Server" : "gemeinsame Server") : (mutual === 1 ? "mutual server" : "mutual servers")}
                </span>
            )}
        </div>
    );
}

/** 🎲 rolls a random, slightly absurd vibe question; the result can be sent with one click */
export function VibeDice({ onSend }: { onSend(text: string): void; }) {
    const [question, setQuestion] = useState<string | null>(null);
    const [rolling, setRolling] = useState(false);
    useEffect(() => preloadSounds("dice-shake", "dice-throw"), []);

    const roll = () => {
        if (rolling) return;
        setRolling(true);
        play("dice-shake", 0.8);
        let n = 0;
        const timer = setInterval(() => {
            setQuestion(VIBE_QUESTIONS[Math.floor(Math.random() * VIBE_QUESTIONS.length)]);
            if (++n >= 9) {
                clearInterval(timer);
                setRolling(false);
                play("dice-throw", 0.9);
            }
        }, 70);
    };

    return (
        <>
            <button className={cl("dice", rolling && "dice-rolling")} onClick={roll} title={de() ? "Zufällige Vibe-Frage" : "Random vibe question"}>
                🎲 Vibe-Check
            </button>
            {question && (
                <button className={cl("dice-result", rolling && "dice-result-rolling")} disabled={rolling} onClick={() => { onSend(question); setQuestion(null); }}>
                    {question} <span className={cl("dice-send")}>↵</span>
                </button>
            )}
        </>
    );
}

/** Confetti burst (pure CSS) */
export function Confetti() {
    const colors = ["#23a55a", "#f0b232", "#a77bff", "#f23f43", "#00a8fc", "#ffffff"];
    const pieces = Array.from({ length: 36 }, (_, i) => ({
        left: Math.random() * 100,
        delay: Math.random() * 0.25,
        dur: 0.9 + Math.random() * 0.7,
        rot: Math.random() * 720 - 360,
        drift: Math.random() * 80 - 40,
        color: colors[i % colors.length],
    }));
    return (
        <div className={cl("confetti")} aria-hidden="true">
            {pieces.map((p, i) => (
                <i
                    key={i}
                    style={{
                        left: `${p.left}%`,
                        background: p.color,
                        animationDelay: `${p.delay}s`,
                        animationDuration: `${p.dur}s`,
                        ["--rot" as any]: `${p.rot}deg`,
                        ["--drift" as any]: `${p.drift}px`,
                    }}
                />
            ))}
        </div>
    );
}

/** Returns true for ~2 s after `value` switched from false to true (not on first render) */
export function useMoment(value: boolean, onStart?: () => void): boolean {
    const prev = useRef<boolean | null>(null);
    const [active, setActive] = useState(false);
    useEffect(() => {
        if (prev.current === false && value) {
            setActive(true);
            onStart?.();
            const t = setTimeout(() => setActive(false), 2200);
            prev.current = value;
            return () => clearTimeout(t);
        }
        prev.current = value;
    }, [value]);
    return active;
}
