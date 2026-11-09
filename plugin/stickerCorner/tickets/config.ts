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
    text: string;
}

/** Default suggestions – every team member can rewrite them for themselves (pencil) */
export const DEFAULT_SUGGESTIONS: Suggestion[] = [
    { id: "vibe-special", phase: "vibe", text: "we wanna know you a bit more, please tell us something special about you" },
    { id: "vibe-sorry", phase: "vibe", text: "sorry for asking, we just wanna get your vibe" },
    { id: "vibe-know", phase: "vibe", text: "just that you know, we wanna get your vibe, so we wanna know a bit more about you" },
    { id: "vibe-free", phase: "vibe", text: "what do you do in your free time?" },
    // Final texts – the exact wording follows (see board card)
    { id: "welcome-german", phase: "welcome", text: "btw this is a german server, only that you know – we have english-speaking people and channels too" },
    { id: "welcome-in", phase: "welcome", text: "come on in 🫶" },
];
