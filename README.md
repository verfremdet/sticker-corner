# Sticker Corner

**English** · [Deutsch](README.de.md)

A [Vencord](https://vencord.dev) plugin that adds a **Sticker Corner** tab to Discord's sticker picker, next to GIFs, Stickers and Emojis.
Click an image and it is sent to the current chat as a normal image upload.

The images come from a sticker channel on the Night Corner server. New images there show up for everyone with the plugin
within 30 seconds. Images deleted there disappear from the tab as well.

## How it works

```
sticker channel ──(read-only bot)──► stickers.verfremdet.com ──► plugin
                                      stores images + list       "Sticker Corner" tab
```

- [`plugin/stickerCorner/`](plugin/stickerCorner): the Vencord plugin (TypeScript/React)
- [`server/`](server): small Node service. A Discord bot with read-only access to the sticker channel stores the images and serves them.

## What the plugin accesses

- **Network:** only `stickers.verfremdet.com` (sticker list and images) and this repository (update check).
  These addresses are fixed in [`native.ts`](plugin/stickerCorner/native.ts) and [`updater.ts`](plugin/stickerCorner/updater.ts).
- **Sending:** only when you click a sticker. It uses the same upload path Discord uses when you attach an image yourself
  ([`store.ts`](plugin/stickerCorner/store.ts)).
- It does not read your token, password or messages, and sends no data about you anywhere.
- **Updates:** the update button pulls this repository with git and rebuilds Vencord. Nothing is downloaded from anywhere else.

## Install

The installer ([`install.ps1`](install.ps1) / [`install.sh`](install.sh)) clones the official
[Vencord repository](https://github.com/Vendicated/Vencord) and this repository, builds Vencord with the plugin and installs it
using Vencord's own installer. If git or Node.js are missing, it installs them with `winget` (Windows). It needs no admin rights,
sets up no autostart and leaves no background process. Everything stays in `%LOCALAPPDATA%\StickerCorner` (macOS/Linux: `~/.stickercorner`).

Read the script before running it.

**Windows:** open PowerShell and run

```powershell
irm https://raw.githubusercontent.com/verfremdet/sticker-corner/main/install.ps1 | iex
```

or download this repository (**Code → Download ZIP**), extract it and double-click `install.cmd`.

**macOS / Linux:**

```bash
curl -fsSL https://raw.githubusercontent.com/verfremdet/sticker-corner/main/install.sh | bash
```

Takes 2–3 minutes. Afterwards restart Discord and open the sticker picker.
Works in the Discord desktop app only (not mobile, not browser). Sent stickers are normal images, everyone can see them.

Updates appear inside the tab. You can also run the install command again.
Vencord itself updates through *Settings → Vencord → Updater*.

## Uninstall

```powershell
irm https://raw.githubusercontent.com/verfremdet/sticker-corner/main/uninstall.ps1 | iex
```

macOS / Linux: `curl -fsSL https://raw.githubusercontent.com/verfremdet/sticker-corner/main/uninstall.sh | bash`

## Note

Discord's terms of service do not allow client modifications such as Vencord. Vencord states that no one has been banned
for using it so far. Decide for yourself.

## Language

The plugin follows Discord's language: German if Discord is set to German, English otherwise.
You can change it in the plugin settings.

## License

GPL-3.0, same as Vencord.
