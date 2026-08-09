#!/usr/bin/env bash
# PersonAI OS — cross-platform setup wizard (macOS / Linux)
#
#   curl -fsSL https://raw.githubusercontent.com/danielrlutz/personai/main/setup.sh | bash
#
# Non-interactive:
#   curl -fsSL .../setup.sh | bash -s -- --yes --mode=desktop
#   ./setup.sh --yes --mode=check
#
set -euo pipefail

REPO_URL="${PERSONAI_REPO_URL:-https://github.com/danielrlutz/personai.git}"
BRANCH="${PERSONAI_BRANCH:-main}"
DEFAULT_DIR="${PERSONAI_HOME:-$HOME/personai}"
RAW_BASE="${PERSONAI_RAW_BASE:-https://raw.githubusercontent.com/danielrlutz/personai/main}"

MODE=""                 # desktop | vps | full | check
ASSUME_YES=0
SKIP_CLONE=0
INSTALL_DIR=""
WITH_DOCKER="ask"       # yes | no | ask
PULL_MODELS="ask"      # yes | no | ask
BUILD_SERVER="ask"      # yes | no | ask
INSTALL_DIR_SET=0

# Step counters
STEP_TOTAL=0
STEP_CURRENT=0

RED=$'\033[0;31m'
GRN=$'\033[0;32m'
YLW=$'\033[0;33m'
BLU=$'\033[0;34m'
MAG=$'\033[0;35m'
CYN=$'\033[0;36m'
WHT=$'\033[1;37m'
DIM=$'\033[2m'
BOLD=$'\033[1m'
RST=$'\033[0m'

SPINNER_PID=""
SPIN_CHARS='⠋⠙⠹⠸⠴⠦⠧⠇⠏'

log()  { printf '%s\n' "$*"; }
# Fixed-width status column (Unicode glyphs vary in cell width across terminals).
info() { printf '  %s›%s  %s\n' "$CYN" "$RST" "$*"; }
ok()   { printf '  %s✓%s  %s\n' "$GRN" "$RST" "$*"; }
warn() { printf '  %s!%s  %s\n' "$YLW" "$RST" "$*"; }
err()  { printf '  %s✗%s  %s\n' "$RED" "$RST" "$*" >&2; }
die()  { stop_spinner; err "$*"; exit 1; }

term_cols() {
  local cols="${COLUMNS:-}"
  if [[ -z "$cols" || "$cols" -lt 1 ]] 2>/dev/null; then
    cols="$(stty size </dev/tty 2>/dev/null | awk '{print $2}')"
  fi
  cols="${cols:-80}"
  if [[ "$cols" -lt 48 ]]; then cols=48; fi
  if [[ "$cols" -gt 100 ]]; then cols=100; fi
  printf '%s' "$cols"
}

hrule() {
  local n=$(( $(term_cols) - 4 )) i line=""
  if [[ "$n" -lt 24 ]]; then n=24; fi
  if [[ "$n" -gt 64 ]]; then n=64; fi
  for ((i = 0; i < n; i++)); do line+="─"; done
  log "${DIM}${line}${RST}"
}

# Aligned menu row: "  N) <label padded>  <dim description>"
menu_row() {
  local num="$1" label="$2" desc="$3"
  printf '  %s%s)%s %-24s  %s%s%s\n' "$CYN" "$num" "$RST" "$label" "$DIM" "$desc" "$RST"
}

# Prefer real TTY even when piped (curl | bash)
if [[ -r /dev/tty ]]; then
  exec 3</dev/tty
  INTERACTIVE_TTY=1
else
  exec 3<&0
  INTERACTIVE_TTY=0
fi

usage() {
  cat <<'EOF'
PersonAI OS setup wizard — desktop + VPS bootstrap

Usage:
  ./setup.sh [options]
  curl -fsSL .../setup.sh | bash -s -- [options]

Modes (menu if omitted):
  --mode desktop   Install Node/pnpm/Rust/Tauri + platform build deps
  --mode vps       Delegate to install.sh (Docker Compose stack; Docker only)
  --mode full      Desktop deps + optional Docker + build server + models
  --mode check     Detect toolchain only (no installs; then next-step menu)

Options:
  --dir PATH         Repo / install directory (default: ~/personai or cwd)
  --yes, -y          Non-interactive (sensible defaults)
  --skip-clone       Use current directory (must be a PersonAI checkout)
  --docker yes|no    Install/ensure Docker (desktop/full)
  --pull-models yes|no
  --build-server yes|no
  -h, --help         Show help
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --mode) MODE="${2:-}"; shift 2 ;;
    --mode=*) MODE="${1#*=}"; shift ;;
    --dir) INSTALL_DIR="${2:-}"; INSTALL_DIR_SET=1; shift 2 ;;
    --dir=*) INSTALL_DIR="${1#*=}"; INSTALL_DIR_SET=1; shift ;;
    --yes|-y) ASSUME_YES=1; shift ;;
    --skip-clone) SKIP_CLONE=1; shift ;;
    --docker) WITH_DOCKER="${2:-}"; shift 2 ;;
    --docker=*) WITH_DOCKER="${1#*=}"; shift ;;
    --pull-models) PULL_MODELS="${2:-}"; shift 2 ;;
    --pull-models=*) PULL_MODELS="${1#*=}"; shift ;;
    --build-server) BUILD_SERVER="${2:-}"; shift 2 ;;
    --build-server=*) BUILD_SERVER="${1#*=}"; shift ;;
    -h|--help) usage; exit 0 ;;
    *) die "Unknown option: $1 (see --help)" ;;
  esac
done

ask() {
  local prompt="$1" default="${2:-}" reply
  if [[ $ASSUME_YES -eq 1 && -n "$default" ]]; then
    printf '%s\n' "$default"
    return
  fi
  if [[ -n "$default" ]]; then
    printf '%s [%s]: ' "$prompt" "$default" >&2
  else
    printf '%s: ' "$prompt" >&2
  fi
  IFS= read -r reply <&3 || true
  printf '%s\n' "${reply:-$default}"
}

ask_yn() {
  local prompt="$1" default="${2:-y}" reply hint="y/n"
  [[ "$default" == "y" ]] && hint="Y/n"
  [[ "$default" == "n" ]] && hint="y/N"
  if [[ $ASSUME_YES -eq 1 ]]; then
    [[ "$default" == "y" ]] && return 0 || return 1
  fi
  printf '%s [%s]: ' "$prompt" "$hint" >&2
  IFS= read -r reply <&3 || true
  reply="${reply:-$default}"
  case "${reply,,}" in y|yes) return 0 ;; *) return 1 ;; esac
}

have_cmd() { command -v "$1" >/dev/null 2>&1; }

need_cmd() { have_cmd "$1" || die "Missing required command: $1"; }

version_ge() {
  # version_ge A B → true if A >= B (dotted numeric)
  local a="$1" b="$2"
  printf '%s\n%s\n' "$a" "$b" | sort -V | head -n1 | grep -qx "$b"
}

stop_spinner() {
  if [[ -n "${SPINNER_PID:-}" ]] && kill -0 "$SPINNER_PID" 2>/dev/null; then
    kill "$SPINNER_PID" 2>/dev/null || true
    wait "$SPINNER_PID" 2>/dev/null || true
  fi
  SPINNER_PID=""
  printf '\r\033[K' >&2
}

start_spinner() {
  local msg="$1"
  stop_spinner
  if [[ $INTERACTIVE_TTY -eq 0 || $ASSUME_YES -eq 1 ]]; then
    info "$msg"
    return
  fi
  (
    local i=0
    while true; do
      local c="${SPIN_CHARS:i++%${#SPIN_CHARS}:1}"
      printf '\r%s%s%s %s' "$CYN" "$c" "$RST" "$msg" >&2
      sleep 0.08
    done
  ) &
  SPINNER_PID=$!
}

with_spinner() {
  local msg="$1"; shift
  start_spinner "$msg"
  local rc=0
  "$@" || rc=$?
  stop_spinner
  return $rc
}

begin_steps() { STEP_TOTAL="$1"; STEP_CURRENT=0; }

step() {
  STEP_CURRENT=$((STEP_CURRENT + 1))
  local title="$1"
  log ""
  log "${BOLD}${BLU}[$STEP_CURRENT/$STEP_TOTAL]${RST} ${WHT}${title}${RST}"
  hrule
}

print_banner() {
  # Inner width 42; 3-space indent after left border → pad content to 39.
  # Color codes sit outside the padded field so borders stay column-aligned.
  local w=39
  log ""
  log "${CYN}${BOLD}  ╔══════════════════════════════════════════╗${RST}"
  log "${CYN}${BOLD}  ║                                          ║${RST}"
  printf '  %s%s║   %s%-*s%s%s║%s\n' "$CYN" "$BOLD" "$WHT" "$w" "PersonAI OS  ·  Setup Wizard" "$CYN" "$BOLD" "$RST"
  printf '  %s%s║   %s%-*s%s%s║%s\n' "$CYN" "$BOLD" "$DIM" "$w" "desktop · tauri · docker · ollama" "$CYN" "$BOLD" "$RST"
  log "${CYN}${BOLD}  ║                                          ║${RST}"
  log "${CYN}${BOLD}  ╚══════════════════════════════════════════╝${RST}"
  log ""
}

detect_os() {
  case "$(uname -s 2>/dev/null || echo unknown)" in
    Darwin) echo "macos" ;;
    Linux)  echo "linux" ;;
    MINGW*|MSYS*|CYGWIN*) echo "windows" ;;
    *) echo "unknown" ;;
  esac
}

detect_linux_distro() {
  if [[ -f /etc/os-release ]]; then
    # shellcheck disable=SC1091
    . /etc/os-release
    echo "${ID:-unknown}"
  else
    echo "unknown"
  fi
}

# Headless / server heuristic: no GUI display, or Docker present without Tauri webkit.
is_vps_like_host() {
  [[ "$(detect_os)" == "linux" ]] || return 1
  if [[ -z "${DISPLAY:-}" && -z "${WAYLAND_DISPLAY:-}" ]]; then
    return 0
  fi
  if have_cmd docker; then
    if ! pkg-config --exists webkit2gtk-4.1 2>/dev/null && ! pkg-config --exists webkit2gtk-4.0 2>/dev/null; then
      return 0
    fi
  fi
  return 1
}

docker_ok_quiet() {
  have_cmd docker && docker compose version >/dev/null 2>&1
}

is_personai_root() {
  local d="$1"
  [[ -f "$d/package.json" ]] && { [[ -d "$d/src-tauri" ]] || [[ -d "$d/apps/server" ]]; }
}

resolve_repo_dir() {
  if [[ $SKIP_CLONE -eq 1 ]]; then
    INSTALL_DIR="$(pwd)"
    is_personai_root "$INSTALL_DIR" || die "--skip-clone set but $(pwd) is not a PersonAI checkout"
    return
  fi

  if [[ $INSTALL_DIR_SET -eq 1 ]]; then
    :
  elif is_personai_root "$(pwd)"; then
    INSTALL_DIR="$(pwd)"
  elif [[ -n "$INSTALL_DIR" ]]; then
    :
  else
    # Script may live inside the repo (./setup.sh or scripts/setup)
    local script_dir
    script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
    if is_personai_root "$script_dir"; then
      INSTALL_DIR="$script_dir"
    elif is_personai_root "$(dirname "$script_dir")"; then
      INSTALL_DIR="$(cd "$(dirname "$script_dir")" && pwd)"
    else
      INSTALL_DIR="$DEFAULT_DIR"
    fi
  fi

  if is_personai_root "$INSTALL_DIR"; then
    ok "Using PersonAI checkout: $INSTALL_DIR"
    return
  fi

  if [[ -d "$INSTALL_DIR/.git" ]]; then
    warn "$INSTALL_DIR exists but does not look like PersonAI — will try to use it anyway"
    return
  fi

  if [[ -e "$INSTALL_DIR" && ! -d "$INSTALL_DIR/.git" ]]; then
    if [[ -n "$(ls -A "$INSTALL_DIR" 2>/dev/null || true)" ]]; then
      die "Directory exists and is not empty: $INSTALL_DIR (pass --dir or --skip-clone)"
    fi
  fi

  info "Cloning $REPO_URL → $INSTALL_DIR"
  need_cmd git
  need_cmd curl
  mkdir -p "$(dirname "$INSTALL_DIR")"
  with_spinner "Cloning repository…" git clone --depth 1 --branch "$BRANCH" "$REPO_URL" "$INSTALL_DIR"
  ok "Cloned to $INSTALL_DIR"
}

choose_mode() {
  if [[ -n "$MODE" ]]; then
    case "$MODE" in
      desktop|vps|full|check|vps-deps) return ;;
      *) die "Invalid --mode: $MODE (desktop|vps|full|check)" ;;
    esac
  fi

  if [[ $ASSUME_YES -eq 1 ]]; then
    if is_vps_like_host; then
      MODE="vps"
    else
      MODE="desktop"
    fi
    return
  fi

  local default_choice="1"
  log "${BOLD}What would you like to do?${RST}"
  if is_vps_like_host; then
    default_choice="2"
    log ""
    log "${YLW}${BOLD}VPS / headless host detected${RST} ${DIM}(no GUI display, or Docker without Tauri webkit)${RST}"
    log "${DIM}Recommended: option 2 — Docker Compose via install.sh. Rust/Tauri are not required on a VPS.${RST}"
  fi
  log ""
  menu_row "1" "Install desktop deps" "Node, pnpm, Rust, Tauri, OS build tools"
  menu_row "2" "Install VPS Docker stack" "delegates to install.sh (Docker only)"
  menu_row "3" "Full setup" "desktop + Docker + build server + models"
  menu_row "4" "Check-only" "detect toolchain, install nothing"
  log ""

  local choice
  choice="$(ask "Select option" "$default_choice")"
  case "$choice" in
    1|desktop) MODE="desktop" ;;
    2|vps)     MODE="vps" ;;
    3|full)    MODE="full" ;;
    4|check)   MODE="check" ;;
    *) die "Invalid choice: $choice" ;;
  esac
}

# --- Detection helpers ------------------------------------------------------

check_node() {
  if have_cmd node; then
    local v
    v="$(node -v 2>/dev/null | sed 's/^v//')"
    if version_ge "$v" "20.0.0"; then
      ok "Node.js $v (>=20)"
      return 0
    fi
    warn "Node.js $v found — need >=20"
    return 1
  fi
  warn "Node.js not found"
  return 1
}

check_pnpm() {
  if have_cmd pnpm; then
    ok "pnpm $(pnpm -v 2>/dev/null || echo present)"
    return 0
  fi
  warn "pnpm not found"
  return 1
}

check_rust() {
  if have_cmd rustc && have_cmd cargo; then
    ok "Rust $(rustc --version 2>/dev/null | awk '{print $2}') / cargo $(cargo --version 2>/dev/null | awk '{print $2}')"
    return 0
  fi
  warn "Rust/cargo not found"
  return 1
}

check_tauri_cli() {
  if have_cmd cargo && cargo tauri --version >/dev/null 2>&1; then
    ok "Tauri CLI $(cargo tauri --version 2>/dev/null | head -n1)"
    return 0
  fi
  if have_cmd cargo-tauri || [[ -x "${HOME}/.cargo/bin/cargo-tauri" ]]; then
    ok "Tauri CLI present (cargo-tauri)"
    return 0
  fi
  warn "Tauri CLI v2 not found"
  return 1
}

check_docker() {
  if have_cmd docker && docker compose version >/dev/null 2>&1; then
    ok "Docker $(docker --version 2>/dev/null | head -n1) + Compose"
    return 0
  fi
  if have_cmd docker; then
    warn "Docker found but Compose plugin missing"
    return 1
  fi
  warn "Docker not found"
  return 1
}

port_listening() {
  local port="$1"
  if have_cmd ss; then
    ss -ltn "( sport = :$port )" 2>/dev/null | grep -q ":$port" && return 0
  fi
  if have_cmd lsof; then
    lsof -iTCP:"$port" -sTCP:LISTEN >/dev/null 2>&1 && return 0
  fi
  return 1
}

http_ok() {
  local url="$1"
  curl -fsS --max-time 2 "$url" >/dev/null 2>&1
}

# Detect host-installed Ollama (not compose). Sets NATIVE_OLLAMA_* globals.
NATIVE_OLLAMA_BINARY=""
NATIVE_OLLAMA_HTTP=""
NATIVE_OLLAMA_PROCESS=0
NATIVE_OLLAMA_PORT=0

discover_native_ollama() {
  NATIVE_OLLAMA_BINARY=""
  NATIVE_OLLAMA_HTTP=""
  NATIVE_OLLAMA_PROCESS=0
  NATIVE_OLLAMA_PORT=0

  if have_cmd ollama; then
    NATIVE_OLLAMA_BINARY="$(command -v ollama)"
  fi
  if have_cmd pgrep && pgrep -x ollama >/dev/null 2>&1; then
    NATIVE_OLLAMA_PROCESS=1
  elif have_cmd ps && ps -eo comm 2>/dev/null | grep -qx ollama; then
    NATIVE_OLLAMA_PROCESS=1
  fi
  if port_listening 11434; then
    NATIVE_OLLAMA_PORT=1
  fi
  local url
  for url in "http://127.0.0.1:11434/api/tags" "http://localhost:11434/api/tags"; do
    if http_ok "$url"; then
      NATIVE_OLLAMA_HTTP="${url%/api/tags}"
      break
    fi
  done
}

native_ollama_detected() {
  [[ -n "$NATIVE_OLLAMA_BINARY" || -n "$NATIVE_OLLAMA_HTTP" || $NATIVE_OLLAMA_PROCESS -eq 1 || $NATIVE_OLLAMA_PORT -eq 1 ]]
}

check_ollama() {
  discover_native_ollama
  if [[ -n "$NATIVE_OLLAMA_HTTP" ]]; then
    ok "Native Ollama HTTP at ${NATIVE_OLLAMA_HTTP} (/api/tags)"
    return 0
  fi
  if [[ -n "$NATIVE_OLLAMA_BINARY" ]]; then
    ok "Ollama CLI: $NATIVE_OLLAMA_BINARY (API not answering yet on :11434)"
    return 0
  fi
  if [[ $NATIVE_OLLAMA_PROCESS -eq 1 || $NATIVE_OLLAMA_PORT -eq 1 ]]; then
    ok "Ollama process/port signals present (binary may be outside PATH)"
    return 0
  fi
  warn "Native Ollama not detected (optional for desktop — install from https://ollama.com)"
  return 1
}

ensure_desktop_ollama_env() {
  local env_file="$INSTALL_DIR/.env"
  local host="${NATIVE_OLLAMA_HTTP:-http://127.0.0.1:11434}"
  mkdir -p "$INSTALL_DIR"
  if [[ ! -f "$env_file" ]]; then
    cat >"$env_file" <<EOF
# Generated by setup.sh — desktop / native Ollama
DATA_DIR=./data
PORT=4000
OLLAMA_HOST=${host}
OLLAMA_PUBLIC_HOST=${host}
PERSONAI_OLLAMA_MODE=existing-native
OLLAMA_VISION_MODEL=maternion/LightOnOCR-2
OLLAMA_REASONING_MODEL=deepseek-r1:8b
NEXT_PUBLIC_API_URL=http://localhost:4000
LICENSE_TIER=pro
EOF
    ok "Wrote $env_file (native Ollama → $host)"
    return
  fi
  if grep -qE '^OLLAMA_HOST=' "$env_file"; then
    info "Keeping existing OLLAMA_HOST in .env"
  else
    printf '\nOLLAMA_HOST=%s\nPERSONAI_OLLAMA_MODE=existing-native\n' "$host" >>"$env_file"
    ok "Appended OLLAMA_HOST=$host to .env"
  fi
}

check_xcode_clt() {
  if xcode-select -p >/dev/null 2>&1; then
    ok "Xcode Command Line Tools: $(xcode-select -p)"
    return 0
  fi
  warn "Xcode Command Line Tools missing"
  return 1
}

check_linux_tauri_deps() {
  local missing=()
  local pkg
  # Heuristic: look for headers / libs commonly needed by Tauri on Linux
  for pkg in pkg-config; do
    have_cmd "$pkg" || missing+=("$pkg")
  done
  if ! pkg-config --exists webkit2gtk-4.1 2>/dev/null && ! pkg-config --exists webkit2gtk-4.0 2>/dev/null; then
    missing+=("webkit2gtk")
  fi
  if ! pkg-config --exists libayatana-appindicator3-0.1 2>/dev/null && ! pkg-config --exists appindicator3-0.1 2>/dev/null; then
    missing+=("appindicator")
  fi
  if ((${#missing[@]})); then
    warn "Linux Tauri deps may be missing: ${missing[*]}"
    return 1
  fi
  ok "Linux Tauri build dependencies look present"
  return 0
}

# --- Installers -------------------------------------------------------------

install_node() {
  local os
  os="$(detect_os)"
  if have_cmd brew; then
    with_spinner "Installing Node.js via Homebrew…" brew install node@20 || brew install node
  elif have_cmd apt-get; then
    with_spinner "Installing Node.js 20 (NodeSource)…" bash -c \
      "curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash - && sudo apt-get install -y nodejs"
  elif have_cmd dnf; then
    with_spinner "Installing Node.js via dnf…" sudo dnf install -y nodejs
  elif have_cmd pacman; then
    with_spinner "Installing Node.js via pacman…" sudo pacman -Sy --noconfirm nodejs npm
  else
    info "Installing Node via nvm…"
    export NVM_DIR="${NVM_DIR:-$HOME/.nvm}"
    if [[ ! -s "$NVM_DIR/nvm.sh" ]]; then
      with_spinner "Installing nvm…" bash -c "curl -fsSL https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh | bash"
    fi
    # shellcheck disable=SC1091
    [[ -s "$NVM_DIR/nvm.sh" ]] && . "$NVM_DIR/nvm.sh"
    with_spinner "Installing Node 20 via nvm…" nvm install 20
    nvm use 20
  fi
  # Refresh PATH
  hash -r 2>/dev/null || true
  check_node || die "Node.js install failed — install Node >=20 manually and re-run"
}

# Install pnpm. Pass 0 as first arg for optional/VPS path (warn + continue on failure).
install_pnpm() {
  local required="${1:-1}"
  local npm_prefix="${NPM_CONFIG_PREFIX:-$HOME/.local}"

  if have_cmd corepack; then
    if corepack enable >/dev/null 2>&1; then
      with_spinner "Preparing pnpm via corepack…" corepack prepare pnpm@9.15.0 --activate || true
    else
      warn "corepack enable needs elevated permissions (EACCES on /usr/bin/pnpm is common)"
      if have_cmd sudo; then
        with_spinner "Enabling corepack with sudo…" sudo corepack enable || true
        sudo corepack prepare pnpm@9.15.0 --activate || true
      fi
    fi
  fi

  hash -r 2>/dev/null || true
  if ! have_cmd pnpm && have_cmd npm; then
    mkdir -p "$npm_prefix/bin"
    export PATH="$npm_prefix/bin:$PATH"
    # User-local install avoids needing write access to /usr/bin
    with_spinner "Installing pnpm (user-local under $npm_prefix)…" \
      npm install -g pnpm@9 --prefix "$npm_prefix" || true
    export PATH="$npm_prefix/bin:$PATH"
  fi

  hash -r 2>/dev/null || true
  if check_pnpm; then
    return 0
  fi
  if [[ "$required" == "1" ]]; then
    die "pnpm install failed — try: sudo corepack enable && sudo corepack prepare pnpm@9.15.0 --activate"
  fi
  warn "pnpm not available — OK for Docker-only VPS path (host pnpm is optional)"
  return 1
}

install_rust() {
  if [[ -f "$HOME/.cargo/env" ]]; then
    # shellcheck disable=SC1091
    . "$HOME/.cargo/env"
  fi
  if have_cmd rustup; then
    with_spinner "Updating Rust stable…" rustup update stable
    rustup default stable
  else
    with_spinner "Installing rustup…" bash -c "curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y --default-toolchain stable"
    # shellcheck disable=SC1091
    . "$HOME/.cargo/env"
  fi
  export PATH="$HOME/.cargo/bin:$PATH"
  check_rust || die "Rust install failed"
}

install_tauri_cli() {
  export PATH="$HOME/.cargo/bin:$PATH"
  need_cmd cargo
  with_spinner "Installing Tauri CLI v2 (cargo install)…" \
    cargo install tauri-cli --version "^2" --locked
  ok "Tauri CLI installed"
}

install_xcode_clt() {
  info "Triggering Xcode Command Line Tools installer…"
  warn "A macOS dialog may appear — complete it, then re-run this wizard if needed."
  xcode-select --install 2>/dev/null || true
  # Wait a bit for user; don't hard-fail in --yes mode
  if [[ $ASSUME_YES -eq 0 ]]; then
    ask "Press Enter after CLT install finishes (or skip)" ""
  fi
  if check_xcode_clt; then
    return 0
  fi
  warn "CLT still missing — desktop builds will fail until installed"
}

install_linux_tauri_deps() {
  local distro
  distro="$(detect_linux_distro)"
  info "Detected distro: $distro"

  case "$distro" in
    ubuntu|debian|linuxmint|pop)
      local pkgs=(
        build-essential curl wget file libssl-dev
        libgtk-3-dev libwebkit2gtk-4.1-dev
        libayatana-appindicator3-dev librsvg2-dev
        patchelf pkg-config
      )
      # Fallback webkit if 4.1 unavailable
      if ! apt-cache show libwebkit2gtk-4.1-dev >/dev/null 2>&1; then
        pkgs=(build-essential curl wget file libssl-dev libgtk-3-dev libwebkit2gtk-4.0-dev libayatana-appindicator3-dev librsvg2-dev patchelf pkg-config)
      fi
      with_spinner "Installing Tauri apt packages…" sudo apt-get update
      with_spinner "Installing packages…" sudo DEBIAN_FRONTEND=noninteractive apt-get install -y "${pkgs[@]}"
      ;;
    fedora)
      with_spinner "Installing Tauri dnf packages…" sudo dnf install -y \
        webkit2gtk4.1-devel openssl-devel curl wget file \
        libappindicator-gtk3-devel librsvg2-devel \
        gcc gcc-c++ gtk3-devel
      ;;
    arch|manjaro)
      with_spinner "Installing Tauri pacman packages…" sudo pacman -Sy --noconfirm \
        webkit2gtk-4.1 base-devel curl wget file openssl \
        appmenu-gtk-module gtk3 libappindicator-gtk3 librsvg libvips
      ;;
    opensuse*|sles)
      with_spinner "Installing Tauri zypper packages…" sudo zypper install -y \
        webkit2gtk3-soup2-devel libopenssl-devel curl wget file \
        libappindicator3-devel librsvg-devel gcc gcc-c++ gtk3-devel
      ;;
    *)
      warn "Unknown distro — install Tauri Linux deps manually:"
      log "  https://v2.tauri.app/start/prerequisites/"
      return 1
      ;;
  esac
  check_linux_tauri_deps || warn "Some deps still missing — see Tauri prerequisites docs"
}

install_docker_unix() {
  if check_docker; then return 0; fi
  if [[ "$(detect_os)" == "macos" ]]; then
    if have_cmd brew; then
      with_spinner "Installing Docker via Homebrew (cask)…" brew install --cask docker || true
      warn "Open Docker Desktop once to finish setup, then re-run if needed."
    else
      warn "Install Docker Desktop from https://www.docker.com/products/docker-desktop/"
    fi
    return 0
  fi
  if ask_yn "Install Docker via get.docker.com?" "y"; then
    with_spinner "Installing Docker…" bash -c "curl -fsSL https://get.docker.com | sh"
    if [[ "$(id -u)" -ne 0 ]]; then
      ask_yn "Add $USER to docker group (re-login required)?" "y" && sudo usermod -aG docker "$USER" || true
    fi
  fi
  check_docker || warn "Docker still unavailable in this shell"
}

ensure_path_cargo() {
  export PATH="$HOME/.cargo/bin:$PATH"
  if [[ -f "$HOME/.cargo/env" ]]; then
    # shellcheck disable=SC1091
    . "$HOME/.cargo/env"
  fi
}

run_pnpm_install() {
  cd "$INSTALL_DIR"
  ensure_path_cargo
  if [[ ! -d node_modules ]]; then
    with_spinner "pnpm install…" pnpm install
    ok "Dependencies installed"
  else
    info "node_modules present — running pnpm install to sync…"
    with_spinner "pnpm install…" pnpm install
    ok "Dependencies synced"
  fi
}

run_build_server() {
  cd "$INSTALL_DIR"
  with_spinner "Building server (pnpm build:server)…" pnpm build:server
  ok "Server built — Tauri sidecar ready"
}

maybe_pull_models() {
  cd "$INSTALL_DIR"
  discover_native_ollama
  if [[ "$PULL_MODELS" == "ask" ]]; then
    local default_pull="n"
    native_ollama_detected && default_pull="y"
    if ask_yn "Pull Ollama models (OCR + reasoning)?" "$default_pull"; then
      PULL_MODELS="yes"
    else
      PULL_MODELS="no"
    fi
  fi
  [[ "$PULL_MODELS" == "yes" ]] || return 0

  # Prefer native CLI when available — do not require Docker for desktop.
  if have_cmd ollama || [[ -n "$NATIVE_OLLAMA_BINARY" ]]; then
    local cli="${NATIVE_OLLAMA_BINARY:-ollama}"
    info "Pulling models via native Ollama…"
    if ! http_ok "http://127.0.0.1:11434/api/tags" && ! http_ok "http://localhost:11434/api/tags"; then
      ("$cli" serve >/dev/null 2>&1 &) || true
      sleep 2
    fi
    "$cli" pull maternion/LightOnOCR-2 || true
    "$cli" pull deepseek-r1:8b || true
  elif have_cmd docker && docker compose ps ollama >/dev/null 2>&1; then
    info "Pulling models via docker compose ollama…"
    docker compose exec -T ollama ollama pull maternion/LightOnOCR-2 || true
    docker compose exec -T ollama ollama pull deepseek-r1:8b || true
  else
    warn "Neither native ollama CLI nor compose ollama service available — skip model pull"
    return 0
  fi
  ok "Model pull attempted"
}

# --- Modes ------------------------------------------------------------------

print_check_report() {
  local os vps_like=0
  os="$(detect_os)"
  local extra=""
  [[ "$os" == "linux" ]] && extra=" · $(detect_linux_distro)"
  is_vps_like_host && vps_like=1

  log ""
  if [[ $vps_like -eq 1 ]]; then
    log "${BOLD}${WHT}Toolchain check${RST}  ${DIM}($os${extra} · VPS / server)${RST}"
    log ""
    log "${YLW}Recommended path: VPS Docker stack${RST} ${DIM}(install.sh / docker compose)${RST}"
    log "${DIM}Rust, Tauri, and webkit are desktop-only — missing them is fine on a VPS.${RST}"
    log ""
    log "${BOLD}VPS / Docker${RST}"
    check_docker || true
    check_ollama || true
    log ""
    log "${BOLD}Optional host tools${RST} ${DIM}(only if building outside Docker)${RST}"
    if have_cmd node; then
      check_node || true
    else
      info "Node.js — optional for VPS (docker compose builds without host Node)"
    fi
    if have_cmd pnpm; then
      check_pnpm || true
    else
      info "pnpm — optional for VPS (not required for docker compose)"
    fi
    log ""
    log "${BOLD}Desktop / Tauri${RST} ${DIM}(not required on this host)${RST}"
    if have_cmd rustc && have_cmd cargo; then
      check_rust || true
    else
      info "Rust/cargo — not required for VPS (desktop/Tauri only)"
    fi
    if have_cmd cargo && cargo tauri --version >/dev/null 2>&1; then
      check_tauri_cli || true
    else
      info "Tauri CLI — not required for VPS (desktop/Tauri only)"
    fi
    if [[ "$os" == "linux" ]]; then
      if pkg-config --exists webkit2gtk-4.1 2>/dev/null || pkg-config --exists webkit2gtk-4.0 2>/dev/null; then
        check_linux_tauri_deps || true
      else
        info "webkit/Tauri Linux packages — not required for VPS (desktop only)"
      fi
    fi
  else
    log "${BOLD}${WHT}Toolchain check${RST}  ${DIM}($os${extra})${RST}"
    log ""
    check_node || true
    check_pnpm || true
    check_rust || true
    check_tauri_cli || true
    check_ollama || true
    check_docker || true
    case "$os" in
      macos) check_xcode_clt || true ;;
      linux) check_linux_tauri_deps || true ;;
    esac
  fi
  log ""
}

print_check_summary() {
  log "${BOLD}Check-only installs nothing.${RST}"
  if is_vps_like_host; then
    log "For a VPS: pick ${CYN}Run VPS install${RST} next, or run:"
    log "  ${WHT}./install.sh${RST}"
    log "  ${DIM}# or: ./setup.sh --mode=vps${RST}"
    log "Docker Compose is enough — you do not need Rust or Tauri on the server."
  else
    log "Next: install desktop deps, run the VPS Docker path, or exit."
    log "  ${DIM}Desktop: ./setup.sh --mode=desktop${RST}"
    log "  ${DIM}VPS:     ./setup.sh --mode=vps   # or ./install.sh${RST}"
  fi
  log ""
}

# Interactive follow-up after check-only so the wizard does not feel like a dead end.
# Sets MODE and returns 0 to continue the main loop, or exits on option 4.
post_check_menu() {
  if [[ $ASSUME_YES -eq 1 || $INTERACTIVE_TTY -eq 0 ]]; then
    print_check_summary
    return 1
  fi

  local default_choice="3"
  is_vps_like_host || default_choice="1"

  log "${BOLD}What next?${RST}"
  log ""
  log "  ${CYN}1)${RST} Install missing deps for ${BOLD}VPS/Docker${RST}"
  log "     ${DIM}Docker + Compose only; Node/pnpm optional — Rust/Tauri not installed${RST}"
  log "  ${CYN}2)${RST} Install missing deps for ${BOLD}Desktop/Tauri${RST}"
  log "     ${DIM}Node, pnpm, Rust, Tauri, OS build tools${RST}"
  log "  ${CYN}3)${RST} Run ${BOLD}VPS install${RST} now ${DIM}(./install.sh — Docker Compose stack)${RST}"
  log "  ${CYN}4)${RST} Exit"
  log ""
  print_check_summary

  local choice
  choice="$(ask "Select option" "$default_choice")"
  case "$choice" in
    1|vps-deps|deps) MODE="vps-deps" ;;
    2|desktop)       MODE="desktop" ;;
    3|vps|install)   MODE="vps" ;;
    4|exit|q|quit)   info "Exiting — no changes made."; exit 0 ;;
    *) die "Invalid choice: $choice" ;;
  esac
  return 0
}

run_check() {
  begin_steps 1
  step "Detect installed toolchain"
  print_check_report
  ok "Check complete — no changes made"
}

run_vps_deps() {
  begin_steps 2
  step "Ensure Docker + Compose (VPS path)"
  info "VPS deploy uses docker compose — host Node/pnpm/Rust/Tauri are not required."
  if docker_ok_quiet; then
    check_docker || true
  else
    if [[ $ASSUME_YES -eq 1 ]] || ask_yn "Install / ensure Docker + Compose?" "y"; then
      install_docker_unix
    else
      warn "Docker is required for the VPS path — install it, then re-run."
    fi
  fi

  step "Optional host Node / pnpm"
  info "Only needed if you build or develop outside Docker on this machine."
  info "VPS docker compose does not require host pnpm."
  if [[ $ASSUME_YES -eq 1 ]]; then
    info "Skipping optional Node/pnpm (--yes defaults to Docker-only VPS deps)"
  elif ask_yn "Also install Node.js >=20 and pnpm on the host?" "n"; then
    if ! check_node; then
      install_node
    fi
    if ! check_pnpm; then
      # optional: never abort VPS deps on pnpm permission failures
      install_pnpm 0 || true
    fi
  else
    ok "Skipping host Node/pnpm — docker compose is enough"
  fi

  log ""
  ok "VPS host deps ready"
  if docker_ok_quiet; then
    log "Continue with: ${WHT}./install.sh${RST}  or choose ${CYN}Run VPS install${RST} in the next menu."
  else
    warn "Docker still unavailable in this shell — fix Docker, then run ./install.sh"
  fi
  log ""
}

run_desktop() {
  local os
  os="$(detect_os)"
  [[ "$os" == "windows" ]] && die "Use setup.ps1 / setup.cmd on Windows"

  discover_native_ollama
  # resolve, native, platform, node, pnpm, rust, tauri, deps[+docker][+models]
  local steps=8
  if [[ "$MODE" == "full" ]]; then
    steps=10
  elif native_ollama_detected; then
    steps=9
  fi
  begin_steps "$steps"

  step "Resolve repository"
  resolve_repo_dir

  step "Native Ollama"
  if native_ollama_detected; then
    ok "Using existing native Ollama${NATIVE_OLLAMA_HTTP:+ at $NATIVE_OLLAMA_HTTP}"
    ensure_desktop_ollama_env
  else
    warn "No native Ollama detected — desktop can still run; install later from https://ollama.com"
    info "Docker is optional and not required for a host-installed Ollama."
  fi

  step "Platform build tools"
  case "$os" in
    macos)
      if ! check_xcode_clt; then
        if [[ $ASSUME_YES -eq 1 ]] || ask_yn "Install Xcode Command Line Tools?" "y"; then
          install_xcode_clt
        fi
      fi
      ;;
    linux)
      if ! check_linux_tauri_deps; then
        if [[ $ASSUME_YES -eq 1 ]] || ask_yn "Install Linux Tauri build packages?" "y"; then
          install_linux_tauri_deps
        fi
      fi
      ;;
  esac

  step "Node.js (>=20)"
  if ! check_node; then
    if [[ $ASSUME_YES -eq 1 ]] || ask_yn "Install Node.js >=20?" "y"; then
      install_node
    else
      die "Node.js is required"
    fi
  fi

  step "pnpm"
  if ! check_pnpm; then
    if [[ $ASSUME_YES -eq 1 ]] || ask_yn "Install pnpm?" "y"; then
      install_pnpm
    else
      die "pnpm is required"
    fi
  fi

  step "Rust (rustup + stable)"
  ensure_path_cargo
  if ! check_rust; then
    if [[ $ASSUME_YES -eq 1 ]] || ask_yn "Install Rust via rustup?" "y"; then
      install_rust
    else
      die "Rust is required for Tauri"
    fi
  fi

  step "Tauri CLI v2"
  ensure_path_cargo
  if ! check_tauri_cli; then
    if [[ $ASSUME_YES -eq 1 ]] || ask_yn "Install Tauri CLI v2 via cargo?" "y"; then
      install_tauri_cli
    else
      warn "Skipping Tauri CLI — install later with: cargo install tauri-cli --version \"^2\""
    fi
  fi

  if [[ "$MODE" == "full" ]]; then
    step "Docker (optional — not required for native Ollama)"
    if [[ "$WITH_DOCKER" == "ask" ]]; then
      local docker_default="n"
      # Only nudge toward Docker when native Ollama is missing
      native_ollama_detected || docker_default="y"
      if ask_yn "Ensure Docker + Compose (VPS / bundled Ollama path)?" "$docker_default"; then
        WITH_DOCKER="yes"
      else
        WITH_DOCKER="no"
      fi
    fi
    if [[ "$WITH_DOCKER" == "yes" ]]; then
      install_docker_unix
    else
      info "Skipping Docker (native Ollama / desktop path)"
    fi
  fi

  step "Project dependencies + server build"
  run_pnpm_install
  if [[ "$BUILD_SERVER" == "ask" ]]; then
    if [[ "$MODE" == "full" ]]; then
      BUILD_SERVER="yes"
    elif ask_yn "Build server now (needed for Tauri sidecar)?" "y"; then
      BUILD_SERVER="yes"
    else
      BUILD_SERVER="no"
    fi
  fi
  if [[ "$BUILD_SERVER" == "yes" ]]; then
    run_build_server
  else
    info "Skipped server build — run: pnpm build:server"
  fi

  if [[ "$MODE" == "full" ]] || native_ollama_detected; then
    step "Ollama models"
    maybe_pull_models
  fi

  print_desktop_summary
}

print_desktop_summary() {
  ensure_path_cargo
  discover_native_ollama
  local ollama_line="not detected"
  if native_ollama_detected; then
    ollama_line="native ${NATIVE_OLLAMA_HTTP:-detected}"
  fi
  cat <<EOF

${BOLD}${GRN}Desktop setup complete${RST}

  Repo     : ${INSTALL_DIR}
  Node     : $(node -v 2>/dev/null || echo n/a)
  pnpm     : $(pnpm -v 2>/dev/null || echo n/a)
  Rust     : $(rustc --version 2>/dev/null || echo n/a)
  Tauri    : $(cargo tauri --version 2>/dev/null | head -n1 || echo "not installed")
  Ollama   : ${ollama_line}

Next steps:
  cd ${INSTALL_DIR}
  pnpm build:server && pnpm build:web
  pnpm tauri:dev

Native Ollama (default for desktop): keep OLLAMA_HOST=http://127.0.0.1:11434 in .env
VPS / Docker stack anytime:
  ./install.sh
  # or: ./setup.sh --mode=vps

EOF
}

run_vps() {
  begin_steps 2
  step "Locate install.sh"
  local installer=""
  if [[ -f "./install.sh" ]]; then
    installer="$(pwd)/install.sh"
  elif [[ -n "$INSTALL_DIR" && -f "$INSTALL_DIR/install.sh" ]]; then
    installer="$INSTALL_DIR/install.sh"
  else
    local script_dir
    script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
    if [[ -f "$script_dir/install.sh" ]]; then
      installer="$script_dir/install.sh"
    elif [[ -f "$(dirname "$script_dir")/install.sh" ]]; then
      installer="$(cd "$(dirname "$script_dir")" && pwd)/install.sh"
    fi
  fi

  local -a forward=( )
  [[ $ASSUME_YES -eq 1 ]] && forward+=(--yes)
  [[ $INSTALL_DIR_SET -eq 1 ]] && forward+=(--dir "$INSTALL_DIR")
  [[ $SKIP_CLONE -eq 1 ]] && forward+=(--skip-clone)

  step "Run VPS Docker installer"
  if [[ -n "$installer" ]]; then
    ok "Delegating to $installer"
    exec bash "$installer" "${forward[@]}"
  fi

  info "install.sh not local — fetching from $RAW_BASE/install.sh"
  need_cmd curl
  exec bash -c "curl -fsSL '$RAW_BASE/install.sh' | bash -s -- $(printf '%q ' "${forward[@]}")"
}

main() {
  print_banner

  # After check-only (and VPS-deps), keep prompting so the session feels continuous.
  while true; do
    choose_mode
    info "Mode: ${BOLD}${MODE}${RST}"

    case "$MODE" in
      check)
        run_check
        MODE=""
        if post_check_menu; then
          continue
        fi
        break
        ;;
      vps-deps)
        run_vps_deps
        MODE=""
        if post_check_menu; then
          continue
        fi
        break
        ;;
      vps)
        run_vps
        break
        ;;
      desktop|full)
        run_desktop
        break
        ;;
      *)
        die "Unknown mode: $MODE"
        ;;
    esac
  done
}

trap stop_spinner EXIT
main "$@"
