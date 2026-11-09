#!/usr/bin/env bash
# Sticker Corner – Installation für Mac und Linux
# Baut Vencord mit dem Sticker-Corner-Plugin und installiert es in Discord.
# Nochmal ausführen = Update.
set -euo pipefail

ROOT="${HOME}/.stickercorner"
VENCORD="${ROOT}/Vencord"
PLUGIN="$(cd "$(dirname "$0")" && pwd)/plugin/stickerCorner"

step() { printf '\n\033[35m[%s/5] %s\033[0m\n' "$1" "$2"; }

[ -d "$PLUGIN" ] || { echo "Plugin-Ordner fehlt: $PLUGIN"; exit 1; }

step 1 "Werkzeuge prüfen (git, Node, pnpm)"
for t in git node npm; do command -v "$t" >/dev/null || { echo "$t fehlt. Mac: 'brew install git node'"; exit 1; }; done
command -v pnpm >/dev/null || npm install -g pnpm

step 2 "Vencord holen bzw. aktualisieren"
mkdir -p "$ROOT"
if [ -d "$VENCORD/.git" ]; then git -C "$VENCORD" pull --ff-only
else git clone --depth 1 https://github.com/Vendicated/Vencord.git "$VENCORD"; fi

step 3 "Plugin einspielen"
rm -rf "$VENCORD/src/userplugins/stickerCorner"
mkdir -p "$VENCORD/src/userplugins"
cp -R "$PLUGIN" "$VENCORD/src/userplugins/"

step 4 "Bauen (etwa 1 Minute)"
(cd "$VENCORD" && pnpm install --frozen-lockfile && pnpm build)

step 5 "In Discord installieren (Discord danach neu starten)"
(cd "$VENCORD" && pnpm inject --branch auto)

printf '\n\033[32mFertig.\033[0m Discord neu starten, dann Einstellungen -> Vencord -> Plugins -> StickerCorner einschalten.\n'
