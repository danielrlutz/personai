#!/usr/bin/env bash
# PersonAI VPS health / "Failed to fetch" checklist.
#
# Usage (from install dir, e.g. /etc/personaios):
#   ./scripts/vps-verify.sh
#   ./scripts/vps-verify.sh debi9.tail8175e6.ts.net
#
# Prints: git SHA, compose ps, curl :4000/health, curl :3000/, ollama tags,
# whether Drive OAuth env is set, and paste-ready phone checks.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

HOST_ARG="${1:-}"
MAGICDNS="${HOST_ARG:-debi9.tail8175e6.ts.net}"
MAGICDNS="${MAGICDNS#http://}"
MAGICDNS="${MAGICDNS#https://}"
MAGICDNS="${MAGICDNS%%/*}"
MAGICDNS="${MAGICDNS%%:*}"
MAGICDNS="${MAGICDNS%.}"

unset COMPOSE_FILE || true
export COMPOSE_FILE=
export COMPOSE_PROFILES=

COMPOSE_BASE=(-f docker-compose.yml)
if [[ -f docker-compose.prod.yml ]] && [[ -f Caddyfile ]]; then
  if grep -qE '^PERSONAI_DOMAIN=.+' .env 2>/dev/null || [[ "${PERSONAI_USE_PROD:-}" == "1" ]]; then
    COMPOSE_BASE=(-f docker-compose.prod.yml)
  fi
fi
[[ -f docker-compose.override.yml ]] && COMPOSE_BASE+=(-f docker-compose.override.yml)

section() { printf '\n=== %s ===\n' "$1"; }
ok() { printf '✓ %s\n' "$1"; }
bad() { printf 'x %s\n' "$1"; }
note() { printf '› %s\n' "$1"; }

FAIL=0

section "Git"
if [[ -d .git ]]; then
  echo "HEAD: $(git rev-parse HEAD 2>/dev/null || echo unknown)"
  echo "short: $(git rev-parse --short HEAD 2>/dev/null || echo unknown)"
  echo "oneline: $(git log -1 --oneline 2>/dev/null || echo n/a)"
  echo "branch: $(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo n/a)"
  echo "upstream: $(git rev-parse --abbrev-ref '@{u}' 2>/dev/null || echo '(none)')"
else
  bad "Not a git checkout at $ROOT"
  FAIL=1
fi

section "Compose"
note "COMPOSE_FILE='${COMPOSE_FILE-}' COMPOSE_PROFILES='${COMPOSE_PROFILES-}'"
note "files: ${COMPOSE_BASE[*]}"
if command -v docker >/dev/null 2>&1; then
  COMPOSE_FILE= COMPOSE_PROFILES= docker compose "${COMPOSE_BASE[@]}" ps || true
  SERVICES="$(COMPOSE_FILE= COMPOSE_PROFILES= docker compose "${COMPOSE_BASE[@]}" config --services 2>/dev/null || true)"
  note "services: $(echo "$SERVICES" | tr '\n' ' ')"
  if echo "$SERVICES" | grep -qi '^ollama$'; then
    note "compose includes ollama (host-Ollama mode usually does not)"
  fi
else
  bad "docker not found"
  FAIL=1
fi

section "API :4000/health (must be 0.0.0.0 in container)"
API_BODY="$(curl -sS --connect-timeout 2 --max-time 5 "http://127.0.0.1:4000/health" 2>&1 || true)"
API_CODE="$(curl -sS -o /dev/null -w "%{http_code}" --connect-timeout 2 --max-time 5 "http://127.0.0.1:4000/health" 2>/dev/null || echo 000)"
echo "HTTP $API_CODE  body: ${API_BODY:-(empty)}"
if [[ "$API_CODE" == "200" ]]; then
  ok "API health on loopback :4000"
else
  bad "API health failed on 127.0.0.1:4000 — containers down or port not published"
  FAIL=1
fi
API_SLASH="$(curl -sS -o /dev/null -w "%{http_code}" --connect-timeout 2 --max-time 5 "http://127.0.0.1:4000/health/" 2>/dev/null || echo 000)"
note "/health/ → HTTP $API_SLASH (trailing slash should also work)"

# Confirm publish binding (0.0.0.0 vs 127.0.0.1 only)
if command -v docker >/dev/null 2>&1; then
  BIND="$(docker ps --format '{{.Names}} {{.Ports}}' 2>/dev/null | grep -E '4000' || true)"
  if [[ -n "$BIND" ]]; then
    echo "$BIND"
    if echo "$BIND" | grep -qE '127\.0\.0\.1:4000'; then
      bad "API published on 127.0.0.1 only — phone/Tailscale cannot reach :4000"
      FAIL=1
    elif echo "$BIND" | grep -qE '0\.0\.0\.0:4000|:4000->'; then
      ok "API port publish looks reachable (not loopback-only)"
    fi
  fi
fi

section "Web :3000/"
WEB_CODE="$(curl -sS -o /dev/null -w "%{http_code}" --connect-timeout 2 --max-time 5 "http://127.0.0.1:3000/" 2>/dev/null || echo 000)"
echo "HTTP $WEB_CODE"
if [[ "$WEB_CODE" =~ ^(200|301|302|304)$ ]]; then
  ok "Web responds on :3000"
else
  bad "Web failed on 127.0.0.1:3000"
  FAIL=1
fi

section "Ollama /api/tags"
OLLAMA_OK=0
for url in \
  "http://127.0.0.1:11434/api/tags" \
  "http://host.docker.internal:11434/api/tags"; do
  code="$(curl -sS -o /dev/null -w "%{http_code}" --connect-timeout 1 --max-time 3 "$url" 2>/dev/null || echo 000)"
  note "$url → HTTP $code"
  if [[ "$code" == "200" ]]; then
    OLLAMA_OK=1
    curl -sS --max-time 3 "$url" 2>/dev/null | head -c 240 || true
    echo ""
  fi
done
if command -v ollama >/dev/null 2>&1; then
  note "native binary: $(command -v ollama)"
  # Soft — never abort verify if daemon/container mismatch
  if command -v timeout >/dev/null 2>&1; then
    timeout 3 ollama list 2>/dev/null | head -n 20 || note "ollama list failed/timeout (OK if using docker-only or daemon down)"
  else
    ollama list 2>/dev/null | head -n 20 || note "ollama list failed (OK if daemon down)"
  fi
fi
if [[ "$OLLAMA_OK" -eq 1 ]]; then
  ok "Ollama HTTP reachable from host"
else
  note "Ollama not answering on host :11434 — team chat will fail until native Ollama is up (or compose ollama overlay)"
fi

# From inside API container (how the server actually talks to Ollama)
if command -v docker >/dev/null 2>&1; then
  API_CTR="$(COMPOSE_FILE= COMPOSE_PROFILES= docker compose "${COMPOSE_BASE[@]}" ps -q api 2>/dev/null | head -1 || true)"
  if [[ -n "$API_CTR" ]]; then
    note "probe from api container → host.docker.internal:11434"
    docker exec "$API_CTR" wget -qO- --timeout=3 "http://host.docker.internal:11434/api/tags" 2>/dev/null | head -c 160 \
      || docker exec "$API_CTR" curl -fsS --max-time 3 "http://host.docker.internal:11434/api/tags" 2>/dev/null | head -c 160 \
      || note "(container could not reach host Ollama)"
    echo ""
  fi
fi

section ".env — API URL / OAuth / Ollama"
TS_HTTPS=0
if [[ -f .env ]]; then
  grep -E '^(NEXT_PUBLIC_API_URL|PUBLIC_API_URL|PUBLIC_WEB_URL|OLLAMA_HOST|PERSONAI_OLLAMA_MODE|PERSONAI_TAILSCALE_HTTPS|COMPOSE_FILE|COMPOSE_PROFILES)=' .env 2>/dev/null || true
  echo ""
  for key in GOOGLE_OAUTH_CLIENT_ID GOOGLE_OAUTH_CLIENT_SECRET GOOGLE_OAUTH_REDIRECT_URI; do
    if grep -qE "^${key}=.+" .env 2>/dev/null; then
      # show set-without-value
      val="$(grep -E "^${key}=" .env | head -1 | cut -d= -f2- | tr -d '\r')"
      if [[ -n "$val" ]]; then
        ok "$key is set (len=${#val})"
      else
        note "$key present but empty"
      fi
    else
      note "$key not set (Drive link soft-gates when unset)"
    fi
  done
  NEXT_URL="$(grep -E '^NEXT_PUBLIC_API_URL=' .env 2>/dev/null | head -1 | cut -d= -f2- | tr -d '\r' || true)"
  WEB_URL_ENV="$(grep -E '^PUBLIC_WEB_URL=' .env 2>/dev/null | head -1 | cut -d= -f2- | tr -d '\r' || true)"
  if [[ "$NEXT_URL" == https://* ]] || [[ "$WEB_URL_ENV" == https://* ]] \
    || grep -qE '^PERSONAI_TAILSCALE_HTTPS=1' .env 2>/dev/null; then
    TS_HTTPS=1
  fi
  if [[ "$NEXT_URL" == *"localhost"* || "$NEXT_URL" == *"127.0.0.1"* ]]; then
    bad "NEXT_PUBLIC_API_URL points at localhost — phone browsers will Failed to fetch"
    note "Fix: ./scripts/vps-tailscale.sh $MAGICDNS   # or HTTPS=1 for PWA"
    FAIL=1
  elif [[ -n "$NEXT_URL" ]]; then
    ok "NEXT_PUBLIC_API_URL=$NEXT_URL"
  else
    note "NEXT_PUBLIC_API_URL unset — web falls back to hostname:4000 or Settings override"
  fi
  if [[ "$TS_HTTPS" -eq 1 ]]; then
    ok "HTTPS / PWA mode indicated in .env"
    if [[ "$NEXT_URL" != https://* ]]; then
      note "PERSONAI_TAILSCALE_HTTPS=1 but NEXT_PUBLIC_API_URL is not https — re-run HTTPS=1 ./scripts/vps-tailscale.sh"
    fi
  else
    note "HTTP bake-in — Chrome Install app unavailable (need secure context)"
    note "PWA path: HTTPS=1 ./scripts/vps-tailscale.sh $MAGICDNS"
  fi
else
  bad "No .env in $ROOT"
  FAIL=1
fi

section "Tailscale Serve (HTTPS / PWA)"
if command -v tailscale >/dev/null 2>&1; then
  SERVE_ST="$(sudo tailscale serve status 2>/dev/null || tailscale serve status 2>/dev/null || true)"
  if [[ -z "$SERVE_ST" ]] || grep -qiE 'no serve config' <<<"$SERVE_ST"; then
    if [[ "$TS_HTTPS" -eq 1 ]]; then
      bad "Serve status: No serve config — https://HOST and :8443 will fail"
      note "Recover: HTTPS=1 ./scripts/vps-tailscale.sh --serve-only $MAGICDNS"
      note "Temp Drive (not PWA): http://${MAGICDNS}:3000 + API http://${MAGICDNS}:4000"
      FAIL=1
    else
      note "Serve status: No serve config (expected for HTTP bake-in)"
    fi
  else
    echo "$SERVE_ST"
  fi
  if [[ "$TS_HTTPS" -eq 1 ]]; then
    HTTPS_WEB="https://${MAGICDNS}"
    HTTPS_API="https://${MAGICDNS}:8443"
    code_w="$(curl -sS -o /dev/null -w "%{http_code}" --connect-timeout 3 --max-time 10 "$HTTPS_WEB/" 2>/dev/null || echo 000)"
    code_a="$(curl -sS -o /dev/null -w "%{http_code}" --connect-timeout 3 --max-time 10 "$HTTPS_API/health" 2>/dev/null || echo 000)"
    note "$HTTPS_WEB/ → HTTP $code_w"
    note "$HTTPS_API/health → HTTP $code_a"
    if [[ "$code_w" =~ ^(200|301|302|304)$ ]]; then
      ok "HTTPS web via Serve"
    else
      bad "HTTPS web not reachable — enable Tailscale HTTPS certs + re-run HTTPS=1 ./scripts/vps-tailscale.sh"
      FAIL=1
    fi
    if [[ "$code_a" == "200" ]]; then
      ok "HTTPS API via Serve :8443"
    else
      bad "HTTPS API :8443/health failed"
      FAIL=1
    fi
  fi
else
  note "tailscale CLI not installed on this host"
fi

section "Auth / Failed-to-fetch checklist"
cat <<EOF
Chrome PWA: Install app requires HTTPS (secure context). HTTP *:3000 is browse-only.

Common causes when UI says "Failed to fetch" after login:

  1) Wrong API URL baked/stored
     - Web image bakes NEXT_PUBLIC_API_URL at build time
     - HTTP phone:  http://${MAGICDNS}:4000
     - HTTPS phone: https://${MAGICDNS}:8443
     - Settings → API Server → set that URL (no trailing slash) → Save & test

  2) Profile not unlocked (no Bearer)
     - Open /profiles/ → unlock with password
     - 401 AUTH_REQUIRED → team chat/outbox will look like failures

  3) API only on 127.0.0.1 or container down
     - docker compose ps  (api + web Up)
     - curl http://127.0.0.1:4000/health

  4) Mixed content (HTTPS page → HTTP API)
     - PUBLIC_WEB_URL https://… must pair with https://…:8443 API

Paste-ready checks FROM the VPS:
  curl -sS http://127.0.0.1:4000/health
  curl -sS -o /dev/null -w 'web %{http_code}\\n' http://127.0.0.1:3000/
  curl -sS http://${MAGICDNS}:4000/health
  curl -sS -o /dev/null -w 'web-ts %{http_code}\\n' http://${MAGICDNS}:3000/
  curl -sS -o /dev/null -w 'web-https %{http_code}\\n' https://${MAGICDNS}/
  curl -sS https://${MAGICDNS}:8443/health

Paste-ready FROM the phone:
  HTTPS (Install app):  https://${MAGICDNS}
  HTTPS API health:     https://${MAGICDNS}:8443/health
  HTTP browse-only:     http://${MAGICDNS}:3000

Authenticated check (after unlock — replace TOKEN):
  curl -sS -H "Authorization: Bearer TOKEN" -H "X-Profile-Id: PROFILE_ID" \\
    http://127.0.0.1:4000/team/specialists | head -c 200; echo

Recovery when \`tailscale serve status\` → No serve config:
  # A) Quick HTTP (Drive today, not Install app)
  curl -sS http://127.0.0.1:4000/health
  # phone: http://${MAGICDNS}:3000  → Settings API http://${MAGICDNS}:4000

  # B) Restore Serve (PWA)
  cd $ROOT
  HTTPS=1 ./scripts/vps-tailscale.sh --serve-only ${MAGICDNS}
  # or manual:
  sudo tailscale serve reset
  sudo tailscale serve --bg --yes --https=443 3000
  sudo tailscale serve --bg --yes --https=8443 4000
  curl -skS https://${MAGICDNS}:8443/health
  # full bake+rebuild if NEXT_PUBLIC_API_URL still wrong:
  # HTTPS=1 ./scripts/vps-tailscale.sh ${MAGICDNS}
  ./scripts/vps-verify.sh ${MAGICDNS}
  # phone HTTPS: https://${MAGICDNS} → API https://${MAGICDNS}:8443 → Product vault → OAuth → Link Drive
EOF

section "Result"
if [[ "$FAIL" -eq 0 ]]; then
  ok "Basic checks passed"
  exit 0
fi
bad "One or more checks failed (see above)"
exit 1
