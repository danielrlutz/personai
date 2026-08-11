#!/usr/bin/env bash
# Deploy PersonAI to a VPS over SSH (Tailscale) — UPDATE ONLY.
#
# Usage (from laptop / CI with SSH access):
#   ./scripts/deploy-vps.sh
#   NO_CACHE=1 ./scripts/deploy-vps.sh
#
# Configure via environment or gitignored .env.deploy.local (repo root):
#   DEPLOY_USER, DEPLOY_HOST, DEPLOY_PORT, SSH_PRIV_KEY, SSH_PPK (Windows PuTTY)
#
# Example (placeholders only — copy docs/DEPLOY.local.md.example):
#   DEPLOY_USER=deploy
#   DEPLOY_HOST=your-host.tailXXXX.ts.net
#   DEPLOY_PORT=45022
#   SSH_PRIV_KEY=~/.ssh/your-deploy-key
#   SSH_PPK=~/.ssh/your-key.ppk
#
# Prereqs: ssh/sshd on target, git clone at INSTALL_DIR, Docker + Tailscale on VPS.
#
# ---------------------------------------------------------------------------
# SAFETY POLICY (mandatory — never violate on VPS)
# ---------------------------------------------------------------------------
# Scope strictly to /etc/personaios OR /etc/soul-news (never other /etc paths).
#
# NEVER:
#   - rm -rf, docker system prune, docker volume rm, docker compose down -v
#   - deleting profiles, wiping volumes/data, or destructive "cleanup"
#   - git reset --hard (discards local VPS config and unpushed commits)
#   - touching paths outside the allowed install dirs
#
# PREFER:
#   - git fetch origin && git merge origin/main (or pull --ff-only)
#   - docker compose build + up via scripts/vps-tailscale.sh (no volume deletes)
#   - service restarts, Tailscale Serve recreate (HTTPS)
# ---------------------------------------------------------------------------
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
MAGICDNS="${MAGICDNS:-${DEPLOY_HOST}}"
NO_CACHE="${NO_CACHE:-0}"
SSH_PRIV_KEY="${SSH_PRIV_KEY:-${SSH_KEY:-${HOME}/.ssh/your-deploy-key}}"
SSH_PPK="${SSH_PPK:-}"
SSH_TARGET="${DEPLOY_USER}@${DEPLOY_HOST}"

# Hard guard: only known project install dirs (update-only scope).
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

echo "=== deploy-vps (update-only) → ${SSH_TARGET}:${DEPLOY_PORT} ${INSTALL_DIR} ==="
if [[ "$USE_PLINK" == 1 ]]; then
  echo "  transport: plink + ${SSH_PPK}"
fi

run_remote() {
  if [[ "$USE_PLINK" == 1 ]]; then
    plink -batch -P "$DEPLOY_PORT" -i "$SSH_PPK" "$SSH_TARGET" "$@"
  else
    ssh "${SSH_OPTS[@]}" "$SSH_TARGET" "$@"
  fi
}

read -r -d '' REMOTE_SCRIPT <<REMOTE_EOF || true
set -euo pipefail
cd '${INSTALL_DIR}'

echo '• git fetch origin'
git fetch origin

echo '• git merge origin/main (no reset --hard)'
if git merge --ff-only origin/main 2>/dev/null; then
  echo '  fast-forward OK'
elif git merge origin/main --no-edit; then
  echo '  merge OK'
else
  echo 'x merge failed — resolve on VPS manually; NOT using reset --hard' >&2
  git status -sb || true
  exit 1
fi

SHA=\$(git rev-parse --short HEAD)
echo "• origin/main @ \${SHA}"

if [[ '${INSTALL_DIR}' == '/etc/soul-news' ]]; then
  echo '• soul-news: docker compose up -d --build (update-only, no volume deletes)'
  docker compose build
  docker compose up -d
  curl -fsS 'http://127.0.0.1:8787/health' | head -c 200 || true
  echo
  echo "✓ soul-news updated \${SHA}"
  exit 0
fi

echo '• personaios: rebuild via vps-tailscale.sh (build + up, no down -v)'
if [[ '${NO_CACHE}' == '1' ]]; then
  NO_CACHE=1 HTTPS=1 ./scripts/vps-tailscale.sh '${MAGICDNS}'
else
  HTTPS=1 ./scripts/vps-tailscale.sh '${MAGICDNS}'
fi

echo "• verify"
curl -fsS 'http://127.0.0.1:4000/health' | head -c 200 || true
echo
curl -fsS -o /dev/null -w 'web loopback %{http_code}\n' 'http://127.0.0.1:3000/' || true
curl -fsS -o /dev/null -w 'web https %{http_code}\n' 'https://${MAGICDNS}/' || true
curl -fsS 'https://${MAGICDNS}:8443/health' | head -c 200 || true
echo

echo '• structured logs'
mkdir -p logs/info logs/warning logs/error
if [[ -d logs/error ]]; then
  latest="\$(ls -1t logs/error/*.log 2>/dev/null | head -1 || true)"
  if [[ -n "\$latest" ]]; then
    echo "  error log: \$latest (last 5 lines)"
    tail -n 5 "\$latest" 2>/dev/null || true
  else
    echo "  error log: (none yet — OK on fresh deploy)"
  fi
else
  echo '  ! logs/error missing'
fi

echo "✓ deployed \${SHA} (update-only, no destructive ops)"
REMOTE_EOF

if [[ "$USE_PLINK" == 1 ]]; then
  printf '%s\n' "$REMOTE_SCRIPT" | plink -batch -P "$DEPLOY_PORT" -i "$SSH_PPK" "$SSH_TARGET" bash -s
else
  printf '%s\n' "$REMOTE_SCRIPT" | ssh "${SSH_OPTS[@]}" "$SSH_TARGET" bash -s
fi

echo "✓ Remote deploy finished"
echo "  Web: https://${MAGICDNS}/"
echo "  API: https://${MAGICDNS}:8443/health"