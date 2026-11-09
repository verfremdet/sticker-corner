/*
 * Ticket helper – bar above the message box in ticket channels (team only).
 * Top: votes "in" (cya, verfremdet, x8one), "troll", instant ban.
 * Bottom: suggestions to send with one click; the pencil rewrites a text just for you.
 */

import { classNameFactory } from "@utils/css";
import { sendMessage } from "@utils/discord";
import { Channel } from "@vencord/discord-types";
import { Alerts, GuildMemberStore, MessageStore, RestAPI, showToast, useEffect, useReducer, useRef, useState, UserStore, useStateFromStores } from "@webpack/common";

import { lang } from "../i18n";
import { findSticker, prepareSticker, sendSticker } from "../store";
import { play, preloadSounds } from "../sounds";
import { GATEKEEPERS, GREET_STICKER_RE, GREET_TEXT, GUILD_ID, VISIBLE_SUGGESTIONS } from "./config";
import { BingoBoard, useBingo } from "./bingo";
import { Confetti, CreatorInfo, useMoment, VibeDice } from "./extras";
import { chatFor, creatorOf, isApproved, isChatOpen, isTeamMember, loadVotes, markSeen, sendChat, setChatOpen, setText, subscribe, suggestions, Tally, tallyFor, toggleVote, unreadFor, voteChannel, VoteKind } from "./store";

const cl = classNameFactory("vc-sct-");

const TEXT = {
    en: {
        ticket: "Ticket", greet: "GIF + mhm mhm", in: "In", out: "Out", troll: "Troll", ban: "Ban",
        noVoteChannel: "Create a team-only text channel named #ticket-votes to vote.",
        trollBanner: "TROLL THEM", approved: "Everyone's in – welcome texts below",
        banTitle: "Ban {name}?", banBody: "{name} is banned right away. Their messages stay.", banConfirm: "Ban now",
        banned: "{name} banned", banFailed: "Ban failed: {e}", sendFailed: "Couldn't send",
        edit: "Edit for yourself", reset: "Back to default", noCreator: "Couldn't find who opened the ticket",
        stickerMissing: "Sticker “mhm…” not found in Sticker Corner",
        chat: "Team", chatOpen: "Open team chat", chatClose: "Hide team chat", chatEmpty: "No messages yet – only the team sees this.", chatPlaceholder: "Message the team about this ticket …",
    },
    de: {
        ticket: "Ticket", greet: "GIF + mhm mhm", in: "Rein", out: "Raus", troll: "Troll", ban: "Bann",
        noVoteChannel: "Leg einen Textkanal #ticket-votes nur fürs Team an, dann geht Abstimmen.",
        trollBanner: "TROLLT DEN", approved: "Alle sind dafür – Willkommens-Texte unten",
        banTitle: "{name} bannen?", banBody: "{name} wird sofort gebannt. Die Nachrichten bleiben.", banConfirm: "Jetzt bannen",
        banned: "{name} gebannt", banFailed: "Bann fehlgeschlagen: {e}", sendFailed: "Senden fehlgeschlagen",
        edit: "Für dich bearbeiten", reset: "Zurück zum Standard", noCreator: "Ticket-Ersteller nicht gefunden",
        stickerMissing: "Sticker „mhm…“ in Sticker Corner nicht gefunden",
        chat: "Team", chatOpen: "Team-Chat öffnen", chatClose: "Team-Chat einklappen", chatEmpty: "Noch nichts geschrieben – nur das Team sieht das.", chatPlaceholder: "Ans Team zu diesem Ticket schreiben …",
    },
};
type Key = keyof typeof TEXT.en;
const tt = (k: Key, vars: Record<string, string> = {}) =>
    TEXT[lang()][k].replace(/\{(\w+)\}/g, (_, v) => vars[v] ?? "");

function nameOf(userId: string) {
    const member = GuildMemberStore.getMember(GUILD_ID, userId);
    const user = UserStore.getUser(userId);
    return member?.nick ?? (user as any)?.globalName ?? user?.username ?? "?";
}

const wordsOf = (s: string) => new Set(s.toLowerCase().split(/[^\p{L}\p{N}']+/u).filter(w => w.length > 1));

/** Same or similar text: contains it, or at least 60 % of the suggestion's words appear in the message */
function similar(message: string, suggestion: string): boolean {
    const m = message.toLowerCase().trim(), s = suggestion.toLowerCase().trim();
    if (!m || !s) return false;
    if (m.includes(s) || (m.length > 12 && s.includes(m))) return true;
    const sw = wordsOf(s), mw = wordsOf(m);
    if (!sw.size) return false;
    let hit = 0;
    for (const w of sw) if (mw.has(w)) hit++;
    return hit / sw.size >= 0.6;
}

function PencilIcon() {
    return (
        <svg width="14" height="14" viewBox="0 0 24 24" aria-hidden="true">
            <path fill="currentColor" d="M14.7 3.3a2.4 2.4 0 0 1 3.4 0l2.6 2.6a2.4 2.4 0 0 1 0 3.4L9.4 20.6a2 2 0 0 1-1 .55l-4.3.95a.9.9 0 0 1-1.07-1.07l.95-4.3a2 2 0 0 1 .55-1zM13.3 7.1 5.9 14.5l-.6 2.9.3.3 2.9-.6 7.4-7.4z" />
        </svg>
    );
}

function SuggestionChip({ id, text, edited, onSend }: { id: string; text: string; edited: boolean; onSend(text: string): void; }) {
    const [editing, setEditing] = useState(false);
    const [draft, setDraft] = useState(text);

    if (editing) {
        const save = () => { setText(id, draft); setEditing(false); };
        return (
            <div className={cl("chip", "chip-editing")}>
                <input
                    className={cl("edit")}
                    autoFocus
                    value={draft}
                    maxLength={500}
                    onChange={e => setDraft(e.currentTarget.value)}
                    onKeyDown={e => {
                        e.stopPropagation();
                        if (e.key === "Enter") save();
                        if (e.key === "Escape") { setDraft(text); setEditing(false); }
                    }}
                    onBlur={save}
                />
                {edited && (
                    <button className={cl("icon")} title={tt("reset")} onMouseDown={e => { e.preventDefault(); setText(id, ""); setEditing(false); }}>↺</button>
                )}
            </div>
        );
    }

    return (
        <div className={cl("chip", edited && "chip-edited")}>
            <button className={cl("chip-send")} onClick={() => onSend(text)} title={text}>{text}</button>
            <button className={cl("icon")} title={tt("edit")} onClick={() => { setDraft(text); setEditing(true); }}>
                <PencilIcon />
            </button>
        </div>
    );
}

function VoteButton({ kind, voters, mine, onClick, children }: { kind: VoteKind; voters: string[]; mine: boolean; onClick(): void; children: React.ReactNode; }) {
    return (
        <button
            className={cl("vote", `vote-${kind}`, mine && "vote-mine")}
            onClick={onClick}
            title={voters.map(nameOf).join(", ")}
        >
            {children}
        </button>
    );
}

/**
 * Who voted what: cya, verfremdet, x8one always first and always visible (green = in, red = out, grey = not yet),
 * everyone else from the team as "+2 ✓" / "+1 ✕" (names on hover).
 */
function Voters({ tally }: { tally: Tally; }) {
    const gateIds = GATEKEEPERS.map(g => g.id);
    const otherIn = tally.in.filter(id => !gateIds.includes(id));
    const otherOut = tally.out.filter(id => !gateIds.includes(id));
    const state = (id: string) => tally.in.includes(id) ? "yes" : tally.out.includes(id) ? "no" : "open";
    return (
        <span className={cl("voters")}>
            {GATEKEEPERS.map(g => {
                const s = state(g.id);
                return (
                    <span key={g.id} className={cl("gate", `gate-${s}`)} title={`${g.name}: ${s === "yes" ? tt("in") : s === "no" ? tt("out") : "–"}`}>
                        <span className={cl("gate-mark")}>{s === "yes" ? "✓" : s === "no" ? "✕" : "·"}</span>{g.name}
                    </span>
                );
            })}
            {otherIn.length > 0 && <span className={cl("more", "more-yes")} title={otherIn.map(nameOf).join(", ")}>+{otherIn.length} ✓</span>}
            {otherOut.length > 0 && <span className={cl("more", "more-no")} title={otherOut.map(nameOf).join(", ")}>+{otherOut.length} ✕</span>}
        </span>
    );
}

/** Team chat about this ticket – only the team sees it (messages live in #ticket-votes) */
function TeamChat({ ticketId }: { ticketId: string; }) {
    const msgs = chatFor(ticketId);
    const [draft, setDraft] = useState("");
    const [sending, setSending] = useState(false);
    const listRef = useRef<HTMLDivElement>(null);
    const me = UserStore.getCurrentUser()?.id;
    const newest = msgs[msgs.length - 1]?.messageId;

    // open = read: remember the newest message, keep the list scrolled to the bottom
    useEffect(() => {
        if (newest) markSeen(ticketId, newest);
        const el = listRef.current;
        if (el) el.scrollTop = el.scrollHeight;
    }, [newest, ticketId]);

    const submit = async () => {
        if (!draft.trim() || sending) return;
        setSending(true);
        try {
            if (await sendChat(ticketId, draft)) setDraft("");
        } catch {
            showToast({ text: tt("sendFailed"), variant: "critical" });
        }
        setSending(false);
    };

    return (
        <div className={cl("chat")}>
            <div className={cl("chat-list")} ref={listRef}>
                {msgs.length === 0 && <div className={cl("chat-empty")}>{tt("chatEmpty")}</div>}
                {msgs.map(m => (
                    <div key={m.messageId} className={cl("chat-msg", m.userId === me && "chat-mine")}>
                        <span className={cl("chat-author")}>{nameOf(m.userId)}</span>
                        <span className={cl("chat-time")}>{timeOf(m.messageId)}</span>
                        <div className={cl("chat-text")}>{m.text}</div>
                    </div>
                ))}
            </div>
            <input
                className={cl("chat-input")}
                value={draft}
                maxLength={1800}
                placeholder={tt("chatPlaceholder")}
                onChange={e => setDraft(e.currentTarget.value)}
                onKeyDown={e => {
                    e.stopPropagation(); // keep Discord's own message box out of it
                    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); submit(); }
                }}
            />
        </div>
    );
}

function timeOf(snowflake: string) {
    const ms = Number(BigInt(snowflake) >> 22n) + 1420070400000;
    return new Date(ms).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

export function TicketBar({ channel }: { channel: Channel; }) {
    const [, rerender] = useReducer((n: number) => n + 1, 0);
    useEffect(() => { loadVotes(); return subscribe(rerender); }, []);

    const me = UserStore.getCurrentUser()?.id;
    const creatorId = creatorOf(channel);
    // Greeting until someone from the team has written in this ticket
    // Everything the team has written in this ticket (for the greeting and to hide what was already asked)
    const teamTexts = useStateFromStores([MessageStore], () =>
        ((MessageStore.getMessages(channel.id) as any)?._array as any[] ?? [])
            .filter(m => !m.author?.bot && isTeamMember(m.author.id))
            .map(m => String(m.content ?? "")),
    undefined, (a: string[], b: string[]) => a.length === b.length && a.every((x, i) => x === b[i]));
    const teamWrote = teamTexts.length > 0;

    // Upload the greeting GIF ahead of time so the click sends instantly
    useEffect(() => {
        if (teamWrote) return;
        const sticker = findSticker(s => GREET_STICKER_RE.test(s.name));
        if (sticker) prepareSticker(sticker, channel.id);
    }, [channel.id, teamWrote]);

    const tally = tallyFor(channel.id);
    const chatOpen = isChatOpen();
    const unread = unreadFor(channel.id);
    const approved = isApproved(tally);
    const hasVoteChannel = !!voteChannel();
    const [busy, setBusy] = useState(false);
    const bingo = useBingo(channel.id, creatorId);
    const [bingoOpen, setBingoOpen] = useState(false);

    const vote = async (kind: VoteKind) => {
        if (busy) return;
        setBusy(true);
        try { await toggleVote(channel.id, kind); } catch { showToast({ text: tt("sendFailed"), variant: "critical" }); }
        setBusy(false);
    };

    const send = (content: string) => {
        try { sendMessage(channel.id, { content }); } catch { showToast({ text: tt("sendFailed"), variant: "critical" }); }
    };

    const greet = async () => {
        const sticker = findSticker(s => GREET_STICKER_RE.test(s.name));
        if (!sticker) { showToast({ text: tt("stickerMissing"), variant: "critical" }); return; }
        if (await sendSticker(sticker, channel.id)) send(GREET_TEXT);
    };

    const ban = async () => {
        if (!creatorId) { showToast({ text: tt("noCreator"), variant: "critical" }); return; }
        const name = nameOf(creatorId);
        const ok = await Alerts.confirm({
            title: tt("banTitle", { name }),
            body: tt("banBody", { name }),
            confirmText: tt("banConfirm"),
            confirmColor: "red",
        });
        if (!ok) return;
        try {
            await RestAPI.put({ url: `/guilds/${GUILD_ID}/bans/${creatorId}`, body: { delete_message_seconds: 0 } });
            showToast({ text: tt("banned", { name }), variant: "success" });
            if (hasVoteChannel) toggleVote(channel.id, "ban").catch(() => { });
        } catch (e: any) {
            showToast({ text: tt("banFailed", { e: e?.body?.message ?? String(e?.status ?? e) }), variant: "critical" });
        }
    };

    // Moments: everyone voted "in" → confetti + cheer; first troll vote → bong + shake
    useEffect(() => preloadSounds("cheer", "jackpot", "troll", "troll-hit"), []);
    const celebrating = useMoment(approved, () => { play("cheer", 0.9); setTimeout(() => play("jackpot", 0.7), 180); });
    const trolled = useMoment(tally.troll.length > 0, () => { play("troll", 0.9); setTimeout(() => play("troll-hit", 0.6), 250); });

    const phase = approved ? "welcome" : "vibe";
    // Hide every group from which someone already sent this or a similar question; show the next ones instead
    const all = suggestions();
    const usedGroups = new Set(all.filter(s => teamTexts.some(m =>
        similar(m, s.text) || (s.keys ?? []).some(k => m.toLowerCase().includes(k))
    )).map(s => s.group));
    const open = all.filter(s => s.phase === phase && !usedGroups.has(s.group) && (!s.after || usedGroups.has(s.after)));
    // follow-ups (e.g. the explanation right after the question) come first
    const chips = [...open.filter(s => s.after), ...open.filter(s => !s.after)].slice(0, VISIBLE_SUGGESTIONS);

    return (
        <div className={cl("bar", celebrating && "bar-party")}>
            {celebrating && <Confetti />}
            {tally.troll.length > 0 && (
                <div className={cl("troll", trolled && "troll-shake")} title={tally.troll.map(nameOf).join(", ")}>
                    <span className={cl("troll-text")}>{tt("trollBanner")}</span>
                    <span className={cl("troll-who")}>{tally.troll.map(nameOf).join(" · ")}</span>
                </div>
            )}

            <div className={cl("row")}>
                <span className={cl("label")}>
                    {tt("ticket")}{creatorId ? ` · ${nameOf(creatorId)}` : ""}
                </span>
                {hasVoteChannel ? (
                    <>
                        <div className={cl("poll")}>
                            <VoteButton kind="in" voters={tally.in} mine={!!me && tally.in.includes(me)} onClick={() => vote("in")}>
                                ✓ {tt("in")}
                            </VoteButton>
                            <VoteButton kind="out" voters={tally.out} mine={!!me && tally.out.includes(me)} onClick={() => vote("out")}>
                                ✕ {tt("out")}
                            </VoteButton>
                            <Voters tally={tally} />
                        </div>
                        <VoteButton kind="troll" voters={tally.troll} mine={!!me && tally.troll.includes(me)} onClick={() => vote("troll")}>
                            {tt("troll")}{tally.troll.length > 0 && <span className={cl("count")}>{tally.troll.length}</span>}
                        </VoteButton>
                    </>
                ) : (
                    <span className={cl("hint")}>{tt("noVoteChannel")}</span>
                )}
                {hasVoteChannel && (
                    <button
                        className={cl("chat-toggle", chatOpen && "chat-toggle-open")}
                        onClick={() => setChatOpen(!chatOpen)}
                        title={chatOpen ? tt("chatClose") : tt("chatOpen")}
                    >
                        💬 {tt("chat")}
                        {!chatOpen && unread > 0 && <span className={cl("badge")}>{unread}</span>}
                    </button>
                )}
                <button
                    className={cl("chat-toggle", bingoOpen && "chat-toggle-open", bingo.lines.length > 0 && "bingo-toggle-won")}
                    onClick={() => setBingoOpen(!bingoOpen)}
                    title="Ticket Bingo"
                >
                    🎱 {bingo.lines.length > 0 ? "BINGO" : `${bingo.count}/16`}
                </button>
                <button className={cl("ban")} onClick={ban} disabled={!creatorId}>{tt("ban")}</button>
            </div>

            {creatorId && <CreatorInfo channelId={channel.id} creatorId={creatorId} />}

            {hasVoteChannel && chatOpen && <TeamChat ticketId={channel.id} />}

            {bingoOpen && <BingoBoard bingo={bingo} />}

            {approved && <div className={cl("approved", celebrating && "approved-pop")}>{tt("approved")}</div>}

            <div className={cl("chips")}>
                {!teamWrote && !approved && (
                    <button className={cl("greet")} onClick={greet}>{tt("greet")}</button>
                )}
                {!approved && <VibeDice onSend={send} />}
                {chips.map(s => <SuggestionChip key={s.id + s.text} id={s.id} text={s.text} edited={s.edited} onSend={send} />)}
            </div>
        </div>
    );
}
