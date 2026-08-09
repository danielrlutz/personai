#!/usr/bin/env bash
# Rebuild PersonAI on a VPS for phone access via Tailscale MagicDNS.
#
# Usage (from install dir, e.g. /etc/personaios):
#   ./scripts/vps-tailscale.sh debi9.tail8175e6.ts.net
#   ./scripts/vps-tailscale.sh                 # auto-detect MagicDNS name
#   NO_CACHE=1 ./scripts/vps-tailscale.sh …   # force --no-cache rebuild
#
# Sets NEXT_PUBLIC_API_URL=http://HOST:4000 (no trailing slash), points Ollama
# at host-gateway, clears COMPOSE_FILE/PROFILES, rebuilds api+web, health-checks
# :4000/health and :3000.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

NO_CACHE="${NO_CACHE:-0}"
MAGICDNS_ARG="${1:-}"

# ---------------------------------------------------------------------------
# Helpers (aligned with vps-up.sh)
# ---------------------------------------------------------------------------
unset COMPOSE_FILE || true
export COMPOSE_FILE=
export COMPOSE_PROFILES=

strip_env_kv() {
  local key="$1"
  [[ -f .env ]] || return 0
  if grep -qE "^${key}=" .env 2>/dev/null; then
    echo "! Clearing ${key} from .env"
    awk -v k="$key" 'BEGIN{FS=OFS="="} $1==k{next} {print}' .env >.env.vps-ts.tmp
    mv .env.vps-ts.tmp .env
  fi
}

set_env_kv() {
  local key="$1" val="$2"
  if [[ ! -f .env ]]; then
    printf '%s=%s\n' "$key" "$val" >.env
    return
  fi
  if grep -qE "^${key}=" .env 2>/dev/null; then
    awk -v k="$key" -v v="$val" 'BEGIN{FS=OFS="="} $1==k{$0=k"="v} {print}' .env >.env.vps-ts.tmp
    mv .env.vps-ts.tmp .env
  else
    printf '%s=%s\n' "$key" "$val" >>.env
  fi
}

detect_magicdns() {
  local name=""
  if command -v tailscale >/dev/null 2>&1; then
    # Prefer Self.DNSName from status JSON (e.g. debi9.tail8175e6.ts.net.)
    if command -v jq >/dev/null 2>&1; then
      name="$(tailscale status --json 2>/dev/null | jq -r '.Self.DNSName // empty' | sed 's/\.$//')" || true
    elif command -v python3 >/dev/null 2>&1; then
      name="$(tailscale status --json 2>/dev/null | python3 -c 'import json,sys; d=json.load(sys.stdin); print((d.get("Self") or {}).get("DNSName") or "")' | sed 's/\.$//')" || true
    else
      name="$(tailscale status --json 2>/dev/null | sed -n 's/.*"DNSName"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' | head -1 | sed 's/\.$//')" || true
    fi
    if [[ -z "$name" ]]; then
      name="$(tailscale status --self 2>/dev/null | awk 'NR==1{print $1; exit}')" || true
    fi
  fi
  if [[ -z "$name" ]] && [[ -f .env ]]; then
    # Fall back to host part of existing NEXT_PUBLIC_API_URL
    local existing
    existing="$(grep -E '^NEXT_PUBLIC_API_URL=' .env 2>/dev/null | head -1 | cut -d= -f2- | tr -d '\r' || true)"
    if [[ "$existing" =~ ^https?://([^/:]+) ]]; then
      name="${BASH_REMATCH[1]}"
    fi
  fi
  if [[ -z "$name" ]]; then
    name="$(hostname -f 2>/dev/null || hostname 2>/dev/null || true)"
  fi
  printf '%s' "$name"
}

normalize_host() {
  local h="$1"
  h="${h#http://}"
  h="${h#https://}"
  h="${h%%/*}"
  h="${h%%:*}"
  h="${h%.}"
  printf '%s' "$h"
}

echo "=== PersonAI Tailscale / phone rebuild ==="
echo "dir=$ROOT"

HOST="$(normalize_host "${MAGICDNS_ARG:-$(detect_magicdns)}")"
if [[ -z "$HOST" ]]; then
  echo "x Could not detect MagicDNS hostname. Pass it explicitly:" >&2
  echo "  ./scripts/vps-tailscale.sh debi9.tail8175e6.ts.net" >&2
  exit 1
fi

if [[ "$HOST" != *.ts.net ]] && [[ -z "${MAGICDNS_ARG:-}" ]]; then
  echo "! Detected host '$HOST' is not a *.ts.net MagicDNS name."
  echo "  Prefer the full FQDN (Android often fails on short names)."
  echo "  Re-run: ./scripts/vps-tailscale.sh debi9.tail8175e6.ts.net"
fi

API_URL="http://${HOST}:4000"
API_URL="${API_URL%/}"
WEB_URL="http://${HOST}:3000"

echo "› MagicDNS host: $HOST"
echo "› NEXT_PUBLIC_API_URL=$API_URL"
echo "› Web (phone):   $WEB_URL"

# ---------------------------------------------------------------------------
# .env hygiene
# ---------------------------------------------------------------------------
strip_env_kv COMPOSE_FILE
set_env_kv COMPOSE_PROFILES ""
set_env_kv OLLAMA_HOST "http://host.docker.internal:11434"
set_env_kv NEXT_PUBLIC_API_URL "$API_URL"

# ---------------------------------------------------------------------------
# Compose file set — never include docker-compose.ollama.yml
# ---------------------------------------------------------------------------
COMPOSE_BASE=(-f docker-compose.yml)
if [[ -f docker-compose.prod.yml ]] && [[ -f Caddyfile ]]; then
  if grep -qE '^PERSONAI_DOMAIN=.+' .env 2>/dev/null || [[ "${PERSONAI_USE_PROD:-}" == "1" ]]; then
    COMPOSE_BASE=(-f docker-compose.prod.yml)
  fi
fi
[[ -f docker-compose.override.yml ]] && COMPOSE_BASE+=(-f docker-compose.override.yml)

_filtered=()
for arg in "${COMPOSE_BASE[@]}"; do
  if [[ "$arg" == *ollama* ]]; then
    echo "! Refusing compose file that references ollama: $arg"
    continue
  fi
  _filtered+=("$arg")
done
COMPOSE_BASE=("${_filtered[@]}")

if [[ -f docker-compose.override.yml ]] && grep -qE '^[[:space:]]*ollama:' docker-compose.override.yml 2>/dev/null; then
  echo "! Stripping leftover ollama service from docker-compose.override.yml"
  cp -a docker-compose.override.yml "docker-compose.override.yml.bak.$(date +%Y%m%d%H%M%S)"
  awk '
    BEGIN { skip=0 }
    /^[[:space:]]*ollama:[[:space:]]*$/ { skip=1; next }
    skip {
      if (/^  [A-Za-z0-9_-]+:/ || /^[A-Za-z0-9_-]+:/) { skip=0 }
      else { next }
    }
    { print }
  ' docker-compose.override.yml >docker-compose.override.yml.vps-ts.tmp
  mv docker-compose.override.yml.vps-ts.tmp docker-compose.override.yml
fi

echo "› COMPOSE_FILE='${COMPOSE_FILE-}' COMPOSE_PROFILES='${COMPOSE_PROFILES-}'"
echo "› Files: ${COMPOSE_BASE[*]}"
grep -E '^(COMPOSE_FILE|COMPOSE_PROFILES|OLLAMA_HOST|NEXT_PUBLIC_API_URL)=' .env 2>/dev/null || true

SERVICES="$(COMPOSE_FILE= COMPOSE_PROFILES= docker compose "${COMPOSE_BASE[@]}" config --services 2>/dev/null || true)"
echo "› config --services:"
echo "$SERVICES"
if echo "$SERVICES" | grep -qi '^ollama$'; then
  echo "x ollama still in compose config — aborting" >&2
  exit 1
fi

# ---------------------------------------------------------------------------
# Build + up
# ---------------------------------------------------------------------------
BUILD_ARGS=(api web)
echo "› Building ${BUILD_ARGS[*]} (NEXT_PUBLIC_API_URL baked into web)…"
if [[ "$NO_CACHE" == "1" ]]; then
  COMPOSE_FILE= COMPOSE_PROFILES= docker compose "${COMPOSE_BASE[@]}" build --no-cache "${BUILD_ARGS[@]}"
else
  COMPOSE_FILE= COMPOSE_PROFILES= docker compose "${COMPOSE_BASE[@]}" build "${BUILD_ARGS[@]}"
fi

echo "› Starting stack…"
COMPOSE_FILE= COMPOSE_PROFILES= docker compose "${COMPOSE_BASE[@]}" up -d --remove-orphans

echo "› Waiting for health…"
ok_api=0
ok_web=0
for i in $(seq 1 60); do
  if curl -fsS "http://127.0.0.1:4000/health" >/dev/null 2>&1 \
    || curl -fsS "http://127.0.0.1:4000/health/" >/dev/null 2>&1; then
    ok_api=1
  fi
  if curl -fsS -o /dev/null -w "%{http_code}" "http://127.0.0.1:3000/" 2>/dev/null | grep -qE '200|301|302|304'; then
    ok_web=1
  fi
  if [[ "$ok_api" -eq 1 && "$ok_web" -eq 1 ]]; then
    break
  fi
  sleep 2
done

echo ""
echo "--- verify ---"
COMPOSE_FILE= COMPOSE_PROFILES= docker compose "${COMPOSE_BASE[@]}" ps
echo ""
echo "API /health:"
curl -sS "http://127.0.0.1:4000/health" || true
echo ""
echo "API /health/ (trailing slash must also work):"
curl -sS "http://127.0.0.1:4000/health/" || true
echo ""
echo "Web / (expect HTML, not empty):"
curl -sS -o /dev/null -w "HTTP %{http_code}\n" "http://127.0.0.1:3000/" || true
echo "Web /dashboard (no slash) → Location must be relative /dashboard/ (not :80):"
dash_hdrs="$(curl -sSI "http://127.0.0.1:3000/dashboard" 2>/dev/null || true)"
echo "$dash_hdrs" | head -8
if echo "$dash_hdrs" | grep -qiE '^Location:[[:space:]]*https?://[^/]+:80/'; then
  echo "x FAIL: absolute redirect to :80 — phone would get ERR_CONNECTION_REFUSED" >&2
  exit 1
fi
if echo "$dash_hdrs" | grep -qiE '^Location:[[:space:]]*https?://(localhost|127\.0\.0\.1)'; then
  echo "x FAIL: redirect to localhost — phone would get ERR_CONNECTION_REFUSED" >&2
  exit 1
fi
loc_line="$(echo "$dash_hdrs" | grep -i '^Location:' | head -1 || true)"
if [[ -n "$loc_line" ]] && ! echo "$loc_line" | grep -qiE '^Location:[[:space:]]*/dashboard/?'; then
  echo "! Unexpected Location (want relative /dashboard/): $loc_line"
fi
echo "Web /_app (expect real 404, not index.html):"
curl -sS -o /dev/null -w "HTTP %{http_code}\n" "http://127.0.0.1:3000/_app/immutable/x.js" || true
body_snip="$(curl -sS "http://127.0.0.1:3000/_app/version.json" 2>/dev/null | head -c 120 || true)"
if echo "$body_snip" | grep -qi '<html\|<!DOCTYPE'; then
  echo "x FAIL: /_app returned HTML SPA fallback — nginx.conf not applied" >&2
  exit 1
fi
echo "  body snip: ${body_snip:-(empty/404)}"

if [[ "$ok_api" -ne 1 ]]; then
  echo "x API health failed on :4000" >&2
  exit 1
fi
if [[ "$ok_web" -ne 1 ]]; then
  echo "x Web failed on :3000" >&2
  exit 1
fi

echo ""
echo "✓ Tailscale stack ready"
echo "  Phone open:     $WEB_URL"
echo "  Settings API:   $API_URL"
echo "  If phone still fails: Chrome → Delete site data for $WEB_URL, then set Settings API URL to $API_URL"
echo "  HEAD: $(git rev-parse --short HEAD 2>/dev/null || echo n/a)"
