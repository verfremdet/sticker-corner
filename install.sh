#!/usr/bin/env bash
# Sticker Corner – installer for macOS and Linux
# Builds Vencord with the Sticker Corner plugin and installs it into Discord.
# Run it again to update.
# Source and explanation: https://github.com/verfremdet/sticker-corner
# Downloads only from: github.com (Vencord + this plugin) and npm (pnpm).
set -euo pipefail

REPO="https://github.com/verfremdet/sticker-corner"
ROOT="${HOME}/.stickercorner"
VENCORD="${ROOT}/Vencord"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")" 2>/dev/null && pwd || echo "")"

# English by default, German if the system language is German
case "${LC_ALL:-${LC_MESSAGES:-${LANG:-}}}" in de*) DE=1 ;; *) DE=0 ;; esac
if [ "$DE" = 0 ] && [ "$(uname)" = "Darwin" ]; then
    defaults read -g AppleLanguages 2>/dev/null | grep -q '"\?de' && DE=1 || true
fi
L() { if [ "$DE" = 1 ]; then printf '%s' "$2"; else printf '%s' "$1"; fi; }
step() { printf '\n\033[36m[%s/5] %s\033[0m\n' "$1" "$2"; }

step 1 "$(L "Checking tools (git, Node.js, pnpm)" "Werkzeuge prüfen (git, Node.js, pnpm)")"
for t in git node npm; do
    command -v "$t" >/dev/null || {
        L "$t is missing. On macOS: install https://brew.sh, then run 'brew install git node'." \
          "$t fehlt. Mac: zuerst https://brew.sh installieren, dann 'brew install git node'."
        echo; exit 1
    }
done
command -v pnpm >/dev/null || npm install -g pnpm || sudo npm install -g pnpm

step 2 "$(L "Downloading / updating Vencord" "Vencord holen bzw. aktualisieren")"
mkdir -p "$ROOT"
if [ -d "$VENCORD/.git" ]; then git -C "$VENCORD" pull --ff-only
else git clone --depth 1 https://github.com/Vendicated/Vencord.git "$VENCORD"; fi

step 3 "$(L "Adding the plugin" "Plugin einspielen")"
rm -rf "$VENCORD/src/userplugins/stickerCorner"
mkdir -p "$VENCORD/src/userplugins"
if [ -n "$SCRIPT_DIR" ] && [ -d "$SCRIPT_DIR/plugin/stickerCorner" ]; then
    cp -R "$SCRIPT_DIR/plugin/stickerCorner" "$VENCORD/src/userplugins/"
else
    # Plugin straight from the public GitHub repo – the same code you can read there.
    # The clone stays, so the update button in the plugin only needs to pull.
    REPO_DIR="$ROOT/sticker-corner"
    if [ -d "$REPO_DIR/.git" ]; then
        git -C "$REPO_DIR" fetch --depth 1 origin main && git -C "$REPO_DIR" reset --hard origin/main
    else
        git clone --depth 1 "$REPO" "$REPO_DIR"
    fi
    cp -R "$REPO_DIR/plugin/stickerCorner" "$VENCORD/src/userplugins/"
fi
[ -f "$VENCORD/src/userplugins/stickerCorner/index.tsx" ] || { L "Could not add the plugin" "Plugin konnte nicht eingespielt werden"; echo; exit 1; }

step 4 "$(L "Building (about 1 minute)" "Bauen (etwa 1 Minute)")"
(cd "$VENCORD" && pnpm install --frozen-lockfile && pnpm build)

step 5 "$(L "Installing into Discord" "In Discord installieren")"
# Vencord's installer is downloaded from GitHub; retry on short GitHub outages
inject() {
    local tries="$1" try; shift
    for try in $(seq 1 "$tries"); do
        (cd "$VENCORD" && pnpm inject "$@") && return 0
        [ "$try" = "$tries" ] || sleep 10
    done
    return 1
}

APP="/Applications/Discord.app"
if [ "$(uname)" = "Darwin" ] && [ -f "$APP/Contents/Resources/_app.asar" ] \
    && grep -aqF "$VENCORD/dist" "$APP/Contents/Resources/app.asar" 2>/dev/null; then
    # Discord already loads this build folder – an update only needs the new build, no patching.
    L "Discord is already patched, nothing to do here." "Discord ist schon gepatcht, hier ist nichts zu tun."; echo
elif [ "$(uname)" = "Darwin" ] && [ -d "$APP" ]; then
    if ! inject 1 --branch auto; then
        # macOS does not let the terminal change apps inside /Applications ("operation not permitted").
        # Way around it: quit Discord, patch it on the Desktop, move it back.
        L "macOS blocked the change in /Applications. Patching Discord on the Desktop and moving it back ..." \
          "macOS hat die Änderung in /Applications gesperrt. Discord wird auf dem Schreibtisch gepatcht und zurückgelegt ..."; echo
        TMP_APP="$HOME/Desktop/Discord.app"
        [ -e "$TMP_APP" ] && { L "There is already a Discord.app on your Desktop. Move it away and run this again." \
            "Auf dem Schreibtisch liegt schon eine Discord.app. Bitte wegschieben und nochmal ausführen."; echo; exit 1; }
        osascript -e 'tell application "Discord" to quit' >/dev/null 2>&1 || true
        for _ in $(seq 1 20); do pgrep -x Discord >/dev/null || break; sleep 0.5; done
        mv "$APP" "$TMP_APP"
        # Whatever happens, Discord goes back to /Applications
        trap '[ -e "$TMP_APP" ] && [ ! -e "$APP" ] && mv "$TMP_APP" "$APP"' EXIT
        OK=1; inject 3 --location "$TMP_APP" || OK=0
        mv "$TMP_APP" "$APP"; trap - EXIT
        [ "$OK" = 1 ] || {
            L "Still blocked. Open System Settings -> Privacy & Security -> App Management, switch on your terminal, then run this again." \
              "Weiter gesperrt. Öffne Systemeinstellungen -> Datenschutz & Sicherheit -> App-Verwaltung, schalte dein Terminal ein und führe das hier nochmal aus."
            echo; exit 1
        }
    fi
else
    inject 3 --branch auto || exit 1
fi

# Enable the plugin right away (keeps existing plugin settings)
if [ "$(uname)" = "Darwin" ]; then SETTINGS="$HOME/Library/Application Support/Vencord/settings/settings.json"
else SETTINGS="${XDG_CONFIG_HOME:-$HOME/.config}/Vencord/settings/settings.json"; fi
mkdir -p "$(dirname "$SETTINGS")"
node -e '
const fs = require("fs"); const f = process.argv[1];
let s = {}; try { s = JSON.parse(fs.readFileSync(f, "utf8")); } catch {}
s.plugins = s.plugins || {}; s.plugins.StickerCorner = { ...(s.plugins.StickerCorner || {}), enabled: true };
fs.writeFileSync(f, JSON.stringify(s, null, 4));
' "$SETTINGS"

printf '\n\033[32m%s\033[0m\n' "$(L "Done. Quit Discord completely and open it again, then open the sticker picker -> tab STICKER CORNER." "Fertig. Discord komplett beenden und neu öffnen, dann Stickerfenster -> Reiter STICKER CORNER.")"
