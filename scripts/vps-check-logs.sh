#!/usr/bin/env bash
# Read-only VPS log tail — recent errors/warnings from PersonAI log dirs.
#
# Usage (from laptop with SSH to VPS):
#   ./scripts/vps-check-logs.sh
#   LINES=100 ./scripts/vps-check-logs.sh
#
# Configure via environment or gitignored .env.deploy.local (repo root):
#   DEPLOY_USER, DEPLOY_HOST, DEPLOY_PORT, SSH_PRIV_KEY, SSH_PPK (Windows PuTTY)
#   INSTALL_DIR (default /etc/personaios)
#
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

echo "=== vps-check-logs (read-only) → ${SSH_TARGET}:${DEPLOY_PORT} ${INSTALL_DIR} ==="
if [[ "$USE_PLINK" == 1 ]]; then
  echo "  transport: plink + ${SSH_PPK}"
fi

read -r -d '' REMOTE_SCRIPT <<REMOTE_EOF || true
set -euo pipefail
cd '${INSTALL_DIR}'
LOG_ROOT="${INSTALL_DIR}/logs"
if [[ ! -d "\$LOG_ROOT" ]]; then
  echo "! No logs dir at \$LOG_ROOT — create via docker compose after deploy"
  ls -la . 2>/dev/null | head -20 || true
  exit 0
fi

echo "• log tree (top level)"
find "\$LOG_ROOT" -maxdepth 2 -type f -name '*.log' 2>/dev/null | sort | tail -20 || true

for level in error warning info; do
  dir="\$LOG_ROOT/\$level"
  echo ""
  echo "=== \$level (last ${LINES} lines) ==="
  if [[ ! -d "\$dir" ]]; then
    echo "(missing \$dir)"
    continue
  fi
  latest="\$(ls -1t "\$dir"/*.log 2>/dev/null | head -1 || true)"
  if [[ -z "\$latest" ]]; then
    echo "(no .log files)"
    continue
  fi
  echo "file: \$latest"
  tail -n ${LINES} "\$latest" 2>/dev/null || true
done
REMOTE_EOF

if [[ "$USE_PLINK" == 1 ]]; then
  printf '%s\n' "$REMOTE_SCRIPT" | plink -batch -P "$DEPLOY_PORT" -i "$SSH_PPK" "$SSH_TARGET" bash -s
else
  printf '%s\n' "$REMOTE_SCRIPT" | ssh "${SSH_OPTS[@]}" "$SSH_TARGET" bash -s
fi

echo "✓ vps-check-logs finished (read-only)"
