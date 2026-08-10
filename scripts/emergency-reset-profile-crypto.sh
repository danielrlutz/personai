#!/usr/bin/env bash
# Emergency: clear unlock keys for ONE profile and quarantine its sealed DB.
#
# Use when profiles.json lost passwordHash/kdfSalt/wrappedDek (or the password
# is forgotten) but the UUID profile dir still exists. Keeps:
#   - profile id + display name in profiles.json
#   - uploads/, archive/, memory/, exports/ file trees
# Quarantines (does NOT delete):
#   - personai.db.enc / personai.db (+ wal/shm)
# After this, open /profiles/ → Set password & continue (fresh empty SQLite).
# The quarantined sealed DB is unreadable without the old wrappedDek.
#
# Usage (ralph@debi9):
#   cd /etc/personaios
#   docker compose stop api
#   ./scripts/emergency-reset-profile-crypto.sh 21deba4b-391d-4467-a7ea-4bd3fce304d0
#   docker compose start api
#   # phone: /profiles/ → Set password & continue
#
# Optional: DATA_DIR=/path/to/data ./scripts/emergency-reset-profile-crypto.sh <uuid>
set -euo pipefail

PROFILE_ID="${1:-}"
if [[ -z "$PROFILE_ID" ]]; then
  echo "Usage: $0 <profile-uuid>" >&2
  exit 1
fi
if [[ ! "$PROFILE_ID" =~ ^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$ ]]; then
  echo "x Not a UUID: $PROFILE_ID" >&2
  exit 1
fi

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
    if [[ -f "$cand/docker-compose.yml" ]]; then
      ROOT="$cand"
      break
    fi
  done
fi
ROOT="${ROOT:-$(pwd)}"

if [[ -n "${DATA_DIR:-}" ]]; then
  DATA="$DATA_DIR"
elif [[ -f "$ROOT/.env" ]] && grep -qE '^DATA_DIR=' "$ROOT/.env"; then
  # shellcheck disable=SC1091
  DATA="$(grep -E '^DATA_DIR=' "$ROOT/.env" | head -1 | cut -d= -f2- | tr -d '"' | tr -d "'")"
else
  DATA="$ROOT/data"
fi

REGISTRY="$DATA/profiles.json"
PDIR="$DATA/profiles/$PROFILE_ID"
STAMP="$(date +%Y%m%d%H%M%S)"

echo "=== PersonAI emergency crypto reset (one profile) ==="
echo "dir=$ROOT"
echo "DATA_DIR=$DATA"
echo "profile=$PROFILE_ID"

if [[ ! -f "$REGISTRY" ]]; then
  echo "x Missing $REGISTRY" >&2
  exit 1
fi
if [[ ! -d "$PDIR" ]]; then
  echo "x Missing profile dir $PDIR" >&2
  exit 1
fi

if command -v docker >/dev/null 2>&1; then
  if docker compose -f "$ROOT/docker-compose.yml" ps --status running api 2>/dev/null | grep -q api; then
    echo "! API container appears running — stop it first:"
    echo "  cd $ROOT && docker compose stop api"
    exit 1
  fi
fi

cp -a "$REGISTRY" "$REGISTRY.bak.crypto-reset.$STAMP"
echo "› backed up profiles.json → profiles.json.bak.crypto-reset.$STAMP"

for f in personai.db personai.db.enc personai.db-wal personai.db-shm personai.db-journal; do
  if [[ -e "$PDIR/$f" ]]; then
    dest="$PDIR/${f}.quarantine.$STAMP"
    mv "$PDIR/$f" "$dest"
    echo "› quarantined $f → $(basename "$dest")"
  fi
done

python3 - "$REGISTRY" "$PROFILE_ID" <<'PY'
import json, sys
path, pid = sys.argv[1], sys.argv[2]
with open(path, "r", encoding="utf-8") as fh:
    reg = json.load(fh)
profiles = reg.get("profiles") or []
found = False
for p in profiles:
    if p.get("id") == pid:
        found = True
        for key in ("passwordHash", "kdfSalt", "wrappedDek"):
            p.pop(key, None)
        p["dbEncrypted"] = False
        break
if not found:
    print(f"x Profile {pid} not listed in profiles.json", file=sys.stderr)
    sys.exit(1)
tmp = path + ".tmp"
with open(tmp, "w", encoding="utf-8") as fh:
    json.dump(reg, fh, indent=2)
    fh.write("\n")
import os
os.replace(tmp, path)
print(f"› cleared unlock keys for {pid} (name kept)")
PY

echo ""
echo "Done. Next:"
echo "  cd $ROOT && docker compose start api   # or: docker compose up -d api"
echo "  Phone → /profiles/ → “${PROFILE_ID:0:8}…” → Set password & continue"
echo "  Uploads/archive files under profiles/$PROFILE_ID/ were kept."
echo "  Quarantined DB is NOT auto-deleted — remove *.quarantine.* only when sure."
