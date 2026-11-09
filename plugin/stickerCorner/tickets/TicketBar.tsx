/*
 * Ticket helper – bar above the message box in ticket channels (team only).
 * Top: votes "in" (cya, verfremdet, x8one), "troll", instant ban.
 * Bottom: suggestions to send with one click; the pencil rewrites a text just for you.
 */

import { classNameFactory } from "@utils/css";
import { sendMessage } from "@utils/discord";
import { Channel } from "@vencord/discord-types";
import { Alerts, GuildMemberStore, MessageStore, RestAPI, showToast, useEffect, useReducer, useState, UserStore, useStateFromStores } from "@webpack/common";

import { lang } from "../i18n";
import { findSticker, prepareSticker, sendSticker } from "../store";
import { GATEKEEPERS, GREET_STICKER_RE, GREET_TEXT, GUILD_ID } from "./config";
import { creatorOf, isApproved, isTeamMember, loadVotes, setText, subscribe, suggestions, tallyFor, toggleVote, voteChannel, VoteKind } from "./store";

const cl = classNameFactory("vc-sct-");

const TEXT = {
    en: {
        ticket: "Ticket", greet: "GIF + mhm mhm", in: "In", troll: "Troll", ban: "Ban",
        noVoteChannel: "Create a team-only text channel named #ticket-votes to vote.",
        trollBanner: "TROLL THEM", approved: "Everyone's in – welcome texts below",
        banTitle: "Ban {name}?", banBody: "{name} is banned right away. Their messages stay.", banConfirm: "Ban now",
        banned: "{name} banned", banFailed: "Ban failed: {e}", sendFailed: "Couldn't send",
        edit: "Edit for yourself", reset: "Back to default", noCreator: "Couldn't find who opened the ticket",
        stickerMissing: "Sticker “mhm…” not found in Sticker Corner",
    },
    de: {
        ticket: "Ticket", greet: "GIF + mhm mhm", in: "Rein", troll: "Troll", ban: "Bann",
        noVoteChannel: "Leg einen Textkanal #ticket-votes nur fürs Team an, dann geht Abstimmen.",
        trollBanner: "TROLLT DEN", approved: "Alle sind dafür – Willkommens-Texte unten",
        banTitle: "{name} bannen?", banBody: "{name} wird sofort gebannt. Die Nachrichten bleiben.", banConfirm: "Jetzt bannen",
        banned: "{name} gebannt", banFailed: "Bann fehlgeschlagen: {e}", sendFailed: "Senden fehlgeschlagen",
        edit: "Für dich bearbeiten", reset: "Zurück zum Standard", noCreator: "Ticket-Ersteller nicht gefunden",
        stickerMissing: "Sticker „mhm…“ in Sticker Corner nicht gefunden",
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

export function TicketBar({ channel }: { channel: Channel; }) {
    const [, rerender] = useReducer((n: number) => n + 1, 0);
    useEffect(() => { loadVotes(); return subscribe(rerender); }, []);

    const me = UserStore.getCurrentUser()?.id;
    const creatorId = creatorOf(channel);
    // Greeting until someone from the team has written in this ticket
    const teamWrote = useStateFromStores([MessageStore], () =>
        ((MessageStore.getMessages(channel.id) as any)?._array as any[] ?? []).some(m => !m.author?.bot && isTeamMember(m.author.id))
    );

    // Upload the greeting GIF ahead of time so the click sends instantly
    useEffect(() => {
        if (teamWrote) return;
        const sticker = findSticker(s => GREET_STICKER_RE.test(s.name));
        if (sticker) prepareSticker(sticker, channel.id);
    }, [channel.id, teamWrote]);

    const tally = tallyFor(channel.id);
    const approved = isApproved(tally);
    const hasVoteChannel = !!voteChannel();
    const [busy, setBusy] = useState(false);

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

    const phase = approved ? "welcome" : "vibe";
    const chips = suggestions().filter(s => s.phase === phase);

    return (
        <div className={cl("bar")}>
            {tally.troll.length > 0 && (
                <div className={cl("troll")} title={tally.troll.map(nameOf).join(", ")}>
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
                        <VoteButton kind="in" voters={tally.in} mine={!!me && tally.in.includes(me)} onClick={() => vote("in")}>
                            {tt("in")}
                            <span className={cl("gates")}>
                                {GATEKEEPERS.map(g => (
                                    <span key={g.id} className={cl("gate", tally.in.includes(g.id) && "gate-yes")}>{g.name}</span>
                                ))}
                            </span>
                        </VoteButton>
                        <VoteButton kind="troll" voters={tally.troll} mine={!!me && tally.troll.includes(me)} onClick={() => vote("troll")}>
                            {tt("troll")}{tally.troll.length > 0 && <span className={cl("count")}>{tally.troll.length}</span>}
                        </VoteButton>
                    </>
                ) : (
                    <span className={cl("hint")}>{tt("noVoteChannel")}</span>
                )}
                <button className={cl("ban")} onClick={ban} disabled={!creatorId}>{tt("ban")}</button>
            </div>

            {approved && <div className={cl("approved")}>{tt("approved")}</div>}

            <div className={cl("chips")}>
                {!teamWrote && !approved && (
                    <button className={cl("greet")} onClick={greet}>{tt("greet")}</button>
                )}
                {chips.map(s => <SuggestionChip key={s.id + s.text} id={s.id} text={s.text} edited={s.edited} onSend={send} />)}
            </div>
        </div>
    );
}
