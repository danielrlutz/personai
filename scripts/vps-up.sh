#!/usr/bin/env bash
# Start PersonAI on a VPS with host/native Ollama (never starts compose ollama).
#
# Usage (from install dir, e.g. /etc/personaios):
#   ./scripts/vps-up.sh
#   ./scripts/vps-up.sh api          # api only
#   ./scripts/vps-up.sh all          # full stack (default)
#
# Forces COMPOSE_PROFILES empty (ignores stale .env), points API at
# host.docker.internal, removes leftover ollama containers, then up --build.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

TARGET="${1:-all}"
COMPOSE_BASE=()
if [[ -f docker-compose.prod.yml ]] && [[ -f Caddyfile ]]; then
  # Prefer prod file when present (typical VPS + domain install)
  if grep -qE '^PERSONAI_DOMAIN=.+' .env 2>/dev/null || [[ "${PERSONAI_USE_PROD:-}" == "1" ]]; then
    COMPOSE_BASE=(-f docker-compose.prod.yml)
  fi
fi
if [[ ${#COMPOSE_BASE[@]} -eq 0 ]]; then
  COMPOSE_BASE=(-f docker-compose.yml)
fi
[[ -f docker-compose.override.yml ]] && COMPOSE_BASE+=(-f docker-compose.override.yml)

# Never load docker-compose.ollama.yml here.
export COMPOSE_PROFILES=

# Ensure .env does not re-enable a legacy profile on later bare `docker compose` runs
if [[ -f .env ]]; then
  if grep -qE '^COMPOSE_PROFILES=.*bundled-ollama' .env 2>/dev/null; then
    echo "! Clearing COMPOSE_PROFILES=bundled-ollama from .env (legacy; ollama is a separate -f file now)"
    # portable in-place clear
    awk 'BEGIN{FS=OFS="="} $1=="COMPOSE_PROFILES"{$0="COMPOSE_PROFILES="} {print}' .env >.env.vps-up.tmp
    mv .env.vps-up.tmp .env
  fi
  if ! grep -qE '^OLLAMA_HOST=' .env 2>/dev/null; then
    echo "OLLAMA_HOST=http://host.docker.internal:11434" >>.env
  elif grep -qE '^OLLAMA_HOST=https?://(127\.0\.0\.1|localhost)' .env 2>/dev/null; then
    echo "! Rewriting loopback OLLAMA_HOST → host.docker.internal (API runs in Docker)"
    awk 'BEGIN{FS=OFS="="} $1=="OLLAMA_HOST"{$0="OLLAMA_HOST=http://host.docker.internal:11434"} {print}' .env >.env.vps-up.tmp
    mv .env.vps-up.tmp .env
  elif grep -qE '^OLLAMA_HOST=http://ollama:11434' .env 2>/dev/null; then
    echo "! Rewriting compose-service OLLAMA_HOST → host.docker.internal"
    awk 'BEGIN{FS=OFS="="} $1=="OLLAMA_HOST"{$0="OLLAMA_HOST=http://host.docker.internal:11434"} {print}' .env >.env.vps-up.tmp
    mv .env.vps-up.tmp .env
  fi
fi

echo "› Removing leftover compose/host-named ollama containers (if any)…"
COMPOSE_PROFILES= docker compose "${COMPOSE_BASE[@]}" rm -f -s ollama 2>/dev/null || true
# Project-name variants from directory names like /etc/personaios
for name in personaios-ollama-1 personai-ollama-1 "$(basename "$ROOT")-ollama-1"; do
  docker rm -f "$name" 2>/dev/null || true
done

echo "› COMPOSE_PROFILES='${COMPOSE_PROFILES-}' (must be empty)"
echo "› Files: ${COMPOSE_BASE[*]}"
grep -E '^(COMPOSE_PROFILES|OLLAMA_HOST)=' .env 2>/dev/null || true

case "$TARGET" in
  api)
    COMPOSE_PROFILES= docker compose "${COMPOSE_BASE[@]}" up api -d --build --remove-orphans
    ;;
  all|*)
    COMPOSE_PROFILES= docker compose "${COMPOSE_BASE[@]}" up -d --build --remove-orphans
    ;;
esac

echo "› Running services:"
COMPOSE_PROFILES= docker compose "${COMPOSE_BASE[@]}" ps
if COMPOSE_PROFILES= docker compose "${COMPOSE_BASE[@]}" ps --services 2>/dev/null | grep -qi ollama; then
  echo "x ollama is still listed — refuse to leave it running" >&2
  exit 1
fi
if docker ps --format '{{.Names}}' | grep -Eqi 'ollama'; then
  echo "! Note: an ollama container exists outside this compose project (ok if intentional)."
fi
echo "✓ Stack up without compose ollama. Verify: docker compose ps  # no ollama"
