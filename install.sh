#!/usr/bin/env bash
# PersonAI OS — install OR update (same command)
#
#   curl -fsSL https://raw.githubusercontent.com/danielrlutz/personai/main/install.sh | bash
#
# Non-interactive:
#   curl -fsSL .../install.sh | bash -s -- --yes --ollama=new-docker --tier=pro
#   curl -fsSL .../install.sh | bash -s -- --yes --update
#
set -euo pipefail

REPO_URL="${PERSONAI_REPO_URL:-https://github.com/danielrlutz/personai.git}"
BRANCH="${PERSONAI_BRANCH:-main}"
DEFAULT_DIR="${PERSONAI_HOME:-$HOME/personai}"
STATE_FILE_NAME=".personai-install"

# Defaults
INSTALL_DIR=""
OLLAMA_MODE=""          # existing-native | existing-docker | new-docker | skip
OLLAMA_HOST="http://127.0.0.1:11434"
LICENSE_TIER="pro"
APP_PORT="3000"
API_PORT="4000"
DATA_DIR=""
DOMAIN=""
ENABLE_TLS="ask"
PULL_MODELS="ask"
START_NOW="ask"
CREATE_SYSTEMD="ask"
ASSUME_YES=0
SKIP_CLONE=0
FORCE_MODE=""           # install | update (empty = auto-detect)
IS_UPDATE=0
PREV_COMMIT=""
NEW_COMMIT=""

RED=$'\033[0;31m'
GRN=$'\033[0;32m'
YLW=$'\033[0;33m'
CYN=$'\033[0;36m'
DIM=$'\033[2m'
BOLD=$'\033[1m'
RST=$'\033[0m'

log()  { printf '%s\n' "$*"; }
info() { printf '%s›%s %s\n' "$CYN" "$RST" "$*"; }
ok()   { printf '%s✓%s %s\n' "$GRN" "$RST" "$*"; }
warn() { printf '%s!%s %s\n' "$YLW" "$RST" "$*"; }
err()  { printf '%sx%s %s\n' "$RED" "$RST" "$*" >&2; }
die()  { err "$*"; exit 1; }

if [[ -r /dev/tty ]]; then
  exec 3</dev/tty
else
  exec 3<&0
fi

usage() {
  cat <<'EOF'
PersonAI OS installer / updater

Same command installs fresh OR upgrades an existing install:

  curl -fsSL https://raw.githubusercontent.com/danielrlutz/personai/main/install.sh | bash

Options:
  --dir PATH              Install directory (default: ~/personai or detected)
  --update                Force update mode
  --install               Force fresh install prompts
  --ollama MODE           existing-native | existing-docker | new-docker | skip
  --ollama-host URL       Ollama base URL
  --tier core|pro         License tier
  --port N                Web UI host port
  --api-port N            API host port
  --data-dir PATH         Persistent data directory
  --domain FQDN           Public hostname
  --tls yes|no            HTTPS via Caddy
  --pull-models yes|no    Pull OCR + reasoning models
  --start yes|no          Start/restart stack after install/update
  --systemd yes|no        User systemd unit
  --yes, -y               Non-interactive defaults
  --skip-clone            Use current directory
  -h, --help              Show help
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --dir) INSTALL_DIR="${2:-}"; shift 2 ;;
    --update) FORCE_MODE="update"; shift ;;
    --install) FORCE_MODE="install"; shift ;;
    --ollama) OLLAMA_MODE="${2:-}"; shift 2 ;;
    --ollama-host) OLLAMA_HOST="${2:-}"; shift 2 ;;
    --tier) LICENSE_TIER="${2:-}"; shift 2 ;;
    --port) APP_PORT="${2:-}"; shift 2 ;;
    --api-port) API_PORT="${2:-}"; shift 2 ;;
    --data-dir) DATA_DIR="${2:-}"; shift 2 ;;
    --domain) DOMAIN="${2:-}"; shift 2 ;;
    --tls) ENABLE_TLS="${2:-}"; shift 2 ;;
    --pull-models) PULL_MODELS="${2:-}"; shift 2 ;;
    --start) START_NOW="${2:-}"; shift 2 ;;
    --systemd) CREATE_SYSTEMD="${2:-}"; shift 2 ;;
    --yes|-y) ASSUME_YES=1; shift ;;
    --skip-clone) SKIP_CLONE=1; shift ;;
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

need_cmd() { command -v "$1" >/dev/null 2>&1 || die "Missing required command: $1"; }

port_in_use() {
  local port="$1"
  if command -v ss >/dev/null 2>&1; then
    ss -ltn "( sport = :$port )" 2>/dev/null | grep -q ":$port" && return 0
  fi
  if command -v lsof >/dev/null 2>&1; then
    lsof -iTCP:"$port" -sTCP:LISTEN >/dev/null 2>&1 && return 0
  fi
  return 1
}

http_ok() {
  local url="$1"
  curl -fsS --max-time 2 "$url" >/dev/null 2>&1
}

detect_gpu() {
  if command -v nvidia-smi >/dev/null 2>&1 && nvidia-smi >/dev/null 2>&1; then
    nvidia-smi --query-gpu=name,memory.total --format=csv,noheader 2>/dev/null | head -n1
  elif [[ -e /dev/nvidia0 ]]; then
    echo "NVIDIA device present"
  else
    echo ""
  fi
}

clear_banner() {
  cat <<EOF

${BOLD}${CYN}PersonAI OS${RST} — Privacy-First Life Management Suite
${DIM}install · update · local-first · Docker · Ollama${RST}

EOF
}

# --- Existing install detection ---------------------------------------------

candidate_dirs() {
  local -a dirs=()
  [[ -n "${INSTALL_DIR}" ]] && dirs+=("$INSTALL_DIR")
  dirs+=("$DEFAULT_DIR" "$HOME/personai-os" "$HOME/personai" "/opt/personai" "$(pwd)")
  local d
  for d in "${dirs[@]}"; do
    [[ -n "$d" ]] && printf '%s\n' "$d"
  done | awk '!seen[$0]++'
}

is_personai_root() {
  local d="$1"
  [[ -f "$d/docker-compose.yml" || -f "$d/docker-compose.prod.yml" ]] \
    && [[ -f "$d/package.json" || -d "$d/apps/server" || -f "$d/$STATE_FILE_NAME" ]]
}

load_env_defaults() {
  local env_file="$1"
  [[ -f "$env_file" ]] || return 0
  # shellcheck disable=SC1090
  set -a
  # Only import known keys (avoid eval surprises)
  while IFS='=' read -r key val; do
    [[ "$key" =~ ^[A-Z0-9_]+$ ]] || continue
    val="${val%$'\r'}"
    case "$key" in
      DATA_DIR) DATA_DIR="${DATA_DIR:-$val}" ;;
      PORT) API_PORT="${API_PORT:-$val}" ;;
      OLLAMA_HOST) ;; # compose-internal; use public below
      OLLAMA_PUBLIC_HOST) OLLAMA_HOST="${OLLAMA_HOST:-$val}" ;;
      LICENSE_TIER) LICENSE_TIER="${LICENSE_TIER:-$val}" ;;
      PERSONAI_WEB_PORT) APP_PORT="${APP_PORT:-$val}" ;;
      PERSONAI_DOMAIN) DOMAIN="${DOMAIN:-$val}" ;;
      PERSONAI_TLS) ENABLE_TLS="${ENABLE_TLS:-$val}" ;;
      PERSONAI_OLLAMA_MODE) OLLAMA_MODE="${OLLAMA_MODE:-$val}" ;;
    esac
  done < <(grep -E '^[A-Z0-9_]+=' "$env_file" || true)
  set +a
}

detect_install_state() {
  local d found=""
  while IFS= read -r d; do
    if is_personai_root "$d"; then
      found="$d"
      break
    fi
  done < <(candidate_dirs)

  # Also: running compose project named personai*
  if [[ -z "$found" ]] && command -v docker >/dev/null 2>&1; then
    local proj
    proj="$(docker compose ls --format json 2>/dev/null | grep -oiE '"Name"\s*:\s*"[^"]*personai[^"]*"' | head -n1 || true)"
    if [[ -n "$proj" ]]; then
      warn "Found a Docker Compose project mentioning personai, but no install dir yet."
    fi
  fi

  if [[ -n "$found" ]]; then
    INSTALL_DIR="$found"
    IS_UPDATE=1
    load_env_defaults "$INSTALL_DIR/.env"
    if [[ -f "$INSTALL_DIR/$STATE_FILE_NAME" ]]; then
      # shellcheck disable=SC1090
      source "$INSTALL_DIR/$STATE_FILE_NAME" 2>/dev/null || true
    fi
    if [[ -d "$INSTALL_DIR/.git" ]]; then
      PREV_COMMIT="$(git -C "$INSTALL_DIR" rev-parse --short HEAD 2>/dev/null || true)"
    fi
    DATA_DIR="${DATA_DIR:-$INSTALL_DIR/data}"
  fi

  if [[ "$FORCE_MODE" == "install" ]]; then
    IS_UPDATE=0
  elif [[ "$FORCE_MODE" == "update" ]]; then
    [[ $IS_UPDATE -eq 1 ]] || die "--update set but no PersonAI install found. Pass --dir PATH."
    IS_UPDATE=1
  fi
}

write_state_file() {
  cat >"$INSTALL_DIR/$STATE_FILE_NAME" <<EOF
# PersonAI install metadata — managed by install.sh
PERSONAI_INSTALLED_AT="${PERSONAI_INSTALLED_AT:-$(date -Iseconds 2>/dev/null || date)}"
PERSONAI_UPDATED_AT="$(date -Iseconds 2>/dev/null || date)"
PERSONAI_COMMIT="$(git -C "$INSTALL_DIR" rev-parse HEAD 2>/dev/null || echo unknown)"
PERSONAI_VERSION_TAG="$(git -C "$INSTALL_DIR" describe --tags --always 2>/dev/null || echo unknown)"
PERSONAI_OLLAMA_MODE="${OLLAMA_MODE}"
PERSONAI_BRANCH="${BRANCH}"
EOF
}

# --- Ollama discovery -------------------------------------------------------

declare -a FOUND_NATIVE=()
declare -a FOUND_DOCKER=()
declare -a FOUND_PORTS=()
declare -a FOUND_HTTP=()

discover_ollama() {
  info "Scanning for existing Ollama / AI runtimes…"
  FOUND_NATIVE=()
  FOUND_DOCKER=()
  FOUND_PORTS=()
  FOUND_HTTP=()

  if command -v ollama >/dev/null 2>&1; then
    FOUND_NATIVE+=("binary: $(command -v ollama) ($(ollama --version 2>/dev/null | head -n1 || echo present))")
  fi
  if command -v systemctl >/dev/null 2>&1; then
    if systemctl is-active --quiet ollama 2>/dev/null || systemctl --user is-active --quiet ollama 2>/dev/null; then
      FOUND_NATIVE+=("service: ollama (systemd active)")
    elif systemctl list-unit-files ollama.service 2>/dev/null | grep -q ollama.service; then
      FOUND_NATIVE+=("service: ollama.service installed")
    fi
  fi
  if command -v ps >/dev/null 2>&1; then
    while IFS= read -r line; do
      FOUND_NATIVE+=("process: $line")
    done < <(ps -eo pid,comm,args 2>/dev/null | grep -Ei '[o]llama|[o]pen-webui|llama\.cpp|lmstudio|localai|gpt4all' || true)
  fi
  if command -v docker >/dev/null 2>&1; then
    while IFS= read -r line; do
      [[ -n "$line" ]] && FOUND_DOCKER+=("container: $line")
    done < <(docker ps -a --format '{{.Names}}\t{{.Image}}\t{{.Status}}\t{{.Ports}}' 2>/dev/null \
      | grep -Ei 'ollama|open-webui|localai|text-generation|llama|vllm' || true)
    while IFS= read -r line; do
      [[ -n "$line" ]] && FOUND_DOCKER+=("image: $line")
    done < <(docker images --format '{{.Repository}}:{{.Tag}}' 2>/dev/null \
      | grep -Ei 'ollama|open-webui|localai|vllm' || true)
  fi
  local p
  for p in 11434 11435 8080 3001 5000 1234 8081; do
    port_in_use "$p" && FOUND_PORTS+=("$p")
  done
  local url
  for url in "http://127.0.0.1:11434/api/tags" "http://localhost:11434/api/tags" "http://127.0.0.1:11435/api/tags"; do
    http_ok "$url" && FOUND_HTTP+=("$url")
  done
}

native_ollama_detected() {
  ((${#FOUND_NATIVE[@]} > 0)) && return 0
  ((${#FOUND_HTTP[@]} > 0)) && return 0
  local p
  for p in "${FOUND_PORTS[@]}"; do
    [[ "$p" == "11434" ]] && return 0
  done
  return 1
}

print_discovery() {
  local any=0
  ((${#FOUND_NATIVE[@]})) && { any=1; log "${BOLD}Native / process matches${RST}"; printf '  %s\n' "${FOUND_NATIVE[@]}"; }
  ((${#FOUND_DOCKER[@]})) && { any=1; log "${BOLD}Docker matches${RST}"; printf '  %s\n' "${FOUND_DOCKER[@]}"; }
  ((${#FOUND_PORTS[@]})) && { any=1; log "${BOLD}Listening ports of interest${RST}"; printf '  %s\n' "${FOUND_PORTS[@]}"; }
  ((${#FOUND_HTTP[@]})) && { any=1; log "${BOLD}Live Ollama HTTP endpoints${RST}"; printf '  %s\n' "${FOUND_HTTP[@]}"; }
  [[ $any -eq 0 ]] && warn "No Ollama-like runtime detected on this host."
  log ""
}

choose_ollama() {
  if [[ -n "$OLLAMA_MODE" ]]; then
    case "$OLLAMA_MODE" in
      existing-native|existing-docker|new-docker|skip) return ;;
      existing) OLLAMA_MODE="existing-native" ;;
      *) die "Invalid --ollama value: $OLLAMA_MODE" ;;
    esac
    return
  fi

  # On update, keep previous mode unless user wants to change
  if [[ $IS_UPDATE -eq 1 && -n "${PERSONAI_OLLAMA_MODE:-}" ]]; then
    if ask_yn "Keep current Ollama mode (${PERSONAI_OLLAMA_MODE})?" "y"; then
      OLLAMA_MODE="$PERSONAI_OLLAMA_MODE"
      return
    fi
  fi

  log "${BOLD}Ollama setup${RST}"
  if native_ollama_detected; then
    ok "Native Ollama signals detected (binary / process / service / :11434 /api/tags)"
    log "  Prefer option 1 unless you intentionally want a compose-bundled Ollama."
  fi
  log "  1) Use existing native Ollama (host process — recommended when installed)"
  log "  2) Use existing Ollama container (Docker)"
  log "  3) Start a new Ollama instance via Docker Compose"
  log "  4) Skip AI for now (Core tier)"
  log ""

  # Prefer native whenever present; do not assume Ollama only lives in compose.
  local default="3"
  if native_ollama_detected; then
    default="1"
  elif ((${#FOUND_DOCKER[@]} > 0)); then
    default="2"
  fi

  local choice
  choice="$(ask "Select option" "$default")"
  case "$choice" in
    1) OLLAMA_MODE="existing-native" ;;
    2) OLLAMA_MODE="existing-docker" ;;
    3) OLLAMA_MODE="new-docker" ;;
    4) OLLAMA_MODE="skip" ;;
    *) die "Invalid choice: $choice" ;;
  esac

  if [[ "$OLLAMA_MODE" == "existing-native" || "$OLLAMA_MODE" == "existing-docker" ]]; then
    local suggested="http://127.0.0.1:11434"
    ((${#FOUND_HTTP[@]})) && suggested="${FOUND_HTTP[0]%'/api/tags'}"
    OLLAMA_HOST="$(ask "Ollama base URL" "$suggested")"
    if http_ok "${OLLAMA_HOST%/}/api/tags"; then
      ok "Reached Ollama at $OLLAMA_HOST"
    else
      warn "Could not reach ${OLLAMA_HOST%/}/api/tags — continuing anyway."
    fi
    if [[ "$OLLAMA_MODE" == "existing-native" ]]; then
      info "API containers will use http://host.docker.internal:11434 to reach native Ollama."
    fi
  elif [[ "$OLLAMA_MODE" == "new-docker" ]]; then
    OLLAMA_HOST="http://127.0.0.1:11434"
    if port_in_use 11434 && [[ $IS_UPDATE -eq 0 ]]; then
      warn "Port 11434 is already in use (often a native Ollama)."
      if ask_yn "Use the existing listener instead of a new Docker Ollama?" "y"; then
        OLLAMA_MODE="existing-native"
        OLLAMA_HOST="$(ask "Ollama base URL" "http://127.0.0.1:11434")"
      elif ! ask_yn "Still create a new Docker Ollama (may conflict)?" "n"; then
        OLLAMA_MODE="existing-docker"
        OLLAMA_HOST="$(ask "Ollama base URL" "http://127.0.0.1:11434")"
      fi
    fi
  fi
}

choose_paths_and_ports() {
  if [[ $IS_UPDATE -eq 1 ]]; then
    ok "Existing install detected at $INSTALL_DIR (commit ${PREV_COMMIT:-unknown})"
    DATA_DIR="${DATA_DIR:-$INSTALL_DIR/data}"
    info "Preserving data dir: $DATA_DIR"
    info "Preserving .env values where possible (ports/tier/domain)."
    return
  fi

  INSTALL_DIR="${INSTALL_DIR:-$(ask "Install directory" "$DEFAULT_DIR")}"
  DATA_DIR="${DATA_DIR:-$(ask "Data directory (SQLite, uploads, exports)" "$INSTALL_DIR/data")}"

  log ""
  info "Checking application ports…"
  if port_in_use "$API_PORT"; then
    warn "API port $API_PORT is in use."
    API_PORT="$(ask "Choose API port" "4001")"
  fi
  if port_in_use "$APP_PORT"; then
    warn "Web port $APP_PORT is in use."
    APP_PORT="$(ask "Choose web port" "3001")"
  fi
  API_PORT="$(ask "API listen port" "$API_PORT")"
  APP_PORT="$(ask "Web listen port" "$APP_PORT")"
}

choose_product_options() {
  log ""
  log "${BOLD}Product options${RST}"

  if [[ $IS_UPDATE -eq 1 ]]; then
    # Minimal prompts on update
    if [[ "$PULL_MODELS" == "ask" ]]; then
      if ask_yn "Pull/refresh AI models after update?" "n"; then
        PULL_MODELS="yes"
      else
        PULL_MODELS="no"
      fi
    fi
    if [[ "$START_NOW" == "ask" ]]; then
      if ask_yn "Rebuild and restart stack after update?" "y"; then
        START_NOW="yes"
      else
        START_NOW="no"
      fi
    fi
    CREATE_SYSTEMD="no"
    [[ "$ENABLE_TLS" == "ask" ]] && ENABLE_TLS="no"
    return
  fi

  LICENSE_TIER="$(ask "License tier (core|pro)" "$LICENSE_TIER")"
  case "$LICENSE_TIER" in core|pro) ;; *) LICENSE_TIER="pro" ;; esac

  DOMAIN="${DOMAIN:-$(ask "Public domain for reverse proxy (blank = localhost only)" "")}"
  if [[ -n "$DOMAIN" ]]; then
    if [[ "$ENABLE_TLS" == "ask" ]]; then
      if ask_yn "Enable HTTPS via Caddy for $DOMAIN?" "y"; then ENABLE_TLS="yes"; else ENABLE_TLS="no"; fi
    fi
  else
    ENABLE_TLS="no"
  fi

  if [[ "$PULL_MODELS" == "ask" ]]; then
    if [[ "$OLLAMA_MODE" == "skip" ]]; then
      PULL_MODELS="no"
    elif ask_yn "Pull AI models now (LightOnOCR-2 + deepseek-r1:8b)?" "y"; then
      PULL_MODELS="yes"
    else
      PULL_MODELS="no"
    fi
  fi

  if [[ "$START_NOW" == "ask" ]]; then
    if ask_yn "Start PersonAI stack after install?" "y"; then START_NOW="yes"; else START_NOW="no"; fi
  fi

  if [[ "$CREATE_SYSTEMD" == "ask" ]]; then
    if command -v systemctl >/dev/null 2>&1 && [[ "$(id -u)" -ne 0 ]]; then
      if ask_yn "Install a user systemd unit to auto-start on login?" "n"; then
        CREATE_SYSTEMD="yes"
      else
        CREATE_SYSTEMD="no"
      fi
    else
      CREATE_SYSTEMD="no"
    fi
  fi
}

ensure_prereqs() {
  need_cmd curl
  need_cmd git
  if ! command -v docker >/dev/null 2>&1; then
    warn "Docker not found."
    if ask_yn "Install Docker via get.docker.com now?" "y"; then
      curl -fsSL https://get.docker.com | sh
      if [[ "$(id -u)" -ne 0 ]]; then
        ask_yn "Add $USER to docker group (requires re-login)?" "y" && sudo usermod -aG docker "$USER" || true
      fi
    else
      die "Docker is required for the recommended install path."
    fi
  fi
  docker compose version >/dev/null 2>&1 || die "Docker Compose plugin required (docker compose)."
  local gpu
  gpu="$(detect_gpu)"
  if [[ -n "$gpu" ]]; then
    ok "GPU detected: $gpu"
  else
    warn "No NVIDIA GPU detected — Ollama will run on CPU (slower)."
  fi
}

backup_config() {
  local stamp
  stamp="$(date +%Y%m%d-%H%M%S)"
  local bak="$INSTALL_DIR/.personai-backups/$stamp"
  mkdir -p "$bak"
  for f in .env docker-compose.override.yml Caddyfile "$STATE_FILE_NAME"; do
    [[ -f "$INSTALL_DIR/$f" ]] && cp -a "$INSTALL_DIR/$f" "$bak/"
  done
  ok "Config backup → $bak"
}

clone_or_update_repo() {
  if [[ $SKIP_CLONE -eq 1 ]]; then
    INSTALL_DIR="$(pwd)"
    ok "Using current directory: $INSTALL_DIR"
    return
  fi

  mkdir -p "$(dirname "$INSTALL_DIR")"
  if [[ -d "$INSTALL_DIR/.git" ]]; then
    info "Fetching latest from origin/$BRANCH…"
    git -C "$INSTALL_DIR" remote set-url origin "$REPO_URL" 2>/dev/null || true
    git -C "$INSTALL_DIR" fetch --tags --force origin "$BRANCH"

    local local_sha remote_sha
    local_sha="$(git -C "$INSTALL_DIR" rev-parse HEAD)"
    remote_sha="$(git -C "$INSTALL_DIR" rev-parse "FETCH_HEAD")"
    PREV_COMMIT="$(git -C "$INSTALL_DIR" rev-parse --short HEAD)"

    if [[ "$local_sha" == "$remote_sha" ]]; then
      ok "Already up to date ($PREV_COMMIT)."
      NEW_COMMIT="$PREV_COMMIT"
    else
      info "Updating $PREV_COMMIT → $(git -C "$INSTALL_DIR" rev-parse --short FETCH_HEAD)"
      # Preserve local override files; reset tracked tree to origin
      git -C "$INSTALL_DIR" checkout "$BRANCH" 2>/dev/null || git -C "$INSTALL_DIR" checkout -B "$BRANCH" "origin/$BRANCH"
      if ! git -C "$INSTALL_DIR" merge --ff-only "origin/$BRANCH" 2>/dev/null; then
        warn "Fast-forward failed — resetting tracked files to origin/$BRANCH (data/ and .env kept)."
        git -C "$INSTALL_DIR" reset --hard "origin/$BRANCH"
      fi
      NEW_COMMIT="$(git -C "$INSTALL_DIR" rev-parse --short HEAD)"
      ok "Code updated to $NEW_COMMIT"
      # Show brief changelog
      if [[ -n "$PREV_COMMIT" && "$PREV_COMMIT" != "$NEW_COMMIT" ]]; then
        log "${BOLD}Changes since last install${RST}"
        git -C "$INSTALL_DIR" log --oneline "${PREV_COMMIT}..${NEW_COMMIT}" 2>/dev/null | head -n 20 || true
        log ""
      fi
    fi
  else
    info "Cloning $REPO_URL → $INSTALL_DIR"
    git clone --depth 1 --branch "$BRANCH" "$REPO_URL" "$INSTALL_DIR"
    NEW_COMMIT="$(git -C "$INSTALL_DIR" rev-parse --short HEAD)"
  fi
}

write_env() {
  mkdir -p "$DATA_DIR"
  local env_file="$INSTALL_DIR/.env"
  local public_api="http://localhost:${API_PORT}"
  if [[ -n "$DOMAIN" && "$ENABLE_TLS" == "yes" ]]; then
    public_api="https://api.${DOMAIN}"
  elif [[ -n "$DOMAIN" ]]; then
    public_api="http://api.${DOMAIN}"
  fi

  # OLLAMA_HOST in .env is what the API container sees.
  # Native Ollama on the host → host.docker.internal (not container localhost).
  # Bundled compose Ollama is opt-in via -f docker-compose.ollama.yml (never via profiles).
  local compose_ollama_host="$OLLAMA_HOST"
  if [[ "$OLLAMA_MODE" == "new-docker" ]]; then
    compose_ollama_host="http://ollama:11434"
  elif [[ "$OLLAMA_HOST" == *"127.0.0.1"* || "$OLLAMA_HOST" == *"localhost"* ]]; then
    # API runs in Docker — loopback is the container itself, not the VPS host
    compose_ollama_host="http://host.docker.internal:11434"
  fi

  # On update: merge into existing .env instead of clobbering unknown keys
  if [[ $IS_UPDATE -eq 1 && -f "$env_file" ]]; then
    local tmp
    tmp="$(mktemp)"
    cp "$env_file" "$tmp"
    set_kv() {
      local k="$1" v="$2"
      if grep -qE "^${k}=" "$tmp"; then
        # portable-ish in-place replace
        awk -v k="$k" -v v="$v" 'BEGIN{FS=OFS="="} $1==k{$0=k"="v} {print}' "$tmp" >"${tmp}.new"
        mv "${tmp}.new" "$tmp"
      else
        printf '%s=%s\n' "$k" "$v" >>"$tmp"
      fi
    }
    set_kv DATA_DIR "$DATA_DIR"
    set_kv PORT "$API_PORT"
    set_kv OLLAMA_HOST "$compose_ollama_host"
    set_kv OLLAMA_PUBLIC_HOST "$OLLAMA_HOST"
    set_kv LICENSE_TIER "$LICENSE_TIER"
    set_kv NEXT_PUBLIC_API_URL "$public_api"
    set_kv PERSONAI_WEB_PORT "$APP_PORT"
    set_kv PERSONAI_DOMAIN "$DOMAIN"
    set_kv PERSONAI_TLS "$ENABLE_TLS"
    set_kv PERSONAI_OLLAMA_MODE "$OLLAMA_MODE"
    # Always clear — legacy COMPOSE_PROFILES=bundled-ollama must not start ollama
    set_kv COMPOSE_PROFILES ""
    mv "$tmp" "$env_file"
    ok "Merged settings into existing .env (data preserved; COMPOSE_PROFILES cleared)"
    return
  fi

  cat >"$env_file" <<EOF
# Generated by PersonAI install.sh on $(date -Iseconds 2>/dev/null || date)
DATA_DIR=${DATA_DIR}
PORT=${API_PORT}
OLLAMA_HOST=${compose_ollama_host}
OLLAMA_PUBLIC_HOST=${OLLAMA_HOST}
OLLAMA_VISION_MODEL=maternion/LightOnOCR-2
OLLAMA_REASONING_MODEL=deepseek-r1:8b
NEXT_PUBLIC_API_URL=${public_api}
LICENSE_TIER=${LICENSE_TIER}
PERSONAI_WEB_PORT=${APP_PORT}
PERSONAI_DOMAIN=${DOMAIN}
PERSONAI_TLS=${ENABLE_TLS}
PERSONAI_OLLAMA_MODE=${OLLAMA_MODE}
# Legacy key — always leave empty. Bundled Ollama uses -f docker-compose.ollama.yml.
COMPOSE_PROFILES=
DATABASE_URL=file:${DATA_DIR}/profiles/bootstrap/personai.db
EOF
  ok "Wrote $env_file"
}

write_caddy_if_needed() {
  [[ -z "$DOMAIN" ]] && return
  local caddy="$INSTALL_DIR/Caddyfile"
  if [[ "$ENABLE_TLS" == "yes" ]]; then
    cat >"$caddy" <<EOF
${DOMAIN} {
  reverse_proxy web:80
}

api.${DOMAIN} {
  reverse_proxy api:4000
}
EOF
  else
    cat >"$caddy" <<EOF
http://${DOMAIN} {
  reverse_proxy web:80
}

http://api.${DOMAIN} {
  reverse_proxy api:4000
}
EOF
  fi
  ok "Configured Caddyfile for ${DOMAIN}"
}

write_compose_override() {
  local override="$INSTALL_DIR/docker-compose.override.yml"
  local ollama_env_host web_api_url

  if [[ "$OLLAMA_MODE" == "new-docker" ]]; then
    ollama_env_host="http://ollama:11434"
  elif [[ "$OLLAMA_HOST" == *"127.0.0.1"* || "$OLLAMA_HOST" == *"localhost"* ]]; then
    ollama_env_host="http://host.docker.internal:11434"
  else
    ollama_env_host="$OLLAMA_HOST"
  fi

  web_api_url="http://localhost:${API_PORT}"
  if [[ -n "$DOMAIN" && "$ENABLE_TLS" == "yes" ]]; then
    web_api_url="https://api.${DOMAIN}"
  elif [[ -n "$DOMAIN" ]]; then
    web_api_url="http://api.${DOMAIN}"
  fi

  {
    echo "# Generated by PersonAI install.sh — local port / Ollama wiring"
    echo "# Bundled Ollama (if any) comes from -f docker-compose.ollama.yml — not from base compose."
    echo "services:"
    if [[ "$OLLAMA_MODE" == "new-docker" ]]; then
      if [[ -n "$(detect_gpu)" ]]; then
        cat <<'YAML'
  ollama:
    deploy:
      resources:
        reservations:
          devices:
            - driver: nvidia
              count: 1
              capabilities: [gpu]
YAML
      fi
    fi
    cat <<YAML
  api:
    ports:
      - "${API_PORT}:4000"
    environment:
      OLLAMA_HOST: ${ollama_env_host}
      LICENSE_TIER: ${LICENSE_TIER}
      DATA_DIR: /app/data
      PERSONAI_IN_DOCKER: "1"
    volumes:
      - ${DATA_DIR}:/app/data
    extra_hosts:
      - "host.docker.internal:host-gateway"
  web:
    ports:
      - "${APP_PORT}:80"
    build:
      args:
        NEXT_PUBLIC_API_URL: ${web_api_url}
YAML
  } >"$override"
  ok "Wrote docker-compose.override.yml"
}

compose_files() {
  local files=()
  if [[ -n "$DOMAIN" && -f "$INSTALL_DIR/docker-compose.prod.yml" ]]; then
    files+=(-f docker-compose.prod.yml)
  else
    files+=(-f docker-compose.yml)
  fi
  # Bundled Ollama only when explicitly requested — never via COMPOSE_PROFILES
  if [[ "$OLLAMA_MODE" == "new-docker" && -f "$INSTALL_DIR/docker-compose.ollama.yml" ]]; then
    files+=(-f docker-compose.ollama.yml)
  fi
  [[ -f "$INSTALL_DIR/docker-compose.override.yml" ]] && files+=(-f docker-compose.override.yml)
  printf '%s\n' "${files[@]}"
}

remove_stale_ollama_container() {
  cd "$INSTALL_DIR"
  local -a files=()
  while IFS= read -r line; do files+=("$line"); done < <(compose_files)
  # Drop leftover service from older installs (profile-gated ollama in base compose)
  COMPOSE_PROFILES= docker compose "${files[@]}" rm -f -s ollama 2>/dev/null || true
  local base
  base="$(basename "$INSTALL_DIR")"
  docker rm -f "${base}-ollama-1" personaios-ollama-1 personai-ollama-1 2>/dev/null || true
}

start_stack() {
  cd "$INSTALL_DIR"
  local -a files=()
  while IFS= read -r line; do files+=("$line"); done < <(compose_files)
  info "Building and starting containers…"
  # Always clear COMPOSE_PROFILES — stale bundled-ollama in .env must never start ollama
  if [[ "$OLLAMA_MODE" == "new-docker" ]]; then
    info "Starting with -f docker-compose.ollama.yml (compose Ollama)"
    COMPOSE_PROFILES= docker compose "${files[@]}" up -d --build --remove-orphans
  else
    info "Starting without docker Ollama (host/native or skip) — no :11434 bind"
    remove_stale_ollama_container
    COMPOSE_PROFILES= docker compose "${files[@]}" up -d --build --remove-orphans
  fi
  ok "Stack started"
}

pull_models() {
  [[ "$PULL_MODELS" != "yes" ]] && return
  info "Pulling models (this can take a while)…"
  cd "$INSTALL_DIR"
  if [[ "$OLLAMA_MODE" == "new-docker" ]]; then
    local -a files=()
    while IFS= read -r line; do files+=("$line"); done < <(compose_files)
    docker compose "${files[@]}" exec -T ollama ollama pull maternion/LightOnOCR-2 || true
    docker compose "${files[@]}" exec -T ollama ollama pull deepseek-r1:8b || true
  elif command -v ollama >/dev/null 2>&1; then
    ollama pull maternion/LightOnOCR-2 || true
    ollama pull deepseek-r1:8b || true
  else
    local cid
    cid="$(docker ps --format '{{.ID}} {{.Names}}' | grep -Ei 'ollama' | awk '{print $1}' | head -n1 || true)"
    if [[ -n "$cid" ]]; then
      docker exec -i "$cid" ollama pull maternion/LightOnOCR-2 || true
      docker exec -i "$cid" ollama pull deepseek-r1:8b || true
    else
      warn "No ollama CLI/container found to pull models."
    fi
  fi
  ok "Model pull attempted"
}

install_systemd_user() {
  [[ "$CREATE_SYSTEMD" != "yes" ]] && return
  local unit_dir="$HOME/.config/systemd/user"
  local compose_args="-f docker-compose.yml -f docker-compose.override.yml"
  if [[ "$OLLAMA_MODE" == "new-docker" ]]; then
    compose_args="-f docker-compose.yml -f docker-compose.ollama.yml -f docker-compose.override.yml"
  fi
  mkdir -p "$unit_dir"
  cat >"$unit_dir/personai.service" <<EOF
[Unit]
Description=PersonAI OS (Docker Compose)
After=network-online.target docker.service
Wants=network-online.target

[Service]
Type=oneshot
RemainAfterExit=yes
WorkingDirectory=${INSTALL_DIR}
Environment=COMPOSE_PROFILES=
ExecStart=/usr/bin/docker compose ${compose_args} up -d
ExecStop=/usr/bin/docker compose ${compose_args} down
TimeoutStartSec=0

[Install]
WantedBy=default.target
EOF
  systemctl --user daemon-reload
  systemctl --user enable --now personai.service
  ok "Enabled systemd user unit: personai.service"
  info "Linger tip: sudo loginctl enable-linger $USER"
}

print_summary() {
  local web_url="http://localhost:${APP_PORT}"
  local api_url="http://localhost:${API_PORT}"
  if [[ -n "$DOMAIN" && "$ENABLE_TLS" == "yes" ]]; then
    web_url="https://${DOMAIN}"; api_url="https://api.${DOMAIN}"
  elif [[ -n "$DOMAIN" ]]; then
    web_url="http://${DOMAIN}"; api_url="http://api.${DOMAIN}"
  fi

  local action="install"
  [[ $IS_UPDATE -eq 1 ]] && action="update"

  cat <<EOF

${BOLD}${GRN}PersonAI OS ${action} complete${RST}

  Install dir : ${INSTALL_DIR}
  Data dir    : ${DATA_DIR}  ${DIM}(never wiped by installer)${RST}
  Commit      : ${NEW_COMMIT:-$(git -C "$INSTALL_DIR" rev-parse --short HEAD 2>/dev/null || echo n/a)}
  Web UI      : ${web_url}
  API         : ${api_url}/health
  Ollama      : ${OLLAMA_MODE} → ${OLLAMA_HOST}
  Tier        : ${LICENSE_TIER}

Update anytime with the same command:
  curl -fsSL https://raw.githubusercontent.com/danielrlutz/personai/main/install.sh | bash

EOF
}

run_update() {
  log "${BOLD}${CYN}Update mode${RST} — existing PersonAI install found"
  log "  ${INSTALL_DIR}"
  log ""

  ensure_prereqs
  # Light discovery only if ollama mode unknown
  if [[ -z "$OLLAMA_MODE" ]]; then
    discover_ollama
    print_discovery
  fi
  choose_ollama
  choose_paths_and_ports
  choose_product_options

  if ! ask_yn "Proceed with update? (code refresh + optional rebuild; data kept)" "y"; then
    die "Aborted."
  fi

  backup_config
  clone_or_update_repo
  write_env
  write_caddy_if_needed
  write_compose_override
  write_state_file

  if [[ "$START_NOW" == "yes" ]]; then
    start_stack
    pull_models
  else
    info "Skipping restart. Run compose up --build when ready."
  fi
  print_summary
}

run_install() {
  log "${BOLD}${CYN}Fresh install mode${RST}"
  log ""
  ensure_prereqs
  discover_ollama
  print_discovery
  choose_ollama
  choose_paths_and_ports
  choose_product_options

  log ""
  log "${BOLD}Summary${RST}"
  log "  dir=$INSTALL_DIR"
  log "  data=$DATA_DIR"
  log "  ollama=$OLLAMA_MODE ($OLLAMA_HOST)"
  log "  ports web=$APP_PORT api=$API_PORT"
  log "  tier=$LICENSE_TIER domain=${DOMAIN:-none} tls=$ENABLE_TLS"
  log ""
  if ! ask_yn "Proceed with installation?" "y"; then
    die "Aborted by user."
  fi

  clone_or_update_repo
  write_env
  write_caddy_if_needed
  write_compose_override
  write_state_file

  if [[ "$START_NOW" == "yes" ]]; then
    start_stack
    pull_models
  else
    if [[ "$OLLAMA_MODE" == "new-docker" ]]; then
      info "Skipping start. Later: cd $INSTALL_DIR && docker compose -f docker-compose.yml -f docker-compose.ollama.yml up -d --build"
    else
      info "Skipping start. Later: cd $INSTALL_DIR && COMPOSE_PROFILES= docker compose up -d --build"
      info "Or: ./scripts/vps-up.sh   (clears stale profiles, removes leftover ollama)"
      info "Host Ollama: ensure OLLAMA_HOST=http://host.docker.internal:11434 in .env"
    fi
  fi

  install_systemd_user
  print_summary
}

main() {
  clear_banner
  detect_install_state

  if [[ $IS_UPDATE -eq 1 ]]; then
    run_update
  else
    run_install
  fi
}

main "$@"
