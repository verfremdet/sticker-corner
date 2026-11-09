/*
 * Ticket helper – 🎱 Ticket Bingo for the team.
 * 16 typical ticket moments ("found you on Disboard", "I'm 18 I swear", "a friend invited me" …).
 * Fields tick themselves when the ticket creator writes something that fits; click a field to tick it by hand.
 * A full row, column or diagonal = BINGO with confetti. Only on your PC, nothing is posted.
 */

import { classNameFactory } from "@utils/css";
import { MessageStore, useEffect, useState, useStateFromStores } from "@webpack/common";

import { lang } from "../i18n";
import { play, preloadSounds } from "../sounds";
import { Confetti, useMoment } from "./extras";

const cl = classNameFactory("vc-sct-");

interface Field { id: string; en: string; de: string; test(texts: string[]): boolean; }

const any = (re: RegExp) => (texts: string[]) => texts.some(t => re.test(t));
const EMOJI_RE = /\p{Extended_Pictographic}/gu;

/** Disboard is always on the board – the most common answer of all */
const DISBOARD: Field = { id: "disboard", en: "Found us on Disboard", de: "Über Disboard gefunden", test: any(/disboard/i) };

const POOL: Field[] = [
    { id: "friend", en: "A friend invited me", de: "Ein Freund hat mich eingeladen", test: any(/\b(friend|freund|kumpel|buddy|bestie)\b|invited by|eingeladen/i) },
    { id: "swear", en: "I'm 18, I swear", de: "Bin 18, schwöre", test: any(/\bswear\b|schw[öo]r|on god|\bfr fr\b|i'?m (really |actually )?1[89]\b|bin (wirklich )?1[89]\b/i) },
    { id: "friends", en: "Just looking for friends", de: "Suche nur Freunde", test: any(/(new |neue )?(friends|freunde) (to|zum|finden|find)|looking for (friends|people)|suche (freunde|leute)/i) },
    { id: "bored", en: "I'm bored", de: "Mir ist langweilig", test: any(/bored|langweil/i) },
    { id: "idk", en: "idk", de: "keine Ahnung", test: any(/\bidk\b|\bkp\b|keine ahnung|i (don'?t|dont) know|wei[sß] nicht/i) },
    { id: "hi", en: "Just \"hi\"", de: "Nur „hi“", test: any(/^\s*(hi+|hey+|hello|hallo|moin|yo|helo)\s*[!.:)3]*\s*$/i) },
    { id: "oneword", en: "One-word answer", de: "Ein-Wort-Antwort", test: any(/^\s*[\p{L}']{2,}\s*[.!?]?\s*$/u) },
    { id: "mic", en: "No mic", de: "Kein Mikro", test: any(/no mic|kein mi[ck]|mic (is )?broken|can'?t talk|kann nicht reden/i) },
    { id: "newdc", en: "New to Discord", de: "Neu auf Discord", test: any(/new (to|on) discord|neu (auf|bei|in) discord|first server|erster server/i) },
    { id: "english", en: "Sorry for my English", de: "Sorry für mein Englisch", test: any(/(bad|my) english|sorry for (my )?english|schlechtes? englisch/i) },
    { id: "please", en: "Pls let me in", de: "Bitte lass mich rein", test: any(/let me in|accept me|pls|plz|lass mich rein|bitte rein/i) },
    { id: "lol", en: "lol / xd", de: "lol / xd", test: any(/\b(lol|xd+|lmao|haha+)\b/i) },
    { id: "askback", en: "Asks back how old WE are", de: "Fragt zurück, wie alt WIR sind", test: any(/how old are (you|u|yall|you guys)|wie alt (bist|seid)/i) },
    { id: "about", en: "What's this server about?", de: "Worum geht's hier?", test: any(/what('?s| is) (this|the) server|worum geht|was ist das (hier )?f[üu]r|what do you (guys )?do here/i) },
    { id: "games", en: "Names a game", de: "Nennt ein Game", test: any(/\b(valorant|fortnite|minecraft|roblox|cod|gta|league|lol ranked|cs2?|apex|overwatch|genshin)\b/i) },
    { id: "emojis", en: "3+ emojis at once", de: "3+ Emojis auf einmal", test: texts => texts.some(t => (t.match(EMOJI_RE)?.length ?? 0) >= 3 || (t.match(/<a?:\w+:\d+>/g)?.length ?? 0) >= 3) },
    { id: "uwu", en: "uwu / :3", de: "uwu / :3", test: any(/uwu|owo|:3\b|>w</i) },
    { id: "tiktok", en: "Mentions TikTok", de: "Erwähnt TikTok", test: any(/tiktok|tik tok/i) },
    { id: "novel", en: "Writes a whole novel", de: "Schreibt einen Roman", test: texts => texts.some(t => t.length > 280) },
    { id: "night", en: "Can't sleep", de: "Kann nicht schlafen", test: any(/can'?t sleep|kann nicht schlafen|insomnia|3 ?am|nachts wach/i) },
];

/** same board for everyone in the team for a ticket: seeded by the ticket id */
function boardFor(ticketId: string): Field[] {
    let seed = 0;
    for (const c of ticketId) seed = (seed * 31 + c.charCodeAt(0)) >>> 0;
    const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 2 ** 32; };
    const pool = [...POOL];
    for (let i = pool.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [pool[i], pool[j]] = [pool[j], pool[i]]; }
    const board = pool.slice(0, 15);
    board.splice(Math.floor(rnd() * 16), 0, DISBOARD);
    return board;
}

const LINES = [
    [0, 1, 2, 3], [4, 5, 6, 7], [8, 9, 10, 11], [12, 13, 14, 15],
    [0, 4, 8, 12], [1, 5, 9, 13], [2, 6, 10, 14], [3, 7, 11, 15],
    [0, 5, 10, 15], [3, 6, 9, 12],
];

const manual = new Map<string, Set<string>>(); // ticketId → ticked by hand (this session)

export function useBingo(ticketId: string, creatorId: string | null) {
    const texts = useStateFromStores([MessageStore], () =>
        creatorId
            ? ((MessageStore.getMessages(ticketId) as any)?._array as any[] ?? []).filter(m => m.author?.id === creatorId).map(m => String(m.content ?? ""))
            : [],
    undefined, (a: string[], b: string[]) => a.length === b.length && a.every((x, i) => x === b[i]));
    const [, force] = useState(0);
    const board = boardFor(ticketId);
    const hand = manual.get(ticketId) ?? new Set<string>();
    const auto = new Set(board.filter(f => f.test(texts)).map(f => f.id));
    const ticked = board.map(f => auto.has(f.id) || hand.has(f.id));
    const lines = LINES.filter(l => l.every(i => ticked[i]));
    const toggle = (id: string) => {
        if (auto.has(id)) return;
        const set = new Set(hand);
        set.has(id) ? set.delete(id) : set.add(id);
        manual.set(ticketId, set);
        force(n => n + 1);
    };
    return { board, ticked, auto, lines, count: ticked.filter(Boolean).length, toggle };
}

export function BingoBoard({ bingo }: { bingo: ReturnType<typeof useBingo>; }) {
    const de = lang() === "de";
    const { board, ticked, auto, lines, toggle } = bingo;
    useEffect(() => preloadSounds("jackpot", "cheer", "win"), []);
    const party = useMoment(lines.length > 0, () => { play("jackpot", 0.8); setTimeout(() => play("cheer", 0.7), 160); });
    const won = new Set(lines.flat());

    return (
        <div className={cl("bingo", party && "bingo-party")}>
            {party && <Confetti />}
            {lines.length > 0 && <div className={cl("bingo-banner")}>BINGO{lines.length > 1 ? ` ×${lines.length}` : ""}!</div>}
            <div className={cl("bingo-grid")}>
                {board.map((f, i) => (
                    <button
                        key={f.id}
                        className={cl("bingo-cell", ticked[i] && "bingo-on", won.has(i) && "bingo-won", f.id === "disboard" && "bingo-star")}
                        onClick={() => toggle(f.id)}
                        title={auto.has(f.id) ? (de ? "Steht so im Ticket" : "Written in the ticket") : (de ? "Klicken zum Abhaken" : "Click to tick")}
                    >
                        {de ? f.de : f.en}
                    </button>
                ))}
            </div>
        </div>
    );
}
