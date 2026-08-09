#!/usr/bin/env bash
# Start PersonAI on a VPS with host/native Ollama (never starts compose ollama).
#
# Usage (from install dir, e.g. /etc/personaios or ~/personai):
#   ./scripts/vps-up.sh
#   ./scripts/vps-up.sh api          # api only
#   ./scripts/vps-up.sh all          # full stack (default)
#
# Phone / Tailscale MagicDNS (bakes NEXT_PUBLIC_API_URL + health checks):
#   ./scripts/vps-tailscale.sh debi9.tail8175e6.ts.net
#
# Unsets COMPOSE_FILE / COMPOSE_PROFILES (stale .env or shell can pull in
# docker-compose.ollama.yml), strips leftover ollama from override, removes
# leftover containers, points API at host.docker.internal, then up --build.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

TARGET="${1:-all}"

# ---------------------------------------------------------------------------
# Never honor env that pulls the ollama overlay into a bare `docker compose`
# ---------------------------------------------------------------------------
unset COMPOSE_FILE || true
export COMPOSE_FILE=
export COMPOSE_PROFILES=

strip_env_kv() {
  local key="$1"
  [[ -f .env ]] || return 0
  if grep -qE "^${key}=" .env 2>/dev/null; then
    echo "! Clearing ${key} from .env"
    awk -v k="$key" 'BEGIN{FS=OFS="="} $1==k{next} {print}' .env >.env.vps-up.tmp
    mv .env.vps-up.tmp .env
  fi
}

set_env_kv() {
  local key="$1" val="$2"
  if [[ ! -f .env ]]; then
    printf '%s=%s\n' "$key" "$val" >.env
    return
  fi
  if grep -qE "^${key}=" .env 2>/dev/null; then
    awk -v k="$key" -v v="$val" 'BEGIN{FS=OFS="="} $1==k{$0=k"="v} {print}' .env >.env.vps-up.tmp
    mv .env.vps-up.tmp .env
  else
    printf '%s=%s\n' "$key" "$val" >>.env
  fi
}

# COMPOSE_FILE in .env is loaded by Compose and can re-attach ollama.yml
strip_env_kv COMPOSE_FILE
if grep -qE '^COMPOSE_PROFILES=.*\S' .env 2>/dev/null; then
  echo "! Clearing COMPOSE_PROFILES from .env (must stay empty for host Ollama)"
  set_env_kv COMPOSE_PROFILES ""
fi

# ---------------------------------------------------------------------------
# Compose file set — never include docker-compose.ollama.yml
# ---------------------------------------------------------------------------
COMPOSE_BASE=()
if [[ -f docker-compose.prod.yml ]] && [[ -f Caddyfile ]]; then
  if grep -qE '^PERSONAI_DOMAIN=.+' .env 2>/dev/null || [[ "${PERSONAI_USE_PROD:-}" == "1" ]]; then
    COMPOSE_BASE=(-f docker-compose.prod.yml)
  fi
fi
if [[ ${#COMPOSE_BASE[@]} -eq 0 ]]; then
  COMPOSE_BASE=(-f docker-compose.yml)
fi
[[ -f docker-compose.override.yml ]] && COMPOSE_BASE+=(-f docker-compose.override.yml)

# Drop accidental ollama.yml if someone appended it to COMPOSE_BASE
_filtered=()
for arg in "${COMPOSE_BASE[@]}"; do
  if [[ "$arg" == *ollama* ]]; then
    echo "! Refusing compose file that references ollama: $arg"
    continue
  fi
  _filtered+=("$arg")
done
COMPOSE_BASE=("${_filtered[@]}")

# ---------------------------------------------------------------------------
# Strip stale `ollama:` service from override (pre-a2f2533 install leftovers)
# ---------------------------------------------------------------------------
strip_ollama_from_override() {
  local f=docker-compose.override.yml
  [[ -f "$f" ]] || return 0
  if ! grep -qE '^[[:space:]]*ollama:' "$f" 2>/dev/null; then
    return 0
  fi
  echo "! Stripping leftover ollama service from $f (host Ollama mode)"
  cp -a "$f" "${f}.bak.$(date +%Y%m%d%H%M%S)"
  awk '
    BEGIN { skip=0 }
    /^[[:space:]]*ollama:[[:space:]]*$/ { skip=1; next }
    skip {
      # next top-level key under services: (two-space indent) or root key
      if (/^  [A-Za-z0-9_-]+:/ || /^[A-Za-z0-9_-]+:/) { skip=0 }
      else { next }
    }
    { print }
  ' "$f" >"${f}.vps-up.tmp"
  mv "${f}.vps-up.tmp" "$f"
}

strip_ollama_from_override

# ---------------------------------------------------------------------------
# OLLAMA_HOST → host gateway for API-in-Docker
# ---------------------------------------------------------------------------
if [[ -f .env ]]; then
  if ! grep -qE '^OLLAMA_HOST=' .env 2>/dev/null; then
    echo "OLLAMA_HOST=http://host.docker.internal:11434" >>.env
  elif grep -qE '^OLLAMA_HOST=https?://(127\.0\.0\.1|localhost)' .env 2>/dev/null; then
    echo "! Rewriting loopback OLLAMA_HOST → host.docker.internal (API runs in Docker)"
    set_env_kv OLLAMA_HOST "http://host.docker.internal:11434"
  elif grep -qE '^OLLAMA_HOST=http://ollama:11434' .env 2>/dev/null; then
    echo "! Rewriting compose-service OLLAMA_HOST → host.docker.internal"
    set_env_kv OLLAMA_HOST "http://host.docker.internal:11434"
  fi
fi

dump_ollama_why() {
  echo "--- why is ollama in compose? ---"
  echo "HEAD: $(git rev-parse HEAD 2>/dev/null || echo n/a)  $(git log -1 --oneline 2>/dev/null || true)"
  echo "COMPOSE_FILE(env)='${COMPOSE_FILE-}' COMPOSE_PROFILES(env)='${COMPOSE_PROFILES-}'"
  echo "shell COMPOSE_FILE was cleared; .env keys:"
  grep -E '^(COMPOSE_FILE|COMPOSE_PROFILES|OLLAMA_HOST|PERSONAI_OLLAMA_MODE)=' .env 2>/dev/null || echo "(none)"
  echo "compose files on disk:"
  ls -la compose*.yml docker-compose*.yml 2>/dev/null || true
  echo "explicit -f set: ${COMPOSE_BASE[*]}"
  if [[ -f docker-compose.override.yml ]]; then
    echo "--- docker-compose.override.yml (head) ---"
    head -n 80 docker-compose.override.yml || true
  fi
  if grep -nE 'ollama' docker-compose.yml docker-compose.prod.yml docker-compose.override.yml 2>/dev/null; then
    :
  fi
  echo "--- docker compose config --services ---"
  COMPOSE_FILE= COMPOSE_PROFILES= docker compose "${COMPOSE_BASE[@]}" config --services 2>&1 || true
  echo "--------------------------------"
}

echo "› Removing leftover compose/host-named ollama containers (if any)…"
COMPOSE_FILE= COMPOSE_PROFILES= docker compose "${COMPOSE_BASE[@]}" rm -f -s ollama 2>/dev/null || true
for name in personaios-ollama-1 personai-ollama-1 "$(basename "$ROOT")-ollama-1"; do
  docker rm -f "$name" 2>/dev/null || true
done

echo "› COMPOSE_FILE='${COMPOSE_FILE-}' COMPOSE_PROFILES='${COMPOSE_PROFILES-}' (both must be empty)"
echo "› Files: ${COMPOSE_BASE[*]}"
grep -E '^(COMPOSE_FILE|COMPOSE_PROFILES|OLLAMA_HOST|PERSONAI_OLLAMA_MODE)=' .env 2>/dev/null || true

SERVICES="$(COMPOSE_FILE= COMPOSE_PROFILES= docker compose "${COMPOSE_BASE[@]}" config --services 2>/dev/null || true)"
echo "› config --services:"
echo "$SERVICES"
if echo "$SERVICES" | grep -qi '^ollama$'; then
  dump_ollama_why
  # One more pass: drop override entirely if it still injects ollama
  if [[ -f docker-compose.override.yml ]] && grep -qE '^[[:space:]]*ollama:' docker-compose.override.yml 2>/dev/null; then
    strip_ollama_from_override
    SERVICES="$(COMPOSE_FILE= COMPOSE_PROFILES= docker compose "${COMPOSE_BASE[@]}" config --services 2>/dev/null || true)"
  fi
  if echo "$SERVICES" | grep -qi '^ollama$'; then
    echo "x ollama still in compose config after cleanup — aborting" >&2
    dump_ollama_why
    exit 1
  fi
fi

case "$TARGET" in
  api)
    COMPOSE_FILE= COMPOSE_PROFILES= docker compose "${COMPOSE_BASE[@]}" up api -d --build --remove-orphans
    ;;
  all|*)
    COMPOSE_FILE= COMPOSE_PROFILES= docker compose "${COMPOSE_BASE[@]}" up -d --build --remove-orphans
    ;;
esac

echo "› Running services:"
COMPOSE_FILE= COMPOSE_PROFILES= docker compose "${COMPOSE_BASE[@]}" ps
if COMPOSE_FILE= COMPOSE_PROFILES= docker compose "${COMPOSE_BASE[@]}" ps --services 2>/dev/null | grep -qi ollama; then
  echo "x ollama is still listed — refuse to leave it running" >&2
  dump_ollama_why
  exit 1
fi
if docker ps --format '{{.Names}}' | grep -Eqi 'ollama'; then
  echo "! Note: an ollama container exists outside this compose project (ok if intentional / host install)."
fi
echo "✓ Stack up without compose ollama. Verify: docker compose ps  # no ollama"
