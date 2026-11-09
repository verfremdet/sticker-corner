/*
 * Ticket helper – fixed values for the Night Corner server.
 * Only team members (role "Goat" or "Bad bitches") ever see anything of this.
 */

export const GUILD_ID = "1554642464583843902";

/** Roles that count as team */
export const TEAM_ROLES = ["1554674743469277285" /* Goat */, "1554642689138499604" /* Bad bitches */];

/** These three must all vote "in" before the welcome suggestions show up */
export const GATEKEEPERS: { id: string; name: string; }[] = [
    { id: "1056331628621877268", name: "cya" },
    { id: "392749862950666240", name: "verfremdet" },
    { id: "1132098363400130621", name: "x8one" },
];

/** Ticket channels from tickets.bot: "ticket-95" */
export const TICKET_NAME_RE = /^ticket-\d+$/;

/** Team-only channel that holds the votes (one short message per vote) */
export const VOTE_CHANNEL_NAME = "ticket-votes";

/** Sticker Corner sticker that opens every ticket */
export const GREET_STICKER_RE = /^mhm\b/i;
export const GREET_TEXT = "mhm mhm";

export type Phase = "vibe" | "welcome";

export interface Suggestion {
    id: string;
    phase: Phase;
    /** Suggestions of one group ask the same thing – once one of them was sent, the whole group disappears */
    group: string;
    /** Only shown once something from this group was sent (e.g. the explanation after the question) */
    after?: string;
    text: string;
    /** Phrases that also count as "already sent" (own wording of the team) */
    keys?: string[];
}

/** How many suggestions are visible at once; the next ones move up once these were sent */
export const VISIBLE_SUGGESTIONS = 4;

/** 🎲 Vibe-Check: random, slightly absurd questions */
export const VIBE_QUESTIONS = [
    "would you rather fight 1 horse-sized duck or 100 duck-sized horses?",
    "pineapple on pizza – yes or crime?",
    "what's the most useless talent you have?",
    "if you were a sticker, which one would you be?",
    "what's your go-to karaoke song?",
    "cats or dogs – choose wisely",
    "what's the weirdest thing you've ever eaten?",
    "what would your villain name be?",
    "describe your vibe with 3 emojis",
    "what's your hot take that gets you in trouble?",
    "what's the last thing you googled? (be honest)",
    "if you had to delete one app forever, which one?",
    "what's your comfort show or game?",
    "would you survive a zombie apocalypse? why?",
    "what's your most unhinged 3am thought?",
    "what's your favorite meme of all time?",
    "if your life had a theme song, what would it be?",
    "what's a red flag you'd ignore anyway?",
    "night owl or early bird – and why is it night owl?",
    "what's your toxic trait? (keep it cute)",
    "what's the best pickup line you know?",
    "what's your most used emoji?",
    "if you could only eat one food forever, what would it be?",
    "rate your rizz from 1 to 10",
    "what's something you're weirdly good at?",
];

/** Default suggestions – every team member can rewrite them for themselves (pencil) */
export const DEFAULT_SUGGESTIONS: Suggestion[] = [
    { id: "vibe-special", phase: "vibe", group: "ask", text: "we wanna know you a bit more, please tell us something special about you", keys: ["something special about you", "know you a bit more"] },
    // Explanation why we ask – only after the question above, worded differently (not repeating it)
    { id: "why-sorry", phase: "vibe", group: "why", after: "ask", text: "sorry for asking, we just wanna get your vibe before we let you in", keys: ["get your vibe", "get a feel for", "know who we"] },
    { id: "why-small", phase: "vibe", group: "why", after: "ask", text: "just so you know, we're a small community, so we like to get a feel for who joins", keys: ["get your vibe", "get a feel for", "know who we"] },
    { id: "why-nostress", phase: "vibe", group: "why", after: "ask", text: "no stress, it's just so we know who we're talking to", keys: ["get your vibe", "get a feel for", "know who we"] },
    { id: "vibe-free", phase: "vibe", group: "free", text: "what do you do in your free time?" },
    { id: "vibe-music", phase: "vibe", group: "music", text: "what kind of music do you listen to?" },
    { id: "vibe-games", phase: "vibe", group: "games", text: "what games do you play?" },
    { id: "vibe-3words", phase: "vibe", group: "words", text: "describe yourself in 3 words" },
    { id: "vibe-funfact", phase: "vibe", group: "funfact", text: "tell us a fun fact about you" },
    { id: "vibe-night", phase: "vibe", group: "night", text: "night owl or early bird?" },
    { id: "vibe-vc", phase: "vibe", group: "vc", text: "would you join us in vc sometimes?" },
    // Final texts – the exact wording follows (see board card)
    { id: "welcome-german", phase: "welcome", group: "german", text: "btw this is a german server, only that you know – we have english-speaking people and channels too" },
    { id: "welcome-in", phase: "welcome", group: "in", text: "come on in 🫶" },
];
