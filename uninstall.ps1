# Sticker Corner – uninstaller for Windows
# Restores normal Discord and deletes the Sticker Corner folder.
# Source: https://github.com/verfremdet/sticker-corner
# Keep this file UTF-8 WITHOUT BOM ("irm | iex" would choke on a BOM). From the ZIP: uninstall.cmd

$ErrorActionPreference = "Continue"
$Root = Join-Path $env:LOCALAPPDATA "StickerCorner"
$Vencord = Join-Path $Root "Vencord"
$De = (Get-UICulture).TwoLetterISOLanguageName -eq "de"
function L($en, $de) { if ($De) { $de } else { $en } }

$discord = Get-Process Discord -ErrorAction SilentlyContinue
if ($discord) { Write-Host (L "Closing Discord for a moment ..." "Discord wird kurz geschlossen ..."); $discord | Stop-Process -Force; Start-Sleep 2 }

if (Test-Path (Join-Path $Vencord "package.json")) {
    Push-Location $Vencord
    # pnpm.cmd, not pnpm: pnpm.ps1 is blocked by Windows' default script policy
    try { pnpm.cmd uninject --branch auto } finally { Pop-Location }
}
if (Test-Path $Root) { Remove-Item -Recurse -Force $Root }

$update = Join-Path $env:LOCALAPPDATA "Discord\Update.exe"
if (Test-Path $update) { Start-Process $update -ArgumentList "--processStart", "Discord.exe" }

Write-Host (L "`nSticker Corner is removed. Discord is back to normal." "`nSticker Corner ist entfernt. Discord ist wieder ganz normal.") -ForegroundColor Green
Write-Host (L "If you used Vencord before: run the official installer from vencord.dev again." "Wer vorher schon Vencord hatte: den offiziellen Installer von vencord.dev nochmal ausführen.")
