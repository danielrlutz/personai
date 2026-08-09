#!/usr/bin/env bash
# Bulletproof VPS recovery: host/native Ollama, API only (no compose ollama).
#
# Paste on the VPS (from your install dir), or:
#   curl -fsSL https://raw.githubusercontent.com/danielrlutz/personai/main/scripts/vps-recover-api.sh | bash
#
# Or after git pull:
#   ./scripts/vps-recover-api.sh
set -euo pipefail

# If piped via curl|bash, BASH_SOURCE is often /dev/fd/* — discover install dir.
ROOT=""
_src="${BASH_SOURCE[0]:-}"
if [[ -n "$_src" && -f "$_src" && "$_src" != /dev/fd/* && "$_src" != /proc/self/fd/* ]]; then
  _candidate="$(cd "$(dirname "$_src")/.." && pwd)"
  if [[ -f "$_candidate/docker-compose.yml" ]]; then
    ROOT="$_candidate"
  fi
fi
if [[ -z "$ROOT" ]]; then
  for cand in "$(pwd)" /etc/personaios "$HOME/personai" "$HOME/personaios"; do
    if [[ -f "$cand/docker-compose.yml" && -d "$cand/.git" ]]; then
      ROOT="$cand"
      break
    fi
  done
fi
ROOT="${ROOT:-$(pwd)}"
cd "$ROOT"
echo "=== PersonAI VPS recover (no compose ollama) ==="
echo "dir=$ROOT"

MIN_OK_COMMIT=a2f2533

echo ""
echo "--- git ---"
git fetch origin
git rev-parse HEAD
git log -1 --oneline
NEED_RESET=0
if ! git merge-base --is-ancestor "$MIN_OK_COMMIT" HEAD 2>/dev/null; then
  echo "! HEAD is not $MIN_OK_COMMIT or newer (no-ollama base) — will reset to origin/main"
  NEED_RESET=1
fi
# Also reset if docker-compose.yml still defines an ollama service
if grep -qE '^[[:space:]]*ollama:' docker-compose.yml 2>/dev/null; then
  echo "! docker-compose.yml still defines ollama — will reset to origin/main"
  NEED_RESET=1
fi
# Behind origin/main
if [[ "$(git rev-parse HEAD)" != "$(git rev-parse origin/main)" ]]; then
  echo "! HEAD != origin/main — will reset --hard origin/main"
  NEED_RESET=1
fi

if [[ "$NEED_RESET" -eq 1 ]]; then
  git reset --hard origin/main
  echo "after reset:"
  git rev-parse HEAD
  git log -1 --oneline
fi

if grep -qE '^[[:space:]]*ollama:' docker-compose.yml 2>/dev/null; then
  echo "x Base docker-compose.yml still has ollama after reset — abort" >&2
  exit 1
fi

# Clear compose env that can pull the overlay
unset COMPOSE_FILE || true
export COMPOSE_FILE=
export COMPOSE_PROFILES=
export OLLAMA_HOST="${OLLAMA_HOST:-http://host.docker.internal:11434}"

if [[ -f .env ]]; then
  cp -a .env ".env.bak.recover.$(date +%Y%m%d%H%M%S)"
  # Drop COMPOSE_FILE entirely; blank COMPOSE_PROFILES; fix OLLAMA_HOST
  awk '
    BEGIN{FS=OFS="="}
    $1=="COMPOSE_FILE" { next }
    $1=="COMPOSE_PROFILES" { print "COMPOSE_PROFILES="; next }
    $1=="OLLAMA_HOST" {
      if ($0 ~ /127\.0\.0\.1/ || $0 ~ /localhost/ || $0 ~ /ollama:11434/)
        print "OLLAMA_HOST=http://host.docker.internal:11434"
      else print
      next
    }
    { print }
  ' .env >.env.recover.tmp
  mv .env.recover.tmp .env
  if ! grep -qE '^OLLAMA_HOST=' .env; then
    echo 'OLLAMA_HOST=http://host.docker.internal:11434' >>.env
  fi
  if ! grep -qE '^COMPOSE_PROFILES=' .env; then
    echo 'COMPOSE_PROFILES=' >>.env
  fi
else
  cat >.env <<'EOF'
OLLAMA_HOST=http://host.docker.internal:11434
COMPOSE_PROFILES=
EOF
fi

# Strip leftover ollama from override (old install.sh wrote ports/profiles/deploy)
if [[ -f docker-compose.override.yml ]] && grep -qE '^[[:space:]]*ollama:' docker-compose.override.yml; then
  echo "! Stripping ollama from docker-compose.override.yml"
  cp -a docker-compose.override.yml "docker-compose.override.yml.bak.$(date +%Y%m%d%H%M%S)"
  awk '
    BEGIN { skip=0 }
    /^[[:space:]]*ollama:[[:space:]]*$/ { skip=1; next }
    skip {
      if (/^  [A-Za-z0-9_-]+:/ || /^[A-Za-z0-9_-]+:/) { skip=0 }
      else { next }
    }
    { print }
  ' docker-compose.override.yml >docker-compose.override.yml.recover.tmp
  mv docker-compose.override.yml.recover.tmp docker-compose.override.yml
fi

COMPOSE_BASE=(-f docker-compose.yml)
if [[ -f docker-compose.prod.yml && -f Caddyfile ]] && grep -qE '^PERSONAI_DOMAIN=.+' .env 2>/dev/null; then
  COMPOSE_BASE=(-f docker-compose.prod.yml)
fi
[[ -f docker-compose.override.yml ]] && COMPOSE_BASE+=(-f docker-compose.override.yml)

echo ""
echo "--- docker compose config --services (must NOT list ollama) ---"
echo "COMPOSE_FILE='${COMPOSE_FILE-}' COMPOSE_PROFILES='${COMPOSE_PROFILES-}'"
echo "files: ${COMPOSE_BASE[*]}"
SERVICES="$(COMPOSE_FILE= COMPOSE_PROFILES= docker compose "${COMPOSE_BASE[@]}" config --services)"
echo "$SERVICES"

if echo "$SERVICES" | grep -qi '^ollama$'; then
  echo "x ollama still listed — dumping why:" >&2
  echo "COMPOSE_FILE(env)=${COMPOSE_FILE-<unset>} COMPOSE_PROFILES(env)=${COMPOSE_PROFILES-<unset>}"
  echo "ls compose*.yml docker-compose*.yml:"
  ls -la compose*.yml docker-compose*.yml 2>/dev/null || true
  echo ".env compose-related:"
  grep -E '^(COMPOSE_|OLLAMA_|PERSONAI_OLLAMA)' .env || true
  echo "--- override ---"
  cat docker-compose.override.yml 2>/dev/null || true
  echo "--- config --services again ---"
  COMPOSE_FILE= COMPOSE_PROFILES= docker compose "${COMPOSE_BASE[@]}" config --services || true
  exit 1
fi

echo ""
echo "--- cleanup leftovers ---"
docker rm -f personaios-ollama-1 personai-ollama-1 "$(basename "$ROOT")-ollama-1" 2>/dev/null || true
COMPOSE_FILE= COMPOSE_PROFILES= docker compose "${COMPOSE_BASE[@]}" down --remove-orphans || true

echo ""
echo "--- up api ---"
COMPOSE_FILE= COMPOSE_PROFILES= docker compose "${COMPOSE_BASE[@]}" up api -d --build --remove-orphans

echo ""
echo "--- verify ---"
COMPOSE_FILE= COMPOSE_PROFILES= docker compose "${COMPOSE_BASE[@]}" ps
echo ""
if COMPOSE_FILE= COMPOSE_PROFILES= docker compose "${COMPOSE_BASE[@]}" ps --services 2>/dev/null | grep -qi ollama; then
  echo "x FAIL: ollama still in ps" >&2
  exit 1
fi
NAMES="$(COMPOSE_FILE= COMPOSE_PROFILES= docker compose "${COMPOSE_BASE[@]}" ps --format '{{.Name}}' 2>/dev/null || true)"
if [[ -z "$(echo "$NAMES" | tr -d '[:space:]')" ]]; then
  # older compose without --format
  COMPOSE_FILE= COMPOSE_PROFILES= docker compose "${COMPOSE_BASE[@]}" ps
fi
echo "✓ API up without compose ollama"
echo "  OLLAMA_HOST should be host.docker.internal — check: grep OLLAMA_HOST .env"
echo "  Health: curl -sS http://127.0.0.1:4000/health || curl -sS http://127.0.0.1:\${API_PORT:-4000}/health"
echo "  Phone / Tailscale (api+web, MagicDNS bake-in): ./scripts/vps-tailscale.sh debi9.tail8175e6.ts.net"
