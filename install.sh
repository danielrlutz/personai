#!/usr/bin/env bash
# PersonAI OS â€” one-line installer
#
#   curl -fsSL https://raw.githubusercontent.com/danielrlutz/personai/main/install.sh | bash
#
# Non-interactive example:
#   curl -fsSL .../install.sh | bash -s -- --yes --ollama=existing --tier=pro --domain=app.example.com
#
set -euo pipefail

REPO_URL="${PERSONAI_REPO_URL:-https://github.com/danielrlutz/personai.git}"
REPO_RAW="${PERSONAI_RAW_URL:-https://raw.githubusercontent.com/danielrlutz/personai/main}"
BRANCH="${PERSONAI_BRANCH:-main}"
DEFAULT_DIR="${PERSONAI_HOME:-$HOME/personai}"

# Defaults (overridable via flags / prompts)
INSTALL_DIR=""
OLLAMA_MODE=""          # existing-native | existing-docker | new-docker | skip
OLLAMA_HOST="http://127.0.0.1:11434"
LICENSE_TIER="pro"
APP_PORT="3000"
API_PORT="4000"
DATA_DIR=""
DOMAIN=""
ENABLE_TLS="ask"        # ask | yes | no
PULL_MODELS="ask"      # ask | yes | no
START_NOW="ask"         # ask | yes | no
CREATE_SYSTEMD="ask"    # ask | yes | no
ASSUME_YES=0
SKIP_CLONE=0

RED=$'\033[0;31m'
GRN=$'\033[0;32m'
YLW=$'\033[0;33m'
BLU=$'\033[0;34m'
CYN=$'\033[0;36m'
DIM=$'\033[2m'
BOLD=$'\033[1m'
RST=$'\033[0m'

log()  { printf '%s\n' "$*"; }
info() { printf '%sâ€º%s %s\n' "$CYN" "$RST" "$*"; }
ok()   { printf '%sâœ“%s %s\n' "$GRN" "$RST" "$*"; }
warn() { printf '%s!%s %s\n' "$YLW" "$RST" "$*"; }
err()  { printf '%sx%s %s\n' "$RED" "$RST" "$*" >&2; }
die()  { err "$*"; exit 1; }

# When piped from curl, stdin is the script â€” prompts must use the TTY.
if [[ -r /dev/tty ]]; then
  exec 3</dev/tty
else
  exec 3<&0
fi

usage() {
  cat <<'EOF'
PersonAI OS installer

Usage:
  curl -fsSL https://raw.githubusercontent.com/danielrlutz/personai/main/install.sh | bash
  curl -fsSL .../install.sh | bash -s -- [options]

Options:
  --dir PATH              Install directory (default: ~/personai)
  --ollama MODE           existing-native | existing-docker | new-docker | skip
  --ollama-host URL       Ollama base URL (default: http://127.0.0.1:11434)
  --tier core|pro         License tier (default: pro)
  --port N                Web UI host port (default: 3000)
  --api-port N            API host port (default: 4000)
  --data-dir PATH         Persistent data directory
  --domain FQDN           Public hostname (enables Caddy TLS prompts)
  --tls yes|no            Issue TLS via Caddy (prod compose)
  --pull-models yes|no    Pull LightOnOCR-2 + deepseek-r1:8b after install
  --start yes|no          Start stack after install
  --systemd yes|no        Install user systemd unit (docker compose up)
  --yes, -y               Accept defaults / non-interactive where possible
  --skip-clone            Use current directory as install root
  -h, --help              Show this help
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --dir) INSTALL_DIR="${2:-}"; shift 2 ;;
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
  # ask "Prompt" "default"
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
  if [[ -z "$reply" ]]; then
    printf '%s\n' "$default"
  else
    printf '%s\n' "$reply"
  fi
}

ask_yn() {
  # ask_yn "Prompt" "y|n"
  local prompt="$1" default="${2:-y}" reply
  local hint="y/n"
  [[ "$default" == "y" ]] && hint="Y/n"
  [[ "$default" == "n" ]] && hint="y/N"
  if [[ $ASSUME_YES -eq 1 ]]; then
    [[ "$default" == "y" ]] && return 0 || return 1
  fi
  printf '%s [%s]: ' "$prompt" "$hint" >&2
  IFS= read -r reply <&3 || true
  reply="${reply:-$default}"
  case "${reply,,}" in
    y|yes) return 0 ;;
    *) return 1 ;;
  esac
}

need_cmd() {
  command -v "$1" >/dev/null 2>&1 || die "Missing required command: $1"
}

port_in_use() {
  local port="$1"
  if command -v ss >/dev/null 2>&1; then
    ss -ltn "( sport = :$port )" 2>/dev/null | grep -q ":$port" && return 0
  fi
  if command -v lsof >/dev/null 2>&1; then
    lsof -iTCP:"$port" -sTCP:LISTEN >/dev/null 2>&1 && return 0
  fi
  if command -v netstat >/dev/null 2>&1; then
    netstat -ltn 2>/dev/null | grep -Eq "[:.]$port[[:space:]]" && return 0
  fi
  # Fallback: try binding briefly via bash /dev/tcp (detection only)
  if (echo >/dev/tcp/127.0.0.1/"$port") >/dev/null 2>&1; then
    return 0
  fi
  return 1
}

http_ok() {
  local url="$1"
  if command -v curl >/dev/null 2>&1; then
    curl -fsS --max-time 2 "$url" >/dev/null 2>&1
  elif command -v wget >/dev/null 2>&1; then
    wget -q -T 2 -O /dev/null "$url" 2>/dev/null
  else
    return 1
  fi
}

detect_gpu() {
  if command -v nvidia-smi >/dev/null 2>&1 && nvidia-smi >/dev/null 2>&1; then
    nvidia-smi --query-gpu=name,memory.total --format=csv,noheader 2>/dev/null | head -n1
  elif [[ -e /dev/nvidia0 ]]; then
    echo "NVIDIA device present (/dev/nvidia0)"
  else
    echo ""
  fi
}

# --- Banner -----------------------------------------------------------------
clear_banner() {
  cat <<EOF

${BOLD}${CYN}PersonAI OS${RST} â€” Privacy-First Life Management Suite
${DIM}Local-first Â· SQLite Â· Ollama Â· Docker${RST}

EOF
}

# --- Discovery --------------------------------------------------------------
declare -a FOUND_NATIVE=()
declare -a FOUND_DOCKER=()
declare -a FOUND_PORTS=()
declare -a FOUND_HTTP=()

discover_ollama() {
  info "Scanning for existing Ollama / AI runtimesâ€¦"

  # Processes (name heuristics)
  if command -v ps >/dev/null 2>&1; then
    while IFS= read -r line; do
      FOUND_NATIVE+=("process: $line")
    done < <(ps -eo pid,comm,args 2>/dev/null | grep -Ei 'ollama|open-webui|llama\.cpp|lmstudio|localai|gpt4all' | grep -v grep || true)
  fi
  if command -v pgrep >/dev/null 2>&1; then
    if pgrep -af 'ollama' >/dev/null 2>&1; then
      :
    fi
  fi
  if command -v ollama >/dev/null 2>&1; then
    FOUND_NATIVE+=("binary: $(command -v ollama) ($(ollama --version 2>/dev/null | head -n1 || echo present))")
  fi

  # Docker containers / images
  if command -v docker >/dev/null 2>&1; then
    while IFS= read -r line; do
      [[ -n "$line" ]] && FOUND_DOCKER+=("container: $line")
    done < <(docker ps -a --format '{{.Names}}\t{{.Image}}\t{{.Status}}\t{{.Ports}}' 2>/dev/null \
      | grep -Ei 'ollama|open-webui|localai|text-generation|llama|vllm|openai-compatible' || true)

    while IFS= read -r line; do
      [[ -n "$line" ]] && FOUND_DOCKER+=("image: $line")
    done < <(docker images --format '{{.Repository}}:{{.Tag}}' 2>/dev/null \
      | grep -Ei 'ollama|open-webui|localai|vllm' || true)

    # Compose projects mentioning ollama
    if docker compose ls 2>/dev/null | grep -Eiq 'ollama|personai|ai'; then
      while IFS= read -r line; do
        FOUND_DOCKER+=("compose: $line")
      done < <(docker compose ls 2>/dev/null | grep -Ei 'ollama|personai|ai' || true)
    fi
  fi

  # Common ports
  local p
  for p in 11434 11435 8080 3001 5000 1234 8081; do
    if port_in_use "$p"; then
      FOUND_PORTS+=("$p")
    fi
  done

  # HTTP probes
  local url
  for url in \
    "http://127.0.0.1:11434/api/tags" \
    "http://localhost:11434/api/tags" \
    "http://127.0.0.1:11435/api/tags"; do
    if http_ok "$url"; then
      FOUND_HTTP+=("$url")
    fi
  done
}

print_discovery() {
  local any=0
  if ((${#FOUND_NATIVE[@]})); then
    any=1
    log "${BOLD}Native / process matches${RST}"
    printf '  %s\n' "${FOUND_NATIVE[@]}"
  fi
  if ((${#FOUND_DOCKER[@]})); then
    any=1
    log "${BOLD}Docker matches${RST}"
    printf '  %s\n' "${FOUND_DOCKER[@]}"
  fi
  if ((${#FOUND_PORTS[@]})); then
    any=1
    log "${BOLD}Listening ports of interest${RST}"
    printf '  %s\n' "${FOUND_PORTS[@]}"
  fi
  if ((${#FOUND_HTTP[@]})); then
    any=1
    log "${BOLD}Live Ollama HTTP endpoints${RST}"
    printf '  %s\n' "${FOUND_HTTP[@]}"
  fi
  if [[ $any -eq 0 ]]; then
    warn "No Ollama-like runtime detected on this host."
  fi
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

  log "${BOLD}Ollama setup${RST}"
  log "  1) Use existing Ollama instance (native binary / host service)"
  log "  2) Use existing Ollama instance (Docker container)"
  log "  3) Start a new Ollama instance via Docker (recommended if none found)"
  log "  4) Skip AI for now (Core tier features only)"
  log ""

  local default="3"
  if ((${#FOUND_HTTP[@]})); then
    if ((${#FOUND_DOCKER[@]})); then default="2"; else default="1"; fi
  elif ((${#FOUND_DOCKER[@]})); then
    default="2"
  elif ((${#FOUND_NATIVE[@]})); then
    default="1"
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
    if ((${#FOUND_HTTP[@]})); then
      suggested="${FOUND_HTTP[0]%'/api/tags'}"
    fi
    OLLAMA_HOST="$(ask "Ollama base URL" "$suggested")"
    if ! http_ok "${OLLAMA_HOST%/}/api/tags"; then
      warn "Could not reach ${OLLAMA_HOST%/}/api/tags â€” continuing anyway (you can fix .env later)."
    else
      ok "Reached Ollama at $OLLAMA_HOST"
    fi
  elif [[ "$OLLAMA_MODE" == "new-docker" ]]; then
    OLLAMA_HOST="http://127.0.0.1:11434"
    if port_in_use 11434; then
      warn "Port 11434 is already in use."
      if ask_yn "Still create a new Docker Ollama (may conflict)?" "n"; then
        :
      else
        OLLAMA_MODE="existing-docker"
        OLLAMA_HOST="$(ask "Ollama base URL" "http://127.0.0.1:11434")"
      fi
    fi
  fi
}

choose_paths_and_ports() {
  INSTALL_DIR="${INSTALL_DIR:-$(ask "Install directory" "$DEFAULT_DIR")}"
  DATA_DIR="${DATA_DIR:-$(ask "Data directory (SQLite, uploads, exports)" "$INSTALL_DIR/data")}"

  log ""
  info "Checking application portsâ€¦"
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
  local tier_default="$LICENSE_TIER"
  LICENSE_TIER="$(ask "License tier (core|pro)" "$tier_default")"
  case "$LICENSE_TIER" in
    core|pro) ;;
    *) warn "Unknown tier '$LICENSE_TIER' â€” using pro"; LICENSE_TIER="pro" ;;
  esac

  DOMAIN="${DOMAIN:-$(ask "Public domain for reverse proxy (blank = localhost only)" "")}"

  if [[ -n "$DOMAIN" ]]; then
    if [[ "$ENABLE_TLS" == "ask" ]]; then
      if ask_yn "Enable HTTPS via Caddy (Let's Encrypt) for $DOMAIN?" "y"; then
        ENABLE_TLS="yes"
      else
        ENABLE_TLS="no"
      fi
    fi
  else
    ENABLE_TLS="no"
  fi

  if [[ "$PULL_MODELS" == "ask" ]]; then
    if [[ "$OLLAMA_MODE" == "skip" ]]; then
      PULL_MODELS="no"
    elif ask_yn "Pull AI models now (LightOnOCR-2 + deepseek-r1:8b, large download)?" "y"; then
      PULL_MODELS="yes"
    else
      PULL_MODELS="no"
    fi
  fi

  if [[ "$START_NOW" == "ask" ]]; then
    if ask_yn "Start PersonAI stack after install?" "y"; then
      START_NOW="yes"
    else
      START_NOW="no"
    fi
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
        if ask_yn "Add $USER to docker group (requires re-login)?" "y"; then
          sudo usermod -aG docker "$USER" || warn "Could not add user to docker group."
        fi
      fi
    else
      die "Docker is required for the recommended install path."
    fi
  fi

  if ! docker compose version >/dev/null 2>&1; then
    die "Docker Compose plugin required (docker compose)."
  fi

  local gpu
  gpu="$(detect_gpu)"
  if [[ -n "$gpu" ]]; then
    ok "GPU detected: $gpu"
    info "Compose will attempt NVIDIA GPU passthrough when available."
  else
    warn "No NVIDIA GPU detected â€” Ollama will run on CPU (slower)."
  fi
}

clone_or_update() {
  if [[ $SKIP_CLONE -eq 1 ]]; then
    INSTALL_DIR="$(pwd)"
    ok "Using current directory: $INSTALL_DIR"
    return
  fi

  mkdir -p "$(dirname "$INSTALL_DIR")"
  if [[ -d "$INSTALL_DIR/.git" ]]; then
    info "Updating existing clone at $INSTALL_DIR"
    git -C "$INSTALL_DIR" fetch --depth 1 origin "$BRANCH"
    git -C "$INSTALL_DIR" checkout "$BRANCH"
    git -C "$INSTALL_DIR" pull --ff-only origin "$BRANCH" || true
  else
    info "Cloning $REPO_URL â†’ $INSTALL_DIR"
    git clone --depth 1 --branch "$BRANCH" "$REPO_URL" "$INSTALL_DIR"
  fi
}

write_env() {
  mkdir -p "$DATA_DIR"
  local env_file="$INSTALL_DIR/.env"
  local public_api="http://localhost:${API_PORT}"
  local public_web="http://localhost:${APP_PORT}"
  if [[ -n "$DOMAIN" ]]; then
    if [[ "$ENABLE_TLS" == "yes" ]]; then
      public_api="https://api.${DOMAIN}"
      public_web="https://${DOMAIN}"
    else
      public_api="http://api.${DOMAIN}"
      public_web="http://${DOMAIN}"
    fi
  fi

  # When Ollama runs in the same compose stack, containers talk via service name.
  local compose_ollama_host="$OLLAMA_HOST"
  if [[ "$OLLAMA_MODE" == "new-docker" ]]; then
    compose_ollama_host="http://ollama:11434"
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
    # Containers reach host Ollama via Docker's host gateway
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

  cat >"$override" <<YAML
# Generated by PersonAI install.sh â€” local port / Ollama wiring
services:
YAML

  if [[ "$OLLAMA_MODE" == "new-docker" ]]; then
    cat >>"$override" <<YAML
  ollama:
    ports:
      - "11434:11434"
YAML
    if [[ -n "$(detect_gpu)" ]]; then
      cat >>"$override" <<'YAML'
    deploy:
      resources:
        reservations:
          devices:
            - driver: nvidia
              count: 1
              capabilities: [gpu]
YAML
    fi
  else
    cat >>"$override" <<'YAML'
  ollama:
    profiles: ["bundled-ollama-disabled"]
YAML
  fi

  cat >>"$override" <<YAML
  api:
    ports:
      - "${API_PORT}:4000"
    environment:
      OLLAMA_HOST: ${ollama_env_host}
      LICENSE_TIER: ${LICENSE_TIER}
      DATA_DIR: /app/data
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

  ok "Wrote docker-compose.override.yml"
}

start_stack() {
  cd "$INSTALL_DIR"
  local files=(-f docker-compose.yml)
  if [[ -n "$DOMAIN" ]]; then
    files=(-f docker-compose.prod.yml)
  fi
  if [[ -f docker-compose.override.yml ]]; then
    files+=(-f docker-compose.override.yml)
  fi

  info "Building and starting containersâ€¦"
  docker compose "${files[@]}" up -d --build
  ok "Stack started"
}

pull_models() {
  [[ "$PULL_MODELS" != "yes" ]] && return
  info "Pulling models (this can take a while)â€¦"
  if [[ "$OLLAMA_MODE" == "new-docker" ]]; then
    docker compose -f docker-compose.yml -f docker-compose.override.yml exec -T ollama ollama pull maternion/LightOnOCR-2 || \
      docker compose exec -T ollama ollama pull maternion/LightOnOCR-2 || true
    docker compose -f docker-compose.yml -f docker-compose.override.yml exec -T ollama ollama pull deepseek-r1:8b || \
      docker compose exec -T ollama ollama pull deepseek-r1:8b || true
  elif command -v ollama >/dev/null 2>&1; then
    ollama pull maternion/LightOnOCR-2 || true
    ollama pull deepseek-r1:8b || true
  else
    # Hit Docker container by name heuristic
    local cid
    cid="$(docker ps --format '{{.ID}} {{.Names}}' | grep -Ei 'ollama' | awk '{print $1}' | head -n1 || true)"
    if [[ -n "$cid" ]]; then
      docker exec -i "$cid" ollama pull maternion/LightOnOCR-2 || true
      docker exec -i "$cid" ollama pull deepseek-r1:8b || true
    else
      warn "No ollama CLI/container found to pull models â€” run scripts/pull-models.sh later."
    fi
  fi
  ok "Model pull attempted"
}

install_systemd_user() {
  [[ "$CREATE_SYSTEMD" != "yes" ]] && return
  local unit_dir="$HOME/.config/systemd/user"
  mkdir -p "$unit_dir"
  local unit="$unit_dir/personai.service"
  cat >"$unit" <<EOF
[Unit]
Description=PersonAI OS (Docker Compose)
After=network-online.target docker.service
Wants=network-online.target

[Service]
Type=oneshot
RemainAfterExit=yes
WorkingDirectory=${INSTALL_DIR}
ExecStart=/usr/bin/docker compose -f docker-compose.yml -f docker-compose.override.yml up -d
ExecStop=/usr/bin/docker compose -f docker-compose.yml -f docker-compose.override.yml down
TimeoutStartSec=0

[Install]
WantedBy=default.target
EOF
  systemctl --user daemon-reload
  systemctl --user enable --now personai.service
  ok "Enabled systemd user unit: personai.service"
  info "Linger tip: sudo loginctl enable-linger $USER  # keep running after logout"
}

print_summary() {
  local web_url="http://localhost:${APP_PORT}"
  local api_url="http://localhost:${API_PORT}"
  if [[ -n "$DOMAIN" && "$ENABLE_TLS" == "yes" ]]; then
    web_url="https://${DOMAIN}"
    api_url="https://api.${DOMAIN}"
  elif [[ -n "$DOMAIN" ]]; then
    web_url="http://${DOMAIN}"
    api_url="http://api.${DOMAIN}"
  fi

  cat <<EOF

${BOLD}${GRN}PersonAI OS install complete${RST}

  Install dir : ${INSTALL_DIR}
  Data dir    : ${DATA_DIR}
  Web UI      : ${web_url}
  API         : ${api_url}/health
  Ollama      : ${OLLAMA_MODE} â†’ ${OLLAMA_HOST}
  Tier        : ${LICENSE_TIER}

Useful commands:
  cd ${INSTALL_DIR}
  docker compose -f docker-compose.yml -f docker-compose.override.yml ps
  docker compose -f docker-compose.yml -f docker-compose.override.yml logs -f api
  ./scripts/pull-models.sh

EOF
}

main() {
  clear_banner
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
  log "  pull_models=$PULL_MODELS start=$START_NOW systemd=$CREATE_SYSTEMD"
  log ""
  if ! ask_yn "Proceed with installation?" "y"; then
    die "Aborted by user."
  fi

  clone_or_update
  write_env
  write_caddy_if_needed
  write_compose_override

  if [[ "$START_NOW" == "yes" ]]; then
    start_stack
    pull_models
  else
    info "Skipping start. Later: cd $INSTALL_DIR && docker compose -f docker-compose.yml -f docker-compose.override.yml up -d --build"
  fi

  install_systemd_user
  print_summary
}

main "$@"
