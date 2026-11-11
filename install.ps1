# Sticker Corner – installer for Windows
# Builds Vencord with the Sticker Corner plugin and installs it into Discord.
# Run it again to update.
# Source and explanation: https://github.com/verfremdet/sticker-corner
# Downloads only from: github.com (Vencord + this plugin), winget (Microsoft), npm (pnpm).
# Without winget: git from github.com/git-for-windows and Node.js from nodejs.org instead.
# Keep this file UTF-8 WITHOUT BOM: "irm | iex" would choke on a BOM.
# From the ZIP, start install.cmd – it reads this file explicitly as UTF-8.

# Not "Stop": Windows PowerShell 5.1 would treat normal stderr output of git/pnpm as errors.
$ErrorActionPreference = "Continue"
$Repo = "https://github.com/verfremdet/sticker-corner"
$Root = Join-Path $env:LOCALAPPDATA "StickerCorner"
$Vencord = Join-Path $Root "Vencord"
# Folder with plugin\stickerCorner when started from the ZIP (install.cmd sets STICKERCORNER_DIR)
$ScriptDir = if ($PSScriptRoot) { $PSScriptRoot } else { $env:STICKERCORNER_DIR }

# English by default, German on German Windows
$De = (Get-UICulture).TwoLetterISOLanguageName -eq "de"
function L($en, $de) { if ($De) { $de } else { $en } }

function Step($n, $text) { Write-Host "`n[$n/5] $text" -ForegroundColor Cyan }
# throw instead of exit: with "irm | iex" exit would close the PowerShell window
function Check($what) { if ($LASTEXITCODE -ne 0) { throw "$(L 'Failed' 'Fehler bei'): $what (code $LASTEXITCODE)" } }
function Refresh-Path { $env:Path = [Environment]::GetEnvironmentVariable("Path", "Machine") + ";" + [Environment]::GetEnvironmentVariable("Path", "User") }

function Start-Discord {
    if (Get-Process Discord -ErrorAction SilentlyContinue) { return }
    $update = Join-Path $env:LOCALAPPDATA "Discord\Update.exe"
    if (Test-Path $update) { Start-Process $update -ArgumentList "--processStart", "Discord.exe" }
}

function Has($cmd) { [bool](Get-Command $cmd -ErrorAction SilentlyContinue) }

# winget is missing on some PCs (older Windows 10, LTSC, removed "App Installer").
# Then git and Node.js are downloaded as plain ZIPs into the Sticker Corner folder – no admin rights needed.
function Add-UserPath($dir) {
    $user = [string][Environment]::GetEnvironmentVariable("Path", "User")
    if (($user -split ";") -notcontains $dir) {
        [Environment]::SetEnvironmentVariable("Path", ($user.TrimEnd(";") + ";" + $dir).TrimStart(";"), "User")
    }
    $env:Path = "$dir;$env:Path"
}
function Get-Zip($url, $dest) {
    $zip = Join-Path $env:TEMP ("stickercorner-" + [IO.Path]::GetRandomFileName() + ".zip")
    $old = $ProgressPreference; $ProgressPreference = "SilentlyContinue"  # the progress bar makes downloads 10x slower
    try {
        [Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12
        Invoke-WebRequest -UseBasicParsing -Uri $url -OutFile $zip -ErrorAction Stop
        if (Test-Path $dest) { Remove-Item -Recurse -Force $dest }
        Expand-Archive -Path $zip -DestinationPath $dest -Force -ErrorAction Stop
    } finally {
        $ProgressPreference = $old
        Remove-Item -Force $zip -ErrorAction SilentlyContinue
    }
}
function Get-Arch { if ($env:PROCESSOR_ARCHITECTURE -eq "ARM64" -or $env:PROCESSOR_ARCHITEW6432 -eq "ARM64") { "arm64" } else { "x64" } }
function Install-PortableGit($tools) {
    # MinGit: the official small git from github.com/git-for-windows
    $pattern = if ((Get-Arch) -eq "arm64") { '^MinGit-[\d.]+-arm64\.zip$' } else { '^MinGit-[\d.]+-64-bit\.zip$' }
    $rel = Invoke-RestMethod -UseBasicParsing -Uri "https://api.github.com/repos/git-for-windows/git/releases/latest" -ErrorAction Stop
    $asset = $rel.assets | Where-Object { $_.name -match $pattern } | Select-Object -First 1
    if (-not $asset) { throw "MinGit not found in the latest git-for-windows release" }
    $dest = Join-Path $tools "git"
    Get-Zip $asset.browser_download_url $dest
    Add-UserPath (Join-Path $dest "cmd")
}
function Install-PortableNode($tools) {
    # Newest LTS from nodejs.org
    # Two steps on purpose: Windows PowerShell 5.1 passes the JSON array down a pipe as ONE object
    $all = Invoke-RestMethod -UseBasicParsing -Uri "https://nodejs.org/dist/index.json" -ErrorAction Stop
    $lts = @($all) | Where-Object { $_.lts } | Select-Object -First 1
    if (-not $lts) { throw "No Node.js LTS found on nodejs.org" }
    $name = "node-$($lts.version)-win-$(Get-Arch)"
    $tmp = Join-Path $tools "node-tmp"
    Get-Zip "https://nodejs.org/dist/$($lts.version)/$name.zip" $tmp
    $dest = Join-Path $tools "node"
    if (Test-Path $dest) { Remove-Item -Recurse -Force $dest }
    Move-Item (Join-Path $tmp $name) $dest
    Remove-Item -Recurse -Force $tmp
    Add-UserPath $dest
}

function Install-StickerCorner {
    Step 1 (L "Checking tools (git, Node.js, pnpm)" "Werkzeuge prüfen (git, Node.js, pnpm)")
    $tools = Join-Path $Root "tools"
    $winget = Has winget
    if (-not (Has git)) {
        Write-Host (L "git is missing, installing it ..." "git fehlt, wird installiert ...")
        if ($winget) {
            winget install --id Git.Git -e --silent --accept-source-agreements --accept-package-agreements
            Refresh-Path
        }
        if (-not (Has git)) {
            Write-Host (L "Downloading git directly (about 40 MB) ..." "git wird direkt heruntergeladen (etwa 40 MB) ...")
            Install-PortableGit $tools
        }
    }
    if (-not (Has node)) {
        Write-Host (L "Node.js is missing, installing it ..." "Node.js fehlt, wird installiert ...")
        if ($winget) {
            winget install --id OpenJS.NodeJS.LTS -e --silent --accept-source-agreements --accept-package-agreements
            Refresh-Path
        }
        if (-not (Has node)) {
            Write-Host (L "Downloading Node.js directly (about 35 MB, unpacking takes a minute) ..." "Node.js wird direkt heruntergeladen (etwa 35 MB, Entpacken dauert eine Minute) ...")
            Install-PortableNode $tools
        }
    }
    # npm.cmd / pnpm.cmd instead of npm / pnpm: PowerShell would pick npm.ps1 / pnpm.ps1,
    # which Windows blocks by default ("running scripts is disabled on this system").
    foreach ($tool in "git", "node", "npm.cmd") {
        if (-not (Get-Command $tool -ErrorAction SilentlyContinue)) {
            throw (L "$tool is missing. Open a new PowerShell window and run the command again." "$tool fehlt. Neues PowerShell-Fenster öffnen und den Befehl nochmal ausführen.")
        }
    }
    if (-not (Get-Command pnpm.cmd -ErrorAction SilentlyContinue)) {
        npm.cmd install -g pnpm | Out-Null; Check "npm install -g pnpm"
        Refresh-Path
        # npm's global folder is not always on the PATH (fresh or portable Node.js)
        if (-not (Has pnpm.cmd)) {
            $prefix = (npm.cmd prefix -g | Select-Object -Last 1)
            if ($prefix -and (Test-Path (Join-Path $prefix "pnpm.cmd"))) { Add-UserPath "$prefix".Trim() }
        }
        if (-not (Has pnpm.cmd)) { throw (L "pnpm could not be installed." "pnpm konnte nicht installiert werden.") }
    }

    Step 2 (L "Downloading / updating Vencord" "Vencord holen bzw. aktualisieren")
    New-Item -ItemType Directory -Force $Root | Out-Null
    if (Test-Path (Join-Path $Vencord ".git")) {
        # This folder belongs to the installer: drop hand-made changes to Vencord's files, they block the pull
        git -C $Vencord reset --hard -q; Check "git reset Vencord"
        git -C $Vencord pull --ff-only; Check "git pull Vencord"
    } else {
        git clone --depth 1 https://github.com/Vendicated/Vencord.git $Vencord; Check "git clone Vencord"
    }

    Step 3 (L "Adding the plugin" "Plugin einspielen")
    $userplugins = Join-Path $Vencord "src\userplugins"
    $target = Join-Path $userplugins "stickerCorner"
    if (Test-Path $target) { Remove-Item -Recurse -Force $target }
    $local = if ($ScriptDir) { Join-Path $ScriptDir "plugin\stickerCorner" } else { "" }
    if ($local -and (Test-Path $local)) {
        Copy-Item -Recurse $local $target
    } else {
        # Plugin straight from the public GitHub repo – the same code you can read there.
        # The clone stays, so the update button in the plugin only needs to pull.
        $repoDir = Join-Path $Root "sticker-corner"
        if (Test-Path (Join-Path $repoDir ".git")) {
            git -C $repoDir fetch --depth 1 origin main; Check "git fetch sticker-corner"
            git -C $repoDir reset --hard origin/main; Check "git reset sticker-corner"
        } else {
            git clone --depth 1 $Repo $repoDir; Check "git clone sticker-corner"
        }
        Copy-Item -Recurse (Join-Path $repoDir "plugin\stickerCorner") $target
    }
    if (-not (Test-Path (Join-Path $target "index.tsx"))) { throw (L "Could not add the plugin" "Plugin konnte nicht eingespielt werden") }

    Step 4 (L "Building (about 1 minute)" "Bauen (etwa 1 Minute)")
    Push-Location $Vencord
    try {
        pnpm.cmd install --frozen-lockfile; Check "pnpm install"
        pnpm.cmd build; Check "pnpm build"
    } finally { Pop-Location }

    Step 5 (L "Installing into Discord" "In Discord installieren")
    $discord = Get-Process Discord -ErrorAction SilentlyContinue
    if ($discord) { Write-Host (L "Closing Discord for a moment ..." "Discord wird kurz geschlossen ..."); $discord | Stop-Process -Force; Start-Sleep 2 }
    Push-Location $Vencord
    try {
        # Vencord's installer is downloaded from GitHub; retry on short GitHub outages (504)
        for ($try = 1; $try -le 3; $try++) {
            pnpm.cmd inject --branch auto
            if ($LASTEXITCODE -eq 0) { break }
            if ($try -lt 3) { Write-Host (L "GitHub did not respond, retrying in 10 s ..." "GitHub hat nicht geantwortet, neuer Versuch in 10 s ..."); Start-Sleep 10 }
        }
        Check "pnpm inject"
    } finally { Pop-Location }

    # Enable the plugin right away (Discord is closed now). Keeps existing plugin settings.
    $settingsDir = Join-Path $env:APPDATA "Vencord\settings"
    $settingsFile = Join-Path $settingsDir "settings.json"
    New-Item -ItemType Directory -Force $settingsDir | Out-Null
    $cfg = $null
    if (Test-Path $settingsFile) { $cfg = Get-Content $settingsFile -Raw -Encoding UTF8 | ConvertFrom-Json }
    if (-not $cfg) { $cfg = [pscustomobject]@{} }
    if (-not $cfg.plugins) { $cfg | Add-Member -NotePropertyName plugins -NotePropertyValue ([pscustomobject]@{}) -Force }
    if ($cfg.plugins.StickerCorner) {
        $cfg.plugins.StickerCorner | Add-Member -NotePropertyName enabled -NotePropertyValue $true -Force
    } else {
        $cfg.plugins | Add-Member -NotePropertyName StickerCorner -NotePropertyValue ([pscustomobject]@{ enabled = $true }) -Force
    }
    [IO.File]::WriteAllText($settingsFile, ($cfg | ConvertTo-Json -Depth 50), (New-Object Text.UTF8Encoding $false))

    Start-Discord

    Write-Host (L "`nDone. Discord is restarting." "`nFertig. Discord startet neu.") -ForegroundColor Green
    Write-Host (L "Open the sticker picker in any chat -> tab 'STICKER CORNER'." "Im Chat das Stickerfenster öffnen -> Reiter 'STICKER CORNER'.")
}

try { Install-StickerCorner } catch {
    Start-Discord  # never leave Discord closed
    Write-Host "`n$_" -ForegroundColor Red
    Write-Host (L "Installation stopped. Take a screenshot of this window if you need help." "Installation abgebrochen. Mach einen Screenshot von diesem Fenster, wenn du Hilfe brauchst.")
}
