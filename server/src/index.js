// Sticker Corner – Server
// Bot liest den Sticker-Channel, speichert die Bilder und liefert sie per HTTP aus.
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { Client, Events, GatewayIntentBits, Partials } from "discord.js";
import { imageExt, Store, TYPE_BY_EXT } from "./store.js";

const { DISCORD_TOKEN, CHANNEL_ID } = process.env;
const PORT = Number(process.env.PORT ?? 8790);
const DATA_DIR = process.env.DATA_DIR ?? path.resolve("data");

if (!DISCORD_TOKEN || !CHANNEL_ID) {
    console.error("DISCORD_TOKEN und CHANNEL_ID fehlen in .env");
    process.exit(1);
}

const store = new Store(DATA_DIR);
await store.load();

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

    const m = /^\/files\/(\d+)\.(png|jpg|gif|webp)$/.exec(url.pathname);
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

    if (url.pathname === "/health") return void res.writeHead(200).end("ok");
    res.writeHead(404).end();
});
server.listen(PORT, "127.0.0.1", () => console.log(`HTTP auf 127.0.0.1:${PORT}`));

// ── Discord ─────────────────────────────────────────────────────────────
const client = new Client({
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent],
    partials: [Partials.Message],
});

const isOurChannel = msg => msg.channelId === CHANNEL_ID;

async function addMessage(message) {
    for (const attachment of message.attachments.values()) {
        if (!imageExt(attachment)) continue;
        try {
            if (await store.add({ attachment, message })) console.log(`+ ${attachment.name} (${message.author?.username})`);
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
    let before;
    for (;;) {
        const batch = await channel.messages.fetch({ limit: 100, before });
        if (batch.size === 0) break;
        for (const message of batch.values()) {
            for (const a of message.attachments.values()) if (imageExt(a)) seen.add(a.id);
            await addMessage(message);
        }
        before = batch.last().id;
        if (batch.size < 100) break;
    }
    for (const id of [...store.stickers.keys()]) if (!seen.has(id)) await store.remove(id);
    console.log(`Abgleich fertig: ${store.stickers.size} Sticker`);
}

client.once(Events.ClientReady, async c => {
    console.log(`Eingeloggt als ${c.user.tag}`);
    try {
        await fullSync();
    } catch (e) {
        console.error("Abgleich:", e.message);
    }
});

client.on(Events.MessageCreate, m => isOurChannel(m) && addMessage(m));

client.on(Events.MessageDelete, async m => {
    if (!isOurChannel(m)) return;
    for (const id of store.idsOfMessage(m.id)) await store.remove(id);
});

client.on(Events.MessageBulkDelete, async (messages, channel) => {
    if (channel.id !== CHANNEL_ID) return;
    for (const m of messages.values()) for (const id of store.idsOfMessage(m.id)) await store.remove(id);
});

client.on(Events.MessageUpdate, async (_old, m) => {
    if (!isOurChannel(m)) return;
    if (m.partial) m = await m.fetch().catch(() => null);
    if (!m) return;
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
