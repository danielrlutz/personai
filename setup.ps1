#Requires -Version 5.1
<#
.SYNOPSIS
  PersonAI OS -- cross-platform setup wizard (Windows)

.DESCRIPTION
  Detects and installs desktop/dev requirements (Node, pnpm, Rust, Tauri CLI,
  MSVC Build Tools, WebView2) and can bootstrap the repo / Docker path.

  One-liner (after publish):
    irm https://raw.githubusercontent.com/danielrlutz/personai/main/setup.ps1 | iex

  Local:
    .\setup.ps1
    .\setup.ps1 -Mode desktop -Yes
    .\setup.ps1 -Mode check
#>
[CmdletBinding()]
param(
  [ValidateSet('desktop', 'vps', 'full', 'check', '')]
  [string]$Mode = '',

  [Alias('y')]
  [switch]$Yes,

  [string]$Dir = '',

  [switch]$SkipClone,

  [ValidateSet('yes', 'no', 'ask')]
  [string]$Docker = 'ask',

  [ValidateSet('yes', 'no', 'ask')]
  [string]$PullModels = 'ask',

  [ValidateSet('yes', 'no', 'ask')]
  [string]$BuildServer = 'ask'
)

$ErrorActionPreference = 'Stop'
$RepoUrl = if ($env:PERSONAI_REPO_URL) { $env:PERSONAI_REPO_URL } else { 'https://github.com/danielrlutz/personai.git' }
$Branch = if ($env:PERSONAI_BRANCH) { $env:PERSONAI_BRANCH } else { 'main' }
$DefaultDir = if ($env:PERSONAI_HOME) { $env:PERSONAI_HOME } else { (Join-Path $env:USERPROFILE 'personai') }
$RawBase = if ($env:PERSONAI_RAW_BASE) { $env:PERSONAI_RAW_BASE } else { 'https://raw.githubusercontent.com/danielrlutz/personai/main' }

$script:InstallDir = $Dir
$script:StepTotal = 0
$script:StepCurrent = 0
$script:SelectedMode = $Mode

function Write-Info { param([string]$Message) Write-Host "> " -ForegroundColor Cyan -NoNewline; Write-Host $Message }
function Write-Ok   { param([string]$Message) Write-Host "[ok] " -ForegroundColor Green -NoNewline; Write-Host $Message }
function Write-Warn { param([string]$Message) Write-Host "! " -ForegroundColor Yellow -NoNewline; Write-Host $Message }
function Write-Err  { param([string]$Message) Write-Host "[x] " -ForegroundColor Red -NoNewline; Write-Host $Message }

function Invoke-WithSpinner {
  param([string]$Message, [scriptblock]$Script)
  Write-Host "  ..." -ForegroundColor Cyan -NoNewline
  Write-Host " $Message" -ForegroundColor DarkGray
  & $Script
}

function Show-Banner {
  Write-Host ""
  Write-Host "  +==========================================+" -ForegroundColor Cyan
  Write-Host "  |                                          |" -ForegroundColor Cyan
  Write-Host "  |   " -ForegroundColor Cyan -NoNewline
  Write-Host "PersonAI OS" -ForegroundColor White -NoNewline
  Write-Host "  .  Setup Wizard          |" -ForegroundColor Cyan
  Write-Host "  |   " -ForegroundColor Cyan -NoNewline
  Write-Host "desktop . tauri . docker . ollama" -ForegroundColor DarkGray -NoNewline
  Write-Host "      |" -ForegroundColor Cyan
  Write-Host "  |                                          |" -ForegroundColor Cyan
  Write-Host "  +==========================================+" -ForegroundColor Cyan
  Write-Host ""
}

function Initialize-Steps { param([int]$Total) $script:StepTotal = $Total; $script:StepCurrent = 0 }

function Write-Step {
  param([string]$Title)
  $script:StepCurrent++
  Write-Host ""
  Write-Host "[$($script:StepCurrent)/$($script:StepTotal)] " -ForegroundColor Blue -NoNewline
  Write-Host $Title -ForegroundColor White
  Write-Host ("-" * 48) -ForegroundColor DarkGray
}

function Read-Answer {
  param([string]$Prompt, [string]$Default = '')
  if ($Yes -and $Default -ne '') { return $Default }
  if ($Default -ne '') {
    $reply = Read-Host "$Prompt [$Default]"
  } else {
    $reply = Read-Host $Prompt
  }
  if ([string]::IsNullOrWhiteSpace($reply)) { return $Default }
  return $reply
}

function Read-YesNo {
  param([string]$Prompt, [string]$Default = 'y')
  if ($Yes) { return ($Default -eq 'y') }
  $hint = if ($Default -eq 'y') { 'Y/n' } else { 'y/N' }
  $reply = Read-Host "$Prompt [$hint]"
  if ([string]::IsNullOrWhiteSpace($reply)) { $reply = $Default }
  return ($reply -match '^(y|yes)$')
}

function Test-Command {
  param([string]$Name)
  return [bool](Get-Command $Name -ErrorAction SilentlyContinue)
}

function Refresh-Path {
  $machine = [Environment]::GetEnvironmentVariable('Path', 'Machine')
  $user = [Environment]::GetEnvironmentVariable('Path', 'User')
  $env:Path = "$machine;$user"
  $cargo = Join-Path $env:USERPROFILE '.cargo\bin'
  if (Test-Path $cargo) { $env:Path = "$cargo;$env:Path" }
}

function Test-PersonaiRoot {
  param([string]$Path)
  if (-not (Test-Path (Join-Path $Path 'package.json'))) { return $false }
  return (Test-Path (Join-Path $Path 'src-tauri')) -or (Test-Path (Join-Path $Path 'apps\server'))
}

function Test-NodeOk {
  if (-not (Test-Command 'node')) {
    Write-Warn 'Node.js not found'
    return $false
  }
  $v = (node -v) -replace '^v', ''
  $parts = $v.Split('.')
  $major = [int]$parts[0]
  if ($major -ge 20) {
    Write-Ok "Node.js $v (>=20)"
    return $true
  }
  Write-Warn "Node.js $v found - need >=20"
  return $false
}

function Test-PnpmOk {
  if (Test-Command 'pnpm') {
    Write-Ok "pnpm $(pnpm -v)"
    return $true
  }
  Write-Warn 'pnpm not found'
  return $false
}

function Test-RustOk {
  Refresh-Path
  if ((Test-Command 'rustc') -and (Test-Command 'cargo')) {
    $rv = (rustc --version) -replace '^rustc ', ''
    Write-Ok "Rust $rv"
    return $true
  }
  Write-Warn 'Rust/cargo not found'
  return $false
}

function Test-TauriCliOk {
  Refresh-Path
  if (Test-Command 'cargo') {
    try {
      $null = & cargo tauri --version 2>$null
      if ($LASTEXITCODE -eq 0) {
        $ver = (& cargo tauri --version 2>$null | Select-Object -First 1)
        Write-Ok "Tauri CLI $ver"
        return $true
      }
    } catch {}
  }
  $cargoTauri = Join-Path $env:USERPROFILE '.cargo\bin\cargo-tauri.exe'
  if (Test-Path $cargoTauri) {
    Write-Ok 'Tauri CLI present (cargo-tauri)'
    return $true
  }
  Write-Warn 'Tauri CLI v2 not found'
  return $false
}

function Get-VsWhere {
  $candidates = @(
    "${env:ProgramFiles(x86)}\Microsoft Visual Studio\Installer\vswhere.exe",
    "${env:ProgramFiles}\Microsoft Visual Studio\Installer\vswhere.exe"
  )
  foreach ($c in $candidates) {
    if (Test-Path $c) { return $c }
  }
  return $null
}

function Test-MsvcOk {
  $vswhere = Get-VsWhere
  if (-not $vswhere) {
    Write-Warn 'Visual Studio Installer / vswhere not found'
    return $false
  }
  $install = & $vswhere -latest -products * -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath 2>$null
  if ($install) {
    Write-Ok "MSVC C++ tools: $install"
    return $true
  }
  Write-Warn 'MSVC C++ workload not detected (need Visual Studio Build Tools)'
  return $false
}

function Test-WebView2Ok {
  $paths = @(
    'HKLM:\SOFTWARE\WOW6432Node\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}',
    'HKLM:\SOFTWARE\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}',
    'HKCU:\SOFTWARE\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}'
  )
  foreach ($p in $paths) {
    if (Test-Path $p) {
      $pv = (Get-ItemProperty $p -ErrorAction SilentlyContinue).pv
      if ($pv) {
        Write-Ok "WebView2 Runtime $pv"
        return $true
      }
    }
  }
  Write-Warn 'WebView2 Runtime not found in registry'
  return $false
}

function Test-DockerOk {
  if ((Test-Command 'docker') -and (docker compose version 2>$null)) {
    Write-Ok "Docker $((docker --version) -replace '^Docker version ','')"
    return $true
  }
  if (Test-Command 'docker') {
    Write-Warn 'Docker found but Compose plugin missing'
    return $false
  }
  Write-Warn 'Docker not found'
  return $false
}

function Install-NodeWin {
  Refresh-Path
  if (Test-Command 'winget') {
    Invoke-WithSpinner 'Installing Node.js 20 via winget...' {
      winget install -e --id OpenJS.NodeJS.LTS --accept-package-agreements --accept-source-agreements | Out-Null
    }
  } elseif (Test-Command 'choco') {
    Invoke-WithSpinner 'Installing Node.js via Chocolatey...' { choco install nodejs-lts -y | Out-Null }
  } else {
    Write-Warn 'winget not found - opening Node.js download page'
    Start-Process 'https://nodejs.org/en/download'
    throw 'Install Node.js >=20, then re-run setup.ps1'
  }
  Refresh-Path
  if (-not (Test-NodeOk)) { throw 'Node.js install failed or shell PATH not refreshed - open a new terminal and re-run' }
}

function Install-PnpmWin {
  Refresh-Path
  if (Test-Command 'corepack') {
    Invoke-WithSpinner 'Enabling pnpm via corepack...' {
      corepack enable | Out-Null
      corepack prepare pnpm@9.15.0 --activate | Out-Null
    }
  }
  Refresh-Path
  if (-not (Test-Command 'pnpm')) {
    Invoke-WithSpinner 'Installing pnpm via npm...' { npm install -g pnpm@9 | Out-Null }
  }
  Refresh-Path
  if (-not (Test-PnpmOk)) { throw 'pnpm install failed' }
}

function Install-RustWin {
  $rustup = Join-Path $env:TEMP 'rustup-init.exe'
  Invoke-WithSpinner 'Downloading rustup-init...' {
    Invoke-WebRequest -Uri 'https://win.rustup.rs/x86_64' -OutFile $rustup -UseBasicParsing
  }
  Write-Info 'Running rustup-init (stable toolchain)...'
  & $rustup -y --default-toolchain stable
  Refresh-Path
  if (-not (Test-RustOk)) { throw 'Rust install failed - open a new terminal and re-run' }
}

function Install-TauriCliWin {
  Refresh-Path
  if (-not (Test-Command 'cargo')) { throw 'cargo not on PATH' }
  Write-Info 'Installing Tauri CLI v2 (this can take several minutes)...'
  & cargo install tauri-cli --version '^2' --locked
  Refresh-Path
  Write-Ok 'Tauri CLI install finished'
}

function Install-MsvcGuide {
  Write-Warn 'Visual Studio Build Tools with C++ workload required for Tauri on Windows.'
  if (Test-Command 'winget') {
    if (Read-YesNo 'Install Visual Studio 2022 Build Tools via winget now?' 'y') {
      Write-Info 'Installing Microsoft.VisualStudio.2022.BuildTools (C++ workload)...'
      Write-Warn 'This is large and may take a while. A UAC prompt may appear.'
      winget install -e --id Microsoft.VisualStudio.2022.BuildTools `
        --override '--wait --passive --add Microsoft.VisualStudio.Workload.VCTools --includeRecommended' `
        --accept-package-agreements --accept-source-agreements
      Refresh-Path
      if (Test-MsvcOk) { return }
      Write-Warn 'vswhere still does not see MSVC - you may need to reboot or finish the installer UI.'
      return
    }
  }
  Write-Info 'Opening Build Tools download page...'
  Start-Process 'https://visualstudio.microsoft.com/visual-cpp-build-tools/'
  Write-Warn 'Select "Desktop development with C++", install, then re-run this wizard.'
}

function Install-WebView2 {
  if (Test-Command 'winget') {
    Invoke-WithSpinner 'Installing WebView2 Runtime via winget...' {
      winget install -e --id Microsoft.EdgeWebView2Runtime --accept-package-agreements --accept-source-agreements | Out-Null
    }
    if (Test-WebView2Ok) { return }
  }
  $boot = Join-Path $env:TEMP 'MicrosoftEdgeWebView2Setup.exe'
  Write-Info 'Downloading WebView2 Evergreen Bootstrapper...'
  Invoke-WebRequest -Uri 'https://go.microsoft.com/fwlink/p/?LinkId=2124703' -OutFile $boot -UseBasicParsing
  Write-Info 'Running WebView2 bootstrapper...'
  Start-Process -FilePath $boot -ArgumentList '/silent','/install' -Wait
  if (-not (Test-WebView2Ok)) {
    Write-Warn 'WebView2 still not detected - open https://developer.microsoft.com/microsoft-edge/webview2/'
  }
}

function Install-DockerWin {
  if (Test-DockerOk) { return }
  if (Test-Command 'winget') {
    if (Read-YesNo 'Install Docker Desktop via winget?' 'y') {
      Invoke-WithSpinner 'Installing Docker Desktop...' {
        winget install -e --id Docker.DockerDesktop --accept-package-agreements --accept-source-agreements | Out-Null
      }
      Write-Warn 'Start Docker Desktop once, then re-run if compose is still unavailable.'
      return
    }
  }
  Write-Info 'Opening Docker Desktop download...'
  Start-Process 'https://www.docker.com/products/docker-desktop/'
}

function Resolve-RepoDir {
  if ($SkipClone) {
    $script:InstallDir = (Get-Location).Path
    if (-not (Test-PersonaiRoot $script:InstallDir)) {
      throw "--SkipClone set but $($script:InstallDir) is not a PersonAI checkout"
    }
    Write-Ok "Using current directory: $($script:InstallDir)"
    return
  }

  if ($Dir -ne '') {
    $script:InstallDir = $Dir
  } elseif (Test-PersonaiRoot (Get-Location).Path) {
    $script:InstallDir = (Get-Location).Path
  } else {
    $scriptRoot = $PSScriptRoot
    if (-not $scriptRoot -and $PSCommandPath) {
      $scriptRoot = Split-Path -Parent $PSCommandPath
    }
    if ($scriptRoot -and (Test-PersonaiRoot $scriptRoot)) {
      $script:InstallDir = $scriptRoot
    } elseif ($scriptRoot -and (Test-PersonaiRoot (Split-Path -Parent $scriptRoot))) {
      $script:InstallDir = (Split-Path -Parent $scriptRoot)
    } else {
      $script:InstallDir = $DefaultDir
    }
  }

  if (Test-PersonaiRoot $script:InstallDir) {
    Write-Ok "Using PersonAI checkout: $($script:InstallDir)"
    return
  }

  if (Test-Path (Join-Path $script:InstallDir '.git')) {
    Write-Warn "$($script:InstallDir) exists but may not be PersonAI - continuing"
    return
  }

  if ((Test-Path $script:InstallDir) -and (Get-ChildItem $script:InstallDir -Force | Measure-Object).Count -gt 0) {
    throw "Directory exists and is not empty: $($script:InstallDir)"
  }

  if (-not (Test-Command 'git')) {
    if (Test-Command 'winget') {
      Write-Info 'Installing Git via winget...'
      winget install -e --id Git.Git --accept-package-agreements --accept-source-agreements | Out-Null
      Refresh-Path
    }
    if (-not (Test-Command 'git')) { throw 'git is required to clone the repository' }
  }

  Write-Info "Cloning $RepoUrl -> $($script:InstallDir)"
  $parent = Split-Path -Parent $script:InstallDir
  if ($parent -and -not (Test-Path $parent)) { New-Item -ItemType Directory -Path $parent -Force | Out-Null }
  git clone --depth 1 --branch $Branch $RepoUrl $script:InstallDir
  Write-Ok "Cloned to $($script:InstallDir)"
}

function Invoke-PnpmInstall {
  Set-Location $script:InstallDir
  Refresh-Path
  Invoke-WithSpinner 'pnpm install...' { pnpm install }
  Write-Ok 'Dependencies installed'
}

function Invoke-BuildServer {
  Set-Location $script:InstallDir
  Refresh-Path
  Invoke-WithSpinner 'Building server (pnpm build:server)...' { pnpm build:server }
  Write-Ok 'Server built - Tauri sidecar ready'
}

function Invoke-PullModels {
  Set-Location $script:InstallDir
  $doPull = $PullModels
  if ($doPull -eq 'ask') {
    $doPull = if (Read-YesNo 'Pull Ollama models (OCR + reasoning)?' 'n') { 'yes' } else { 'no' }
  }
  if ($doPull -ne 'yes') { return }

  if ((Test-Command 'docker') -and (docker compose ps ollama 2>$null)) {
    Write-Info 'Pulling models via docker compose ollama...'
    docker compose exec -T ollama ollama pull maternion/LightOnOCR-2
    docker compose exec -T ollama ollama pull deepseek-r1:8b
  } elseif (Test-Command 'ollama') {
    try {
      $null = Invoke-WebRequest -Uri 'http://127.0.0.1:11434/api/tags' -UseBasicParsing -TimeoutSec 2
    } catch {
      Write-Info 'Starting ollama serve in background...'
      Start-Process -FilePath 'ollama' -ArgumentList 'serve' -WindowStyle Hidden
      Start-Sleep -Seconds 2
    }
    ollama pull maternion/LightOnOCR-2
    ollama pull deepseek-r1:8b
  } else {
    Write-Warn 'Neither ollama CLI nor compose ollama available - skip model pull'
    return
  }
  Write-Ok 'Model pull attempted'
}

function Show-CheckReport {
  Write-Host ""
  Write-Host 'Toolchain check' -ForegroundColor White -NoNewline
  Write-Host '  (windows)' -ForegroundColor DarkGray
  Write-Host ""
  [void](Test-NodeOk)
  [void](Test-PnpmOk)
  [void](Test-RustOk)
  [void](Test-TauriCliOk)
  [void](Test-MsvcOk)
  [void](Test-WebView2Ok)
  [void](Test-DockerOk)
  Write-Host ""
}

function Invoke-CheckMode {
  Initialize-Steps 1
  Write-Step 'Detect installed toolchain'
  Show-CheckReport
  Write-Ok 'Check complete - no changes made'
}

function Invoke-DesktopMode {
  $isFull = ($script:SelectedMode -eq 'full')
  $steps = if ($isFull) { 9 } else { 8 }
  Initialize-Steps $steps

  Write-Step 'Resolve repository'
  Resolve-RepoDir

  Write-Step 'Visual Studio Build Tools / MSVC'
  if (-not (Test-MsvcOk)) {
    if ($Yes -or (Read-YesNo 'Install or open MSVC Build Tools setup?' 'y')) {
      Install-MsvcGuide
    }
  }

  Write-Step 'WebView2 Runtime'
  if (-not (Test-WebView2Ok)) {
    if ($Yes -or (Read-YesNo 'Install WebView2 Runtime?' 'y')) {
      Install-WebView2
    }
  }

  Write-Step 'Node.js (>=20)'
  if (-not (Test-NodeOk)) {
    if ($Yes -or (Read-YesNo 'Install Node.js >=20?' 'y')) {
      Install-NodeWin
    } else { throw 'Node.js is required' }
  }

  Write-Step 'pnpm'
  if (-not (Test-PnpmOk)) {
    if ($Yes -or (Read-YesNo 'Install pnpm?' 'y')) {
      Install-PnpmWin
    } else { throw 'pnpm is required' }
  }

  Write-Step 'Rust (rustup + stable)'
  Refresh-Path
  if (-not (Test-RustOk)) {
    if ($Yes -or (Read-YesNo 'Install Rust via rustup?' 'y')) {
      Install-RustWin
    } else { throw 'Rust is required for Tauri' }
  }

  Write-Step 'Tauri CLI v2'
  Refresh-Path
  if (-not (Test-TauriCliOk)) {
    if ($Yes -or (Read-YesNo 'Install Tauri CLI v2 via cargo?' 'y')) {
      Install-TauriCliWin
    } else {
      Write-Warn 'Skipping Tauri CLI - later: cargo install tauri-cli --version "^2"'
    }
  }

  if ($isFull) {
    Write-Step 'Docker (optional)'
    $wantDocker = $Docker
    if ($wantDocker -eq 'ask') {
      $wantDocker = if (Read-YesNo 'Ensure Docker Desktop (Ollama / VPS path)?' 'n') { 'yes' } else { 'no' }
    }
    if ($wantDocker -eq 'yes') { Install-DockerWin } else { Write-Info 'Skipping Docker' }
  }

  Write-Step 'Project dependencies + server build'
  Invoke-PnpmInstall
  $doBuild = $BuildServer
  if ($doBuild -eq 'ask') {
    if ($isFull) { $doBuild = 'yes' }
    else { $doBuild = if (Read-YesNo 'Build server now (needed for Tauri sidecar)?' 'y') { 'yes' } else { 'no' } }
  }
  if ($doBuild -eq 'yes') { Invoke-BuildServer } else { Write-Info 'Skipped server build - run: pnpm build:server' }

  if ($isFull) {
    Write-Step 'Ollama models'
    Invoke-PullModels
  }

  Show-DesktopSummary
}

function Show-DesktopSummary {
  Refresh-Path
  $nodeV = if (Test-Command 'node') { node -v } else { 'n/a' }
  $pnpmV = if (Test-Command 'pnpm') { pnpm -v } else { 'n/a' }
  $rustV = if (Test-Command 'rustc') { rustc --version } else { 'n/a' }
  $tauriV = 'not installed'
  try {
    if (Test-Command 'cargo') {
      $t = & cargo tauri --version 2>$null | Select-Object -First 1
      if ($t) { $tauriV = $t }
    }
  } catch {}

  Write-Host ""
  Write-Host 'Desktop setup complete' -ForegroundColor Green
  Write-Host ""
  Write-Host "  Repo     : $($script:InstallDir)"
  Write-Host "  Node     : $nodeV"
  Write-Host "  pnpm     : $pnpmV"
  Write-Host "  Rust     : $rustV"
  Write-Host "  Tauri    : $tauriV"
  Write-Host ""
  Write-Host 'Next steps:' -ForegroundColor White
  Write-Host "  cd $($script:InstallDir)"
  Write-Host '  pnpm build:server; pnpm build:web'
  Write-Host '  pnpm tauri:dev'
  Write-Host ""
  Write-Host 'VPS / Docker (Linux host / WSL recommended):' -ForegroundColor DarkGray
  Write-Host '  wsl -- ./install.sh   or   .\setup.ps1 -Mode vps'
  Write-Host ""
}

function Invoke-VpsMode {
  Initialize-Steps 2
  Write-Step 'Locate install path'
  if ($Dir -ne '') { $script:InstallDir = $Dir }
  elseif (Test-PersonaiRoot (Get-Location).Path) { $script:InstallDir = (Get-Location).Path }
  else { Resolve-RepoDir }

  Write-Step 'VPS Docker stack'
  Write-Warn 'The Docker Compose VPS installer (install.sh) is a bash script.'
  $installSh = Join-Path $script:InstallDir 'install.sh'
  if (-not (Test-Path $installSh)) {
    Write-Info "Fetching install.sh from $RawBase..."
    New-Item -ItemType Directory -Path $script:InstallDir -Force | Out-Null
    Invoke-WebRequest -Uri "$RawBase/install.sh" -OutFile $installSh -UseBasicParsing
  }

  if (Test-Command 'wsl') {
    if ($Yes -or (Read-YesNo 'Run install.sh inside WSL now?' 'y')) {
      $drive = $script:InstallDir.Substring(0, 1).ToLower()
      $rest = $script:InstallDir.Substring(2) -replace '\\', '/'
      $wslDir = "/mnt/$drive/$rest"
      $argStr = if ($Yes) { '--yes' } else { '' }
      Write-Info "Running: bash install.sh $argStr (via WSL)"
      wsl -e bash -lc "cd '$wslDir'; bash ./install.sh $argStr"
      return
    }
  }

  if (Test-Command 'bash') {
    Set-Location $script:InstallDir
    $bashArgs = @('./install.sh')
    if ($Yes) { $bashArgs += '--yes' }
    & bash @bashArgs
    return
  }

  Write-Warn 'Neither WSL nor bash found.'
  Write-Host 'On a Linux VPS, run:'
  Write-Host "  curl -fsSL $RawBase/install.sh | bash"
  Write-Host 'On Windows, install WSL or Git Bash, then re-run: .\setup.ps1 -Mode vps'
}

function Choose-Mode {
  if ($script:SelectedMode -ne '') { return }
  if ($Yes) { $script:SelectedMode = 'desktop'; return }

  Write-Host 'What would you like to do?' -ForegroundColor White
  Write-Host ''
  Write-Host '  1) ' -ForegroundColor Cyan -NoNewline; Write-Host 'Install desktop deps     ' -NoNewline; Write-Host 'Node, pnpm, Rust, Tauri, MSVC, WebView2' -ForegroundColor DarkGray
  Write-Host '  2) ' -ForegroundColor Cyan -NoNewline; Write-Host 'Install VPS Docker stack ' -NoNewline; Write-Host 'delegates to install.sh (WSL/bash)' -ForegroundColor DarkGray
  Write-Host '  3) ' -ForegroundColor Cyan -NoNewline; Write-Host 'Full setup               ' -NoNewline; Write-Host 'desktop + Docker + build server + models' -ForegroundColor DarkGray
  Write-Host '  4) ' -ForegroundColor Cyan -NoNewline; Write-Host 'Check-only               ' -NoNewline; Write-Host 'detect toolchain, install nothing' -ForegroundColor DarkGray
  Write-Host ''

  $choice = Read-Answer 'Select option' '1'
  switch -Regex ($choice) {
    '^(1|desktop)$' { $script:SelectedMode = 'desktop' }
    '^(2|vps)$'     { $script:SelectedMode = 'vps' }
    '^(3|full)$'    { $script:SelectedMode = 'full' }
    '^(4|check)$'   { $script:SelectedMode = 'check' }
    default { throw "Invalid choice: $choice" }
  }
}

try {
  Show-Banner
  Choose-Mode
  Write-Info "Mode: $($script:SelectedMode)"

  switch ($script:SelectedMode) {
    'check'   { Invoke-CheckMode }
    'vps'     { Invoke-VpsMode }
    'desktop' { Invoke-DesktopMode }
    'full'    { Invoke-DesktopMode }
    default   { throw "Unknown mode: $($script:SelectedMode)" }
  }
} catch {
  Write-Err $_.Exception.Message
  exit 1
}
