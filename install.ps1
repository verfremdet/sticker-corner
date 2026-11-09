# Sticker Corner – Installation für Windows
# Baut Vencord mit dem Sticker-Corner-Plugin und installiert es in Discord.
# Nochmal ausführen = Update.

# Kein "Stop": Windows PowerShell 5.1 hält sonst normale stderr-Meldungen von git/pnpm für Fehler.
$ErrorActionPreference = "Continue"
$Root = Join-Path $env:LOCALAPPDATA "StickerCorner"
$Vencord = Join-Path $Root "Vencord"
$Plugin = Join-Path $PSScriptRoot "plugin\stickerCorner"

function Step($n, $text) { Write-Host "`n[$n/5] $text" -ForegroundColor Magenta }
function Check($what) { if ($LASTEXITCODE -ne 0) { Write-Host "Fehler bei: $what (Code $LASTEXITCODE)" -ForegroundColor Red; exit 1 } }

if (-not (Test-Path $Plugin)) { throw "Plugin-Ordner fehlt: $Plugin" }

Step 1 "Werkzeuge prüfen (git, Node, pnpm)"
foreach ($tool in "git", "node") {
    if (-not (Get-Command $tool -ErrorAction SilentlyContinue)) {
        Write-Host "$tool fehlt – wird mit winget installiert ..."
        if ($tool -eq "git") { winget install --id Git.Git -e --silent } else { winget install --id OpenJS.NodeJS.LTS -e --silent }
        $env:Path = [Environment]::GetEnvironmentVariable("Path", "Machine") + ";" + [Environment]::GetEnvironmentVariable("Path", "User")
    }
}
if (-not (Get-Command pnpm -ErrorAction SilentlyContinue)) { npm install -g pnpm | Out-Null }

Step 2 "Vencord holen bzw. aktualisieren"
New-Item -ItemType Directory -Force $Root | Out-Null
if (Test-Path (Join-Path $Vencord ".git")) {
    git -C $Vencord pull --ff-only; Check "Vencord aktualisieren"
} else {
    git clone --depth 1 https://github.com/Vendicated/Vencord.git $Vencord; Check "Vencord herunterladen"
}

Step 3 "Plugin einspielen"
$Target = Join-Path $Vencord "src\userplugins\stickerCorner"
if (Test-Path $Target) { Remove-Item -Recurse -Force $Target }
Copy-Item -Recurse $Plugin $Target

Step 4 "Bauen (etwa 1 Minute)"
Push-Location $Vencord
try {
    pnpm install --frozen-lockfile; Check "Pakete installieren"
    pnpm build; Check "Bauen"
} finally { Pop-Location }

Step 5 "In Discord installieren"
$discord = Get-Process Discord -ErrorAction SilentlyContinue
if ($discord) { Write-Host "Discord wird kurz geschlossen ..."; $discord | Stop-Process -Force; Start-Sleep 2 }
Push-Location $Vencord
try { pnpm inject --branch auto; Check "In Discord installieren" } finally { Pop-Location }

$update = Join-Path $env:LOCALAPPDATA "Discord\Update.exe"
if (Test-Path $update) { Start-Process $update -ArgumentList "--processStart", "Discord.exe" }

Write-Host "`nFertig. In Discord: Einstellungen -> Vencord -> Plugins -> 'StickerCorner' einschalten." -ForegroundColor Green
Write-Host "Dann das Sticker-Symbol im Chat anklicken -> Reiter 'Sticker Corner'."
