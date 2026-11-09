/*
 * Ticket helper – who is team, who opened the ticket, votes and personal texts.
 *
 * Votes live in Discord itself: one short message per vote in the team-only channel "ticket-votes",
 * e.g. "<#ticket> · in". Discord checks who wrote it, every team member sees all votes,
 * and taking a vote back deletes that message. No extra server, no extra login.
 */

import * as DataStore from "@api/DataStore";
import { Channel } from "@vencord/discord-types";
import { ChannelStore, Constants, FluxDispatcher, GuildMemberStore, RestAPI, UserStore } from "@webpack/common";

import { DEFAULT_SUGGESTIONS, GATEKEEPERS, GUILD_ID, Suggestion, TEAM_ROLES, TICKET_NAME_RE, VOTE_CHANNEL_NAME } from "./config";

export type VoteKind = "in" | "troll" | "ban";
const KINDS: VoteKind[] = ["in", "troll", "ban"];
const VOTE_RE = /^<#(\d{5,25})> · (in|troll|ban)$/;

const TEXTS_KEY = "StickerCorner_ticketTexts";
const MEMBER_OVERWRITE = 1;

// ── team & tickets ──────────────────────────────────────────────────────
export function isTeamMember(userId: string): boolean {
    const roles = GuildMemberStore.getMember(GUILD_ID, userId)?.roles ?? [];
    return roles.some(r => TEAM_ROLES.includes(r));
}

export const isTeam = () => {
    const me = UserStore.getCurrentUser()?.id;
    return !!me && isTeamMember(me);
};

export const isTicket = (channel?: Channel | null) =>
    !!channel && channel.guild_id === GUILD_ID && TICKET_NAME_RE.test(channel.name ?? "");

/** The person who opened the ticket: the member with their own permission entry who is neither team nor bot */
export function creatorOf(channel: Channel): string | null {
    for (const o of Object.values(channel.permissionOverwrites ?? {}) as { id: string; type: number; }[]) {
        if (o.type !== MEMBER_OVERWRITE || isTeamMember(o.id)) continue;
        if (UserStore.getUser(o.id)?.bot) continue;
        return o.id;
    }
    return null;
}

export function voteChannel(): Channel | null {
    const channels = Object.values(ChannelStore.getMutableGuildChannelsForGuild(GUILD_ID) ?? {}) as Channel[];
    return channels.find(c => c.name === VOTE_CHANNEL_NAME && c.type === 0) ?? null;
}

// ── votes ───────────────────────────────────────────────────────────────
interface Vote { messageId: string; userId: string; kind: VoteKind; ticketId: string; }

let votes = new Map<string, Vote>(); // messageId → vote
let loadedFor: string | null = null;
let loading: Promise<void> | null = null;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach(l => l());

function parse(m: { id: string; content?: string; author?: { id: string; }; }): Vote | null {
    const match = VOTE_RE.exec(m.content ?? "");
    if (!match || !m.author || !isTeamMember(m.author.id)) return null;
    return { messageId: m.id, userId: m.author.id, kind: match[2] as VoteKind, ticketId: match[1] };
}

/** Reads the newest 300 vote messages once; afterwards live via gateway events */
export function loadVotes(): Promise<void> {
    const ch = voteChannel();
    if (!ch) return Promise.resolve();
    if (loadedFor === ch.id) return Promise.resolve();
    loading ??= (async () => {
        const next = new Map<string, Vote>();
        let before: string | undefined;
        for (let page = 0; page < 3; page++) {
            const res = await RestAPI.get({ url: Constants.Endpoints.MESSAGES(ch.id), query: { limit: 100, ...(before ? { before } : {}) } });
            const batch = res.body as any[];
            for (const m of batch) { const v = parse(m); if (v) next.set(v.messageId, v); }
            if (batch.length < 100) break;
            before = batch[batch.length - 1].id;
        }
        votes = next;
        loadedFor = ch.id;
        emit();
    })().catch(e => console.warn("[StickerCorner] votes:", e)).finally(() => { loading = null; });
    return loading;
}

function onCreate({ channelId, message }: any) {
    if (channelId !== loadedFor) return;
    const v = parse(message);
    if (v) { votes.set(v.messageId, v); emit(); }
}
function onDelete({ channelId, id }: any) {
    if (channelId === loadedFor && votes.delete(id)) emit();
}
function onDeleteBulk({ channelId, ids }: any) {
    if (channelId !== loadedFor) return;
    let changed = false;
    for (const id of ids ?? []) changed = votes.delete(id) || changed;
    if (changed) emit();
}

export function startTickets() {
    FluxDispatcher.subscribe("MESSAGE_CREATE", onCreate);
    FluxDispatcher.subscribe("MESSAGE_DELETE", onDelete);
    FluxDispatcher.subscribe("MESSAGE_DELETE_BULK", onDeleteBulk);
    loadTexts();
}

export function stopTickets() {
    FluxDispatcher.unsubscribe("MESSAGE_CREATE", onCreate);
    FluxDispatcher.unsubscribe("MESSAGE_DELETE", onDelete);
    FluxDispatcher.unsubscribe("MESSAGE_DELETE_BULK", onDeleteBulk);
}

export const subscribe = (l: () => void) => { listeners.add(l); return () => void listeners.delete(l); };

export type Tally = Record<VoteKind, string[]>;

export function tallyFor(ticketId: string): Tally {
    const t: Tally = { in: [], troll: [], ban: [] };
    for (const v of votes.values()) if (v.ticketId === ticketId && !t[v.kind].includes(v.userId)) t[v.kind].push(v.userId);
    return t;
}

export const isApproved = (t: Tally) => GATEKEEPERS.every(g => t.in.includes(g.id));

/** Vote or take the vote back (deletes my vote message) */
export async function toggleVote(ticketId: string, kind: VoteKind): Promise<boolean> {
    const ch = voteChannel();
    const me = UserStore.getCurrentUser()?.id;
    if (!ch || !me) return false;
    const mine = [...votes.values()].filter(v => v.ticketId === ticketId && v.kind === kind && v.userId === me);
    if (mine.length) {
        for (const v of mine) {
            await RestAPI.del({ url: Constants.Endpoints.MESSAGE(ch.id, v.messageId) }).catch(() => { });
            votes.delete(v.messageId);
        }
        emit();
        return true;
    }
    const res = await RestAPI.post({
        url: Constants.Endpoints.MESSAGES(ch.id),
        body: { content: `<#${ticketId}> · ${kind}`, allowed_mentions: { parse: [] }, flags: 4096 /* silent */ },
    });
    const v = parse(res.body);
    if (v) { votes.set(v.messageId, v); emit(); }
    return true;
}

export const KIND_LIST = KINDS;

// ── personal texts (pencil) ─────────────────────────────────────────────
let custom: Record<string, string> = {};

async function loadTexts() {
    custom = await DataStore.get<Record<string, string>>(TEXTS_KEY) ?? {};
    emit();
}

export function suggestions(): (Suggestion & { edited: boolean; })[] {
    return DEFAULT_SUGGESTIONS.map(s => ({ ...s, text: custom[s.id] ?? s.text, edited: s.id in custom }));
}

export function setText(id: string, text: string) {
    const def = DEFAULT_SUGGESTIONS.find(s => s.id === id)?.text;
    const clean = text.trim();
    if (!clean || clean === def) delete custom[id];
    else custom[id] = clean.slice(0, 500);
    DataStore.set(TEXTS_KEY, custom);
    emit();
}
