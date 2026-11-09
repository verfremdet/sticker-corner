# Sticker Corner

[English](README.md) · **Deutsch**

Ein [Vencord](https://vencord.dev)-Plugin, das im Discord-Stickerfenster einen Reiter **Sticker Corner** neben GIFs, Sticker und Emojis einfügt.
Ein Klick auf ein Bild sendet es als normales Bild in den aktuellen Chat.

Die Bilder kommen aus einem Sticker-Channel auf dem Night-Corner-Server. Neue Bilder dort haben alle mit dem Plugin nach
spätestens 30 Sekunden. Wird ein Bild dort gelöscht, verschwindet es auch aus dem Reiter.

## Aufbau

```
Sticker-Channel ──(Bot, nur Lesen)──► stickers.verfremdet.com ──► Plugin
                                       speichert Bilder + Liste    Reiter „Sticker Corner“
```

- [`plugin/stickerCorner/`](plugin/stickerCorner): das Vencord-Plugin (TypeScript/React)
- [`server/`](server): kleiner Node-Dienst. Ein Discord-Bot mit reinen Leserechten im Sticker-Channel speichert die Bilder und liefert sie aus.

## Worauf das Plugin zugreift

- **Netzwerk:** nur `stickers.verfremdet.com` (Sticker-Liste und Bilder) und dieses Repo (Update-Prüfung).
  Die Adressen stehen fest in [`native.ts`](plugin/stickerCorner/native.ts) und [`updater.ts`](plugin/stickerCorner/updater.ts).
- **Senden:** nur, wenn du einen Sticker anklickst. Dabei nutzt es denselben Upload-Weg wie Discord, wenn du selbst ein Bild anhängst
  ([`store.ts`](plugin/stickerCorner/store.ts)).
- **„Beliebt“:** Nach dem Senden schickt das Plugin dem Server die Nummer des Stickers, damit er mitzählen kann.
  Sonst nichts – kein Name, kein Konto, kein Chat.
- **„Zu Sticker Corner hinzufügen“** (Rechtsklick auf ein Bild): nur sichtbar, wenn du sowieso in den Sticker-Channel posten darfst.
  Es lädt dieses eine Bild von Discords eigenen Servern und postet es mit dem eingegebenen Namen in den Sticker-Channel
  ([`contextMenu.tsx`](plugin/stickerCorner/contextMenu.tsx)).
- **Ticket-Helfer fürs Team** ([`tickets/`](plugin/stickerCorner/tickets)): nur für Mitglieder mit den Team-Rollen des
  Night-Corner-Servers, in `ticket-…`-Kanälen. Eine Leiste über dem Eingabefeld zeigt Antwort-Vorschläge (gesendet nur per Klick), einen kleinen Team-Chat zum Ticket,
  Abstimmungen und einen Bann-Knopf (nur nach Bestätigung, Nachrichten bleiben). Stimmen und Chat sind kurze Nachrichten im Team-Kanal
  `#ticket-votes`. Alle anderen sehen davon nichts.
- **„Passt gerade“**: Vorschläge, die nur auf deinem PC aus dem Chat vor einem gesendeten Sticker oder GIF gelernt werden. Davon verlässt nichts deinen Computer.
- Es liest weder deinen Token noch dein Passwort oder deine Nachrichten und schickt keine Daten über dich weg.
- **Updates:** Der Update-Knopf holt dieses Repo per git und baut Vencord neu. Von anderswo wird nichts geladen.

## Installieren

Der Installer ([`install.ps1`](install.ps1) / [`install.sh`](install.sh)) klont das offizielle
[Vencord-Repo](https://github.com/Vendicated/Vencord) und dieses Repo, baut Vencord mit dem Plugin und installiert es
mit Vencords eigenem Installer. Fehlen git oder Node.js, installiert er sie über `winget` (Windows). Er braucht keine Admin-Rechte,
richtet keinen Autostart ein und lässt nichts im Hintergrund laufen. Alles liegt in `%LOCALAPPDATA%\StickerCorner` (macOS/Linux: `~/.stickercorner`).

Lies das Skript, bevor du es ausführst.

**Windows:** PowerShell öffnen und ausführen:

```powershell
irm https://raw.githubusercontent.com/verfremdet/sticker-corner/main/install.ps1 | iex
```

Oder dieses Repo herunterladen (**Code → Download ZIP**), entpacken und `install.cmd` doppelklicken.

**macOS / Linux:**

```bash
curl -fsSL https://raw.githubusercontent.com/verfremdet/sticker-corner/main/install.sh | bash
```

Dauert 2–3 Minuten. Danach Discord neu starten und das Stickerfenster öffnen.
Läuft nur in der Discord-App am Computer (nicht am Handy, nicht im Browser). Gesendete Sticker sind normale Bilder, die alle sehen.

Updates erscheinen direkt im Reiter. Du kannst auch einfach den Installationsbefehl nochmal ausführen.
Vencord selbst aktualisierst du unter *Einstellungen → Vencord → Updater*.

## Entfernen

```powershell
irm https://raw.githubusercontent.com/verfremdet/sticker-corner/main/uninstall.ps1 | iex
```

macOS / Linux: `curl -fsSL https://raw.githubusercontent.com/verfremdet/sticker-corner/main/uninstall.sh | bash`

## Hinweis

Discords Nutzungsbedingungen erlauben Client-Mods wie Vencord nicht. Laut Vencord wurde dafür bisher niemand gebannt.
Entscheide selbst.

## Sprache

Das Plugin richtet sich nach der Sprache von Discord: Deutsch, wenn Discord auf Deutsch steht, sonst Englisch.
Umstellen kannst du das in den Plugin-Einstellungen.

## Lizenz

GPL-3.0, wie Vencord.
