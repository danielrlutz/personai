#!/usr/bin/env bash
# Rebuild PersonAI on a VPS for phone access via Tailscale MagicDNS.
#
# Usage (from install dir, e.g. /etc/personaios):
#   ./scripts/vps-tailscale.sh debi9.tail8175e6.ts.net
#   ./scripts/vps-tailscale.sh                 # auto-detect MagicDNS name
#   HTTPS=1 ./scripts/vps-tailscale.sh debi9.tail8175e6.ts.net
#   ./scripts/vps-tailscale.sh --https debi9.tail8175e6.ts.net
#   NO_CACHE=1 ./scripts/vps-tailscale.sh …   # force --no-cache rebuild
#
# Default (HTTP): sets NEXT_PUBLIC_API_URL=http://HOST:4000 — fine for browsing
# inside the tailnet, but Chrome will NOT offer "Install app" (PWA) on plain HTTP
# (secure context required; localhost is the only HTTP exception).
#
# HTTPS=1 / --https (recommended for phone PWA):
#   - Enables Tailscale Serve with auto TLS on MagicDNS
#   - Web:  https://HOST          → 127.0.0.1:3000  (port 443)
#   - API:  https://HOST:8443     → 127.0.0.1:4000  (avoids clash with Docker :4000)
#   - Sets NEXT_PUBLIC_API_URL / PUBLIC_API_URL / PUBLIC_WEB_URL (+ OAuth redirect)
#
# Prerequisite for HTTPS: Tailscale admin → DNS → Enable HTTPS certificates
#   https://login.tailscale.com/admin/dns
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

NO_CACHE="${NO_CACHE:-0}"
HTTPS="${HTTPS:-${PERSONAI_TAILSCALE_HTTPS:-0}}"
MAGICDNS_ARG=""

for arg in "$@"; do
  case "$arg" in
    --https|-https) HTTPS=1 ;;
    --http|-http) HTTPS=0 ;;
    -h|--help)
      sed -n '2,24p' "$0" | sed 's/^# \{0,1\}//'
      exit 0
      ;;
    *)
      if [[ -z "$MAGICDNS_ARG" ]]; then
        MAGICDNS_ARG="$arg"
      else
        echo "x Unexpected argument: $arg" >&2
        exit 1
      fi
      ;;
  esac
done

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

ts_serve() {
  # Prefer non-interactive; fall back without --yes for older CLI builds.
  if tailscale serve --help 2>&1 | grep -qE -- '--yes'; then
    tailscale serve --bg --yes "$@"
  else
    tailscale serve --bg "$@"
  fi
}

configure_tailscale_https() {
  local host="$1"
  if ! command -v tailscale >/dev/null 2>&1; then
    echo "x tailscale CLI not found — install Tailscale on this host first" >&2
    exit 1
  fi

  echo "› Configuring Tailscale Serve (HTTPS for PWA installability)…"
  echo "  Admin prerequisite: DNS → Enable HTTPS certificates"
  echo "  https://login.tailscale.com/admin/dns"
  echo "  Web  https://${host}       → http://127.0.0.1:3000"
  echo "  API  https://${host}:8443  → http://127.0.0.1:4000"
  echo "  (8443 avoids binding clash with Docker publishing 0.0.0.0:4000)"

  # Clear prior Serve mounts so we own 443 + 8443 predictably.
  tailscale serve reset >/dev/null 2>&1 || true

  if ! ts_serve --https=443 http://127.0.0.1:3000; then
    echo "x Failed to bind Tailscale Serve on :443" >&2
    echo "  If prompted about HTTPS, enable certificates in the admin console, then re-run." >&2
    exit 1
  fi
  if ! ts_serve --https=8443 http://127.0.0.1:4000; then
    echo "x Failed to bind Tailscale Serve on :8443" >&2
    exit 1
  fi

  echo "› tailscale serve status:"
  tailscale serve status || true
}

echo "=== PersonAI Tailscale / phone rebuild ==="
echo "dir=$ROOT"

HOST="$(normalize_host "${MAGICDNS_ARG:-$(detect_magicdns)}")"
if [[ -z "$HOST" ]]; then
  echo "x Could not detect MagicDNS hostname. Pass it explicitly:" >&2
  echo "  ./scripts/vps-tailscale.sh debi9.tail8175e6.ts.net" >&2
  echo "  HTTPS=1 ./scripts/vps-tailscale.sh debi9.tail8175e6.ts.net" >&2
  exit 1
fi

if [[ "$HOST" != *.ts.net ]] && [[ -z "${MAGICDNS_ARG:-}" ]]; then
  echo "! Detected host '$HOST' is not a *.ts.net MagicDNS name."
  echo "  Prefer the full FQDN (Android often fails on short names)."
  echo "  Re-run: ./scripts/vps-tailscale.sh debi9.tail8175e6.ts.net"
fi

if [[ "$HTTPS" == "1" || "$HTTPS" == "yes" || "$HTTPS" == "true" ]]; then
  HTTPS=1
else
  HTTPS=0
fi

if [[ "$HTTPS" -eq 1 ]]; then
  API_URL="https://${HOST}:8443"
  API_URL="${API_URL%/}"
  WEB_URL="https://${HOST}"
  OAUTH_REDIRECT="https://${HOST}:8443/archive/drive/oauth/callback"
else
  API_URL="http://${HOST}:4000"
  API_URL="${API_URL%/}"
  WEB_URL="http://${HOST}:3000"
  OAUTH_REDIRECT="http://${HOST}:4000/archive/drive/oauth/callback"
fi

echo "› MagicDNS host: $HOST"
echo "› HTTPS mode:    $([[ "$HTTPS" -eq 1 ]] && echo ON || echo OFF)"
echo "› NEXT_PUBLIC_API_URL=$API_URL"
echo "› PUBLIC_WEB_URL=$WEB_URL"
if [[ "$HTTPS" -eq 0 ]]; then
  echo "! Chrome Install app / PWA requires a secure context (HTTPS)."
  echo "  HTTP on *.ts.net is fine for browsing, but NOT installable."
  echo "  Re-run with: HTTPS=1 ./scripts/vps-tailscale.sh $HOST"
fi

# ---------------------------------------------------------------------------
# .env hygiene
# ---------------------------------------------------------------------------
strip_env_kv COMPOSE_FILE
set_env_kv COMPOSE_PROFILES ""
set_env_kv OLLAMA_HOST "http://host.docker.internal:11434"
set_env_kv NEXT_PUBLIC_API_URL "$API_URL"
set_env_kv PUBLIC_API_URL "$API_URL"
set_env_kv PUBLIC_WEB_URL "$WEB_URL"
set_env_kv PERSONAI_TAILSCALE_HTTPS "$([[ "$HTTPS" -eq 1 ]] && echo 1 || echo 0)"

# Keep OAuth redirect aligned with the API origin when HTTPS toggles (or first set).
# Do not overwrite a custom redirect that points at a different host.
existing_redir="$(grep -E '^GOOGLE_OAUTH_REDIRECT_URI=' .env 2>/dev/null | head -1 | cut -d= -f2- | tr -d '\r' || true)"
if [[ -z "$existing_redir" ]] \
  || [[ "$existing_redir" == *"://${HOST}:"* ]] \
  || [[ "$existing_redir" == *"://${HOST}/"* ]] \
  || [[ "$existing_redir" == *"localhost"* ]] \
  || [[ "$existing_redir" == *"127.0.0.1"* ]]; then
  set_env_kv GOOGLE_OAUTH_REDIRECT_URI "$OAUTH_REDIRECT"
  echo "› GOOGLE_OAUTH_REDIRECT_URI=$OAUTH_REDIRECT"
  echo "  (also add this exact URI in Google Cloud → OAuth client → Authorized redirect URIs)"
else
  echo "! Leaving custom GOOGLE_OAUTH_REDIRECT_URI=$existing_redir"
fi

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
grep -E '^(COMPOSE_FILE|COMPOSE_PROFILES|OLLAMA_HOST|NEXT_PUBLIC_API_URL|PUBLIC_API_URL|PUBLIC_WEB_URL|PERSONAI_TAILSCALE_HTTPS|GOOGLE_OAUTH_REDIRECT_URI)=' .env 2>/dev/null || true

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

# ---------------------------------------------------------------------------
# Tailscale Serve (HTTPS / PWA)
# ---------------------------------------------------------------------------
if [[ "$HTTPS" -eq 1 ]]; then
  configure_tailscale_https "$HOST"
  echo ""
  echo "HTTPS probe (from this host via MagicDNS):"
  curl -sS -o /dev/null -w "web  %{http_code}  $WEB_URL/\n" --connect-timeout 5 --max-time 15 "$WEB_URL/" || true
  curl -sS -o /dev/null -w "api  %{http_code}  $API_URL/health\n" --connect-timeout 5 --max-time 15 "$API_URL/health" || true
fi

echo ""
echo "✓ Tailscale stack ready"
echo "  Phone open:     $WEB_URL"
echo "  Settings API:   $API_URL"
if [[ "$HTTPS" -eq 1 ]]; then
  echo "  PWA install:    Chrome → open $WEB_URL → menu → Install app"
  echo "  (Add to Home screen / shortcut on plain HTTP is NOT a real PWA.)"
  echo "  OAuth redirect: $OAUTH_REDIRECT"
else
  echo "  PWA install:    unavailable over HTTP — use HTTPS=1 for Install app"
fi
echo "  If phone still fails: Chrome → Delete site data for $WEB_URL, then set Settings API URL to $API_URL"
echo "  HEAD: $(git rev-parse --short HEAD 2>/dev/null || echo n/a)"
