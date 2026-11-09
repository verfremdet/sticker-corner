// Sticker Corner – Server
// Bot liest den Sticker-Channel, speichert die Bilder und liefert sie per HTTP aus.
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Client, Events, GatewayIntentBits, Partials } from "discord.js";
import { Brain } from "./brain.js";
import { cleanText, mediaExt, Store, TYPE_BY_EXT } from "./store.js";

const { DISCORD_TOKEN, CHANNEL_ID } = process.env;
// Lobbys, aus denen die Vorschläge lernen (Lobby DE, Lobby EN)
const LOBBY_IDS = (process.env.LOBBY_IDS ?? "1554676725303087216,1554695971676622948").split(",").filter(Boolean);
const PORT = Number(process.env.PORT ?? 8790);
const DATA_DIR = process.env.DATA_DIR ?? path.resolve("data");
const SOUNDS_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "sounds");

if (!DISCORD_TOKEN || !CHANNEL_ID) {
    console.error("DISCORD_TOKEN und CHANNEL_ID fehlen in .env");
    process.exit(1);
}

const store = new Store(DATA_DIR);
await store.load();
store.channelId = CHANNEL_ID;
const brain = new Brain(DATA_DIR, store, LOBBY_IDS);
await brain.load();

// „Beliebt“-Zähler: je IP und Sticker höchstens 1× pro 10 min, je IP höchstens 120 pro Stunde
const USE_SAME_MS = 10 * 60_000;
const USE_PER_HOUR = 120;
const useLog = new Map(); // ip → { hour, count, last: Map<id, time> }
function allowUse(ip, id) {
    const now = Date.now();
    let e = useLog.get(ip);
    if (!e || now - e.hour > 3_600_000) useLog.set(ip, e = { hour: now, count: 0, last: new Map() });
    if (e.count >= USE_PER_HOUR || now - (e.last.get(id) ?? 0) < USE_SAME_MS) return false;
    e.count++;
    e.last.set(id, now);
    return true;
}
setInterval(() => {
    const now = Date.now();
    for (const [ip, e] of useLog) if (now - e.hour > 3_600_000) useLog.delete(ip);
}, 600_000).unref();
store.backfillSmall().catch(e => console.error("Nachziehen:", e.message));

// ── HTTP ────────────────────────────────────────────────────────────────
const server = http.createServer(async (req, res) => {
    res.setHeader("Access-Control-Allow-Origin", "*");
    const url = new URL(req.url ?? "/", "http://x");

    if (url.pathname === "/api/stickers") {
        const etag = `"${store.version}"`;
        res.setHeader("ETag", etag);
        res.setHeader("Cache-Control", "no-cache");
        if (req.headers["if-none-match"] === etag) return void res.writeHead(304).end();
        res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
        return void res.end(JSON.stringify(store.list()));
    }

    if (url.pathname === "/api/brain") {
        const etag = `"b${brain.version}"`;
        res.setHeader("ETag", etag);
        res.setHeader("Cache-Control", "no-cache");
        if (req.headers["if-none-match"] === etag) return void res.writeHead(304).end();
        res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
        return void res.end(JSON.stringify(brain.list()));
    }

    const used = /^\/api\/used\/(\d{5,25})$/.exec(url.pathname);
    if (used) {
        if (req.method !== "POST") return void res.writeHead(405).end();
        const xff = String(req.headers["x-forwarded-for"] ?? "").split(",")[0].trim();
        const ip = String(req.headers["cf-connecting-ip"] ?? (xff || req.socket.remoteAddress) ?? "");
        const ok = allowUse(ip, used[1]) && store.use(used[1]);
        return void res.writeHead(ok ? 204 : 202).end();
    }

    // <id>.<ext> = Original, <id>.s.<ext> = kleine Sende-Version
    const m = /^\/files\/(\d+(?:\.s)?)\.(png|jpg|gif|webp)$/.exec(url.pathname);
    if (m) {
        const file = path.join(store.filesDir, `${m[1]}.${m[2]}`);
        try {
            const st = await stat(file);
            res.writeHead(200, {
                "Content-Type": TYPE_BY_EXT[m[2]],
                "Content-Length": st.size,
                "Cache-Control": "public, max-age=31536000, immutable",
            });
            return void createReadStream(file).pipe(res);
        } catch {
            return void res.writeHead(404).end();
        }
    }

    // Short sounds for the plugin (Kenney, CC0) – fixed list, no paths from outside
    const snd = /^\/sounds\/([a-z-]{1,30})\.ogg$/.exec(url.pathname);
    if (snd) {
        const file = path.join(SOUNDS_DIR, `${snd[1]}.ogg`);
        try {
            const st = await stat(file);
            res.writeHead(200, { "Content-Type": "audio/ogg", "Content-Length": st.size, "Cache-Control": "public, max-age=86400" });
            return void createReadStream(file).pipe(res);
        } catch {
            return void res.writeHead(404).end();
        }
    }

    if (url.pathname === "/health") return void res.writeHead(200).end("ok");

    // Keine eigene Webseite: Startseite führt direkt zum öffentlichen Code auf GitHub
    if (url.pathname === "/") {
        return void res.writeHead(302, { Location: "https://github.com/verfremdet/sticker-corner" }).end();
    }
    res.writeHead(404).end();
});
server.listen(PORT, "127.0.0.1", () => console.log(`HTTP auf 127.0.0.1:${PORT}`));

// ── Discord ─────────────────────────────────────────────────────────────
const client = new Client({
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent],
    partials: [Partials.Message],
});

const isOurChannel = msg => msg.channelId === CHANNEL_ID;

/** GIFs that steal.js copied from the lobby: posted by this bot, files named "lobby__…" */
const isStolen = message => message.author?.id === client.user?.id && message.attachments.size > 0 &&
    [...message.attachments.values()].every(a => (a.name ?? "").startsWith("lobby__"));
const isPerson = message => !message.author?.bot || isStolen(message);

const hasMedia = message => [...message.attachments.values()].some(a => mediaExt(a));
/** Antwort ohne eigenes Bild → benennt das Bild, auf das geantwortet wurde */
const replyTarget = message =>
    !message.author?.bot && !hasMedia(message) ? message.reference?.messageId ?? null : null;

async function addMessage(message, { live = true } = {}) {
    // Bot messages (e.g. the pinned how-to with screenshot) are never stickers – except stolen lobby GIFs
    if (!isPerson(message)) return;
    const target = replyTarget(message);
    if (target) {
        if (store.nameByReply(target, message) && live && cleanText(message.content)) {
            console.log(`Name: "${message.content}" (${message.author?.username})`);
            message.react("✅").catch(() => {});
        }
        return;
    }
    for (const attachment of message.attachments.values()) {
        if (!mediaExt(attachment)) continue;
        try {
            if (await store.add({ attachment, message })) {
                brain.stickersChanged();
                console.log(`+ ${attachment.name} (${message.author?.username})`);
            }
        } catch (e) {
            console.error(`Bild ${attachment.id}:`, e.message);
        }
    }
}

// Abgleich beim Start: fehlende Bilder holen, gelöschte entfernen.
async function fullSync() {
    const channel = await client.channels.fetch(CHANNEL_ID);
    if (!channel?.isTextBased()) throw new Error(`Channel ${CHANNEL_ID} nicht lesbar`);

    const seen = new Set();
    const replies = [];
    let before;
    for (;;) {
        const batch = await channel.messages.fetch({ limit: 100, before });
        if (batch.size === 0) break;
        for (const message of batch.values()) {
            if (isPerson(message)) for (const a of message.attachments.values()) if (mediaExt(a)) seen.add(a.id);
            // Antworten erst nach allen Bildern anwenden (Verlauf kommt von neu nach alt)
            if (replyTarget(message)) replies.push(message);
            else await addMessage(message, { live: false });
        }
        before = batch.last().id;
        if (batch.size < 100) break;
    }
    for (const id of [...store.stickers.keys()]) if (!seen.has(id)) await store.remove(id);
    for (const r of replies) store.nameByReply(replyTarget(r), r);
    store.pruneReplies(new Set(replies.map(r => r.id)));
    console.log(`Abgleich fertig: ${store.stickers.size} Sticker`);
}

async function learnLobbies() {
    try {
        await brain.scan(client);
    } catch (e) {
        console.error("Lernen:", e.message);
    }
}

client.once(Events.ClientReady, async c => {
    console.log(`Eingeloggt als ${c.user.tag}`);
    try {
        await fullSync();
    } catch (e) {
        console.error("Abgleich:", e.message);
    }
    await learnLobbies();
});

client.on(Events.MessageCreate, m => {
    if (isOurChannel(m)) addMessage(m);
    else brain.onMessage(m).catch(e => console.error("Lernen live:", e.message));
});

client.on(Events.MessageDelete, async m => {
    if (!isOurChannel(m)) return void brain.onDelete(m.id);
    for (const id of store.idsOfMessage(m.id)) await store.remove(id);
    store.dropReply(m.id);
});

client.on(Events.MessageBulkDelete, async (messages, channel) => {
    if (channel.id !== CHANNEL_ID) return;
    for (const m of messages.values()) {
        for (const id of store.idsOfMessage(m.id)) await store.remove(id);
        store.dropReply(m.id);
    }
});

client.on(Events.MessageUpdate, async (_old, m) => {
    if (!isOurChannel(m)) return;
    if (m.partial) m = await m.fetch().catch(() => null);
    if (!m) return;
    // Bearbeitete Antwort → Name mitziehen
    const target = replyTarget(m);
    if (target) return void store.nameByReply(target, m);
    // Anhänge, die beim Bearbeiten entfernt wurden, rauswerfen
    const now = new Set(m.attachments.keys());
    for (const id of store.idsOfMessage(m.id)) if (!now.has(id)) await store.remove(id);
    store.updateName(m.id, m);
});

client.on(Events.Error, e => console.error("Discord:", e.message));

process.on("SIGTERM", async () => {
    await store.save().catch(() => {});
    process.exit(0);
});

// Login-Fehler (z. B. Intent aus, Discord down) beenden nicht den Prozess:
// der Bild-Server liefert weiter die gespeicherten Sticker, Login wird wiederholt.
async function connect() {
    try {
        await client.login(DISCORD_TOKEN);
    } catch (e) {
        console.error(`Login fehlgeschlagen: ${e.message} – neuer Versuch in 60 s`);
        await client.destroy().catch(() => {});
        setTimeout(connect, 60_000);
    }
}
connect();
