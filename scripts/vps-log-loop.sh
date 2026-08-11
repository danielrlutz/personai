#!/usr/bin/env bash
# Periodic VPS log monitor — run from Cursor /loop or balcony cron.
#
# Polls structured logs over SSH and prints only NEW error lines since last run.
# State file: .vps-log-loop.state (gitignored) in repo root.
#
# Usage:
#   ./scripts/vps-log-loop.sh              # one poll
#   INTERVAL=300 ./scripts/vps-log-loop.sh # loop every 5 min (Ctrl+C to stop)
#   LINES=100 ./scripts/vps-log-loop.sh
#
# Configure via .env.deploy.local (same as deploy-vps.sh / vps-check-logs.sh).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
ENV_LOCAL="${ROOT}/.env.deploy.local"
if [[ -f "$ENV_LOCAL" ]]; then
  # shellcheck disable=SC1090
  set -a
  source "$ENV_LOCAL"
  set +a
fi

DEPLOY_USER="${DEPLOY_USER:-deploy}"
DEPLOY_HOST="${DEPLOY_HOST:-your-host.tailXXXX.ts.net}"
DEPLOY_PORT="${DEPLOY_PORT:-22}"
INSTALL_DIR="${INSTALL_DIR:-/etc/personaios}"
SSH_PRIV_KEY="${SSH_PRIV_KEY:-${SSH_KEY:-${HOME}/.ssh/your-deploy-key}}"
SSH_PPK="${SSH_PPK:-}"
SSH_TARGET="${DEPLOY_USER}@${DEPLOY_HOST}"
LINES="${LINES:-50}"
INTERVAL="${INTERVAL:-0}"
STATE_FILE="${STATE_FILE:-${ROOT}/.vps-log-loop.state}"

case "$INSTALL_DIR" in
  /etc/personaios | /etc/soul-news) ;;
  *)
    echo "x Refusing INSTALL_DIR=${INSTALL_DIR} — must be /etc/personaios or /etc/soul-news" >&2
    exit 1
    ;;
esac

USE_PLINK=0
if [[ -n "$SSH_PPK" ]] && [[ -f "$SSH_PPK" ]] && command -v plink >/dev/null 2>&1; then
  USE_PLINK=1
fi

SSH_OPTS=(-p "$DEPLOY_PORT" -o StrictHostKeyChecking=accept-new -o ConnectTimeout=15)
if [[ "$USE_PLINK" == 0 ]] && [[ -f "$SSH_PRIV_KEY" ]]; then
  SSH_OPTS+=(-i "$SSH_PRIV_KEY")
elif [[ "$USE_PLINK" == 0 ]]; then
  echo "! SSH key not found at ${SSH_PRIV_KEY} — using ssh-agent / default keys" >&2
fi

run_remote() {
  if [[ "$USE_PLINK" == 1 ]]; then
    plink -batch -P "$DEPLOY_PORT" -i "$SSH_PPK" "$SSH_TARGET" "$@"
  else
    ssh "${SSH_OPTS[@]}" "$SSH_TARGET" "$@"
  fi
}

poll_once() {
  local ts
  ts="$(date -u +"%Y-%m-%dT%H:%M:%SZ")"
  echo "=== vps-log-loop @ $ts → ${SSH_TARGET}:${DEPLOY_PORT} ==="

  local remote_out
  remote_out="$(run_remote bash -s <<REMOTE_EOF
set -euo pipefail
LOG_ROOT='${INSTALL_DIR}/logs/error'
if [[ ! -d "\$LOG_ROOT" ]]; then
  echo "STATE:missing"
  exit 0
fi
latest="\$(ls -1t "\$LOG_ROOT"/*.log 2>/dev/null | head -1 || true)"
if [[ -z "\$latest" ]]; then
  echo "STATE:empty"
  exit 0
fi
lines="\$(wc -l < "\$latest" 2>/dev/null | tr -d ' ' || echo 0)"
echo "STATE:file=\$latest lines=\$lines"
tail -n ${LINES} "\$latest" 2>/dev/null || true
REMOTE_EOF
)" || {
    echo "x SSH poll failed" >&2
    return 1
  }

  local state_line file line_count
  state_line="$(echo "$remote_out" | grep '^STATE:' | head -1 || true)"
  file=""
  line_count=0
  case "$state_line" in
    STATE:missing)
      echo "! No error log dir on VPS — deploy with logs volume first"
      return 0
      ;;
    STATE:empty)
      echo "• No error .log files yet (healthy or fresh deploy)"
      return 0
      ;;
    STATE:file=*)
      file="${state_line#STATE:file=}"
      file="${file%% lines=*}"
      line_count="${state_line#*lines=}"
      ;;
  esac

  local body prev_count new_count
  body="$(echo "$remote_out" | grep -v '^STATE:' || true)"
  prev_count=0
  if [[ -f "$STATE_FILE" ]]; then
    # shellcheck disable=SC1090
    source "$STATE_FILE" 2>/dev/null || true
    prev_count="${LAST_LINE_COUNT:-0}"
  fi

  new_count="$line_count"
  if [[ "$file" != "${LAST_FILE:-}" ]]; then
    prev_count=0
  fi

  if [[ "$new_count" -gt "$prev_count" ]]; then
    local delta=$((new_count - prev_count))
    echo "• NEW errors: +$delta in $file (total $new_count lines)"
    echo "$body" | tail -n "$delta"
  else
    echo "• No new error lines ($file, $new_count lines)"
  fi

  {
    echo "LAST_FILE='$file'"
    echo "LAST_LINE_COUNT=$new_count"
    echo "LAST_CHECK='$ts'"
  } >"$STATE_FILE"
}

if [[ "$INTERVAL" -gt 0 ]]; then
  echo "Looping every ${INTERVAL}s (state: $STATE_FILE)"
  while true; do
    poll_once || true
    sleep "$INTERVAL"
  done
else
  poll_once
fi
