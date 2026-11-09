#!/usr/bin/env bash
# Sticker Corner – uninstaller for macOS and Linux
# Source: https://github.com/verfremdet/sticker-corner
set -uo pipefail

ROOT="${HOME}/.stickercorner"
VENCORD="${ROOT}/Vencord"
case "${LC_ALL:-${LC_MESSAGES:-${LANG:-}}}" in de*) DE=1 ;; *) DE=0 ;; esac

[ -f "$VENCORD/package.json" ] && (cd "$VENCORD" && pnpm uninject --branch auto)
rm -rf "$ROOT"

if [ "$DE" = 1 ]; then printf '\n\033[32mSticker Corner ist entfernt.\033[0m Discord komplett beenden und neu öffnen.\n'
else printf '\n\033[32mSticker Corner is removed.\033[0m Quit Discord completely and open it again.\n'; fi
