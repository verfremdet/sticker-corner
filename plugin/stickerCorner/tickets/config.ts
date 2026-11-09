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
    text: string;
}

/** How many suggestions are visible at once; the next ones move up once these were sent */
export const VISIBLE_SUGGESTIONS = 4;

/** Default suggestions – every team member can rewrite them for themselves (pencil) */
export const DEFAULT_SUGGESTIONS: Suggestion[] = [
    { id: "vibe-special", phase: "vibe", group: "vibe", text: "we wanna know you a bit more, please tell us something special about you" },
    { id: "vibe-sorry", phase: "vibe", group: "vibe", text: "sorry for asking, we just wanna get your vibe" },
    { id: "vibe-know", phase: "vibe", group: "vibe", text: "just that you know, we wanna get your vibe, so we wanna know a bit more about you" },
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
