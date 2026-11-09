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

export type VoteKind = "in" | "out" | "troll" | "ban";
const KINDS: VoteKind[] = ["in", "out", "troll", "ban"];
const VOTE_RE = /^<#(\d{5,25})> · (in|out|troll|ban)$/;

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

// ── team chat per ticket: "<#ticket> 💬 text" in the same team channel ───
export interface ChatMessage { messageId: string; userId: string; ticketId: string; text: string; }
const TICKET_MENTION_RE = /<#(\d{5,25})>/;
let chats = new Map<string, ChatMessage>();

/**
 * Chat = any team message in #ticket-votes that mentions the ticket (#ticket-95), also typed by hand
 * in Discord – except the vote lines ("<#…> · in").
 */
function parseChat(m: { id: string; content?: string; author?: { id: string; }; }): ChatMessage | null {
    const content = m.content ?? "";
    if (VOTE_RE.test(content) || !m.author || !isTeamMember(m.author.id)) return null;
    const match = TICKET_MENTION_RE.exec(content);
    if (!match) return null;
    const text = content.replace(TICKET_MENTION_RE, "").replace(/^\s*💬\s*/u, "").trim();
    if (!text) return null;
    return { messageId: m.id, userId: m.author.id, ticketId: match[1], text: text.slice(0, 1900) };
}

const byId = (a: { messageId: string; }, b: { messageId: string; }) =>
    a.messageId.length - b.messageId.length || (a.messageId < b.messageId ? -1 : 1);

export const chatFor = (ticketId: string) => [...chats.values()].filter(c => c.ticketId === ticketId).sort(byId);

export async function sendChat(ticketId: string, text: string): Promise<boolean> {
    const ch = voteChannel();
    const clean = text.trim().slice(0, 1800);
    if (!ch || !clean) return false;
    const res = await RestAPI.post({
        url: Constants.Endpoints.MESSAGES(ch.id),
        body: { content: `<#${ticketId}> 💬 ${clean}`, allowed_mentions: { parse: [] }, flags: 4096 /* silent */ },
    });
    const c = parseChat(res.body);
    if (c) { chats.set(c.messageId, c); markSeen(ticketId, c.messageId); emit(); }
    return true;
}

// unread badge: newest chat message I have seen per ticket
const SEEN_KEY = "StickerCorner_ticketChatSeen";
const OPEN_KEY = "StickerCorner_ticketChatOpen";
let seen: Record<string, string> = {};
let chatOpen = false;
export const isChatOpen = () => chatOpen;
export function setChatOpen(open: boolean) { chatOpen = open; DataStore.set(OPEN_KEY, open); emit(); }

export function markSeen(ticketId: string, messageId: string) {
    const cur = seen[ticketId];
    if (cur && byId({ messageId: cur }, { messageId }) >= 0) return;
    seen = { ...seen, [ticketId]: messageId };
    DataStore.set(SEEN_KEY, seen);
}

export function unreadFor(ticketId: string): number {
    const me = UserStore.getCurrentUser()?.id;
    const last = seen[ticketId];
    return chatFor(ticketId).filter(c => c.userId !== me && (!last || byId(c, { messageId: last }) > 0)).length;
}

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
        const nextChats = new Map<string, ChatMessage>();
        let before: string | undefined;
        for (let page = 0; page < 3; page++) {
            const res = await RestAPI.get({ url: Constants.Endpoints.MESSAGES(ch.id), query: { limit: 100, ...(before ? { before } : {}) } });
            const batch = res.body as any[];
            for (const m of batch) {
                const v = parse(m); if (v) next.set(v.messageId, v);
                const c = parseChat(m); if (c) nextChats.set(c.messageId, c);
            }
            if (batch.length < 100) break;
            before = batch[batch.length - 1].id;
        }
        votes = next;
        chats = nextChats;
        loadedFor = ch.id;
        emit();
    })().catch(e => console.warn("[StickerCorner] votes:", e)).finally(() => { loading = null; });
    return loading;
}

function onCreate({ channelId, message }: any) {
    if (channelId !== loadedFor) return;
    const v = parse(message);
    if (v) { votes.set(v.messageId, v); emit(); }
    const c = parseChat(message);
    if (c) { chats.set(c.messageId, c); emit(); }
}
function onDelete({ channelId, id }: any) {
    if (channelId !== loadedFor) return;
    if (votes.delete(id) || chats.delete(id)) emit();
}
function onDeleteBulk({ channelId, ids }: any) {
    if (channelId !== loadedFor) return;
    let changed = false;
    for (const id of ids ?? []) changed = votes.delete(id) || chats.delete(id) || changed;
    if (changed) emit();
}

export function startTickets() {
    FluxDispatcher.subscribe("MESSAGE_CREATE", onCreate);
    FluxDispatcher.subscribe("MESSAGE_DELETE", onDelete);
    FluxDispatcher.subscribe("MESSAGE_DELETE_BULK", onDeleteBulk);
    loadTexts();
    DataStore.get<Record<string, string>>(SEEN_KEY).then(v => { seen = v ?? {}; emit(); });
    DataStore.get<boolean>(OPEN_KEY).then(v => { chatOpen = !!v; emit(); });
}

export function stopTickets() {
    FluxDispatcher.unsubscribe("MESSAGE_CREATE", onCreate);
    FluxDispatcher.unsubscribe("MESSAGE_DELETE", onDelete);
    FluxDispatcher.unsubscribe("MESSAGE_DELETE_BULK", onDeleteBulk);
}

export const subscribe = (l: () => void) => { listeners.add(l); return () => void listeners.delete(l); };

export type Tally = Record<VoteKind, string[]>;

export function tallyFor(ticketId: string): Tally {
    const t: Tally = { in: [], out: [], troll: [], ban: [] };
    const list = [...votes.values()].filter(v => v.ticketId === ticketId)
        .sort((a, b) => a.messageId.length - b.messageId.length || (a.messageId < b.messageId ? -1 : 1));
    for (const v of list) {
        // in/out: the newer vote of a person wins
        if (v.kind === "in") t.out = t.out.filter(u => u !== v.userId);
        if (v.kind === "out") t.in = t.in.filter(u => u !== v.userId);
        if (!t[v.kind].includes(v.userId)) t[v.kind].push(v.userId);
    }
    return t;
}

export const isApproved = (t: Tally) => GATEKEEPERS.every(g => t.in.includes(g.id) && !t.out.includes(g.id));

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
    // "in" and "out" exclude each other: switching sides removes the old vote
    const opposite = kind === "in" ? "out" : kind === "out" ? "in" : null;
    if (opposite) {
        for (const v of [...votes.values()].filter(v => v.ticketId === ticketId && v.kind === opposite && v.userId === me)) {
            await RestAPI.del({ url: Constants.Endpoints.MESSAGE(ch.id, v.messageId) }).catch(() => { });
            votes.delete(v.messageId);
        }
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
