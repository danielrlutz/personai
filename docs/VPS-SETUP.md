# PersonAI OS — Complete VPS Setup Guide

Exhaustive guide for a **Debian/Ubuntu VPS** (e.g. `your-host`) with **Docker**, **native Ollama on the host** (`:11434`), and **phone access via Tailscale MagicDNS**.

Recommended install directory: **`/etc/personaios`** (any path works; scripts assume you `cd` there).

---

## 1. Prerequisites

| Requirement | Why | How to check |
|-------------|-----|--------------|
| **Docker + Compose plugin** | API + web run in containers | `docker compose version` |
| **Git** | Clone / update repo | `git --version` |
| **Native Ollama on host `:11434`** | Default VPS path — **no bundled Docker Ollama** | `curl -sS http://127.0.0.1:11434/api/tags` |
| **Tailscale on VPS + phone** | MagicDNS phone access | `tailscale status` |
| **Enough RAM/CPU for models** | OCR + reasoning models are heavy | 8 GB+ RAM recommended for `deepseek-r1:8b` on CPU |

### Install Docker (if missing)

```bash
curl -fsSL https://get.docker.com | sh
sudo usermod -aG docker "$USER"   # re-login after this
```

### Install native Ollama (recommended VPS path)

```bash
curl -fsSL https://ollama.com/install.sh | sh
sudo systemctl enable --now ollama
curl -sS http://127.0.0.1:11434/api/tags   # should return JSON (maybe empty models list)
```

Pull models (after PersonAI is up, or now):

```bash
ollama pull maternion/LightOnOCR-2
ollama pull deepseek-r1:8b
ollama pull qwen2.5-coder:7b   # optional — Forge; falls back to reasoning model
```

### Clone repo to `/etc/personaios`

```bash
sudo mkdir -p /etc/personaios
sudo chown "$USER:$USER" /etc/personaios
git clone --depth 1 https://github.com/YOUR_ORG/personai-os.git /etc/personaios
cd /etc/personaios
```

---

## 2. Is `.env` required?

**Short answer:** Docker Compose *can* start without `.env` (defaults in `docker-compose.yml`), but for a real VPS + phone setup you **should treat `.env` as required**.

| Scenario | Without `.env` | With minimal `.env` | With full `.env` (install.sh) |
|----------|----------------|---------------------|-------------------------------|
| `docker compose up` on VPS | Uses defaults: `OLLAMA_HOST=host.docker.internal:11434`, `NEXT_PUBLIC_API_URL=http://localhost:4000` baked into web | Phone **will fail** unless you run `vps-tailscale.sh` or set API URL in Settings | Correct Tailscale URLs, data dir, tier, install metadata |
| Host Ollama | Works if native Ollama listens on `:11434` | Works | Works |
| Phone / Tailscale | **Broken** — web image calls `localhost:4000` | Fix via `vps-tailscale.sh` or Settings override | Works if `NEXT_PUBLIC_API_URL` matches MagicDNS |
| Google Drive OAuth | N/A | Link soft-gated until OAuth env set | Set `GOOGLE_OAUTH_*` + `PUBLIC_WEB_URL` |
| Auth / passwords | N/A — **no auth secrets in `.env`** | Set/unlock passwords in UI (`/profiles/`) | Same |

**`install.sh` always creates or merges `.env`.** If you skip it, create at least:

```bash
# Minimal VPS + host Ollama + Tailscale (replace hostname)
cat > .env <<'EOF'
DATA_DIR=/etc/personaios/data
PORT=4000
OLLAMA_HOST=http://host.docker.internal:11434
OLLAMA_PUBLIC_HOST=http://127.0.0.1:11434
NEXT_PUBLIC_API_URL=http://your-host.tailXXXX.ts.net:4000
PUBLIC_API_URL=http://your-host.tailXXXX.ts.net:4000
PUBLIC_WEB_URL=http://your-host.tailXXXX.ts.net:3000
LICENSE_TIER=pro
COMPOSE_PROFILES=
PERSONAI_OLLAMA_MODE=existing-native
EOF
```

**Never set** `COMPOSE_FILE=docker-compose.ollama.yml` or `COMPOSE_PROFILES=bundled-ollama` when host Ollama already uses `:11434` — that causes `bind: address already in use`.

---

## 3. Step-by-step first install

### Option A — One-liner (recommended)

```bash
curl -fsSL https://raw.githubusercontent.com/YOUR_ORG/personai-os/main/install.sh | bash
```

When prompted:

1. **Ollama:** choose **1) Use existing native Ollama** (if `ollama` is on the host).
2. **Install dir:** `/etc/personaios` (or accept default `~/personai`).
3. **Data dir:** `/etc/personaios/data` (persistent — never wiped by updater).
4. **Ports:** web `3000`, API `4000` (defaults).
5. **Tier:** `pro` (OCR + team chat).
6. **Domain/TLS:** leave blank for Tailscale-only (use `HTTPS=1 ./scripts/vps-tailscale.sh` later for Chrome PWA install); or set a public domain + Caddy HTTPS.
7. **Pull models:** yes (if Ollama is up).
8. **Start stack:** yes.

Non-interactive (typical VPS with host Ollama):

```bash
curl -fsSL https://raw.githubusercontent.com/YOUR_ORG/personai-os/main/install.sh | bash -s -- \
  --yes \
  --dir /etc/personaios \
  --ollama=existing-native \
  --tier=pro \
  --pull-models=yes \
  --start=yes
```

Then configure Tailscale phone access:

```bash
cd /etc/personaios
./scripts/vps-tailscale.sh your-host.tailXXXX.ts.net
```

### Option B — Git clone + install.sh

```bash
sudo mkdir -p /etc/personaios && sudo chown "$USER:$USER" /etc/personaios
git clone https://github.com/YOUR_ORG/personai-os.git /etc/personaios
cd /etc/personaios
./install.sh
```

Or wizard entry point:

```bash
./setup.sh --mode=vps
# delegates to install.sh
```

### What install.sh writes

- `.env` — ports, Ollama wiring, `NEXT_PUBLIC_API_URL`, `DATA_DIR`, tier
- `docker-compose.override.yml` — published ports, `extra_hosts`, build args
- `.personai-install` — metadata (commit, Ollama mode)
- Optional `Caddyfile` — if domain + TLS selected

For **host Ollama**, install.sh sets:

- `OLLAMA_HOST=http://host.docker.internal:11434` (what the **API container** sees)
- `OLLAMA_PUBLIC_HOST=http://127.0.0.1:11434` (human-readable host URL)
- `COMPOSE_PROFILES=` (empty — **critical**)

---

## 4. Step-by-step update

Re-run the **same** install command — it detects existing install and enters **update mode** (preserves `data/`):

```bash
cd /etc/personaios
curl -fsSL https://raw.githubusercontent.com/YOUR_ORG/personai-os/main/install.sh | bash
```

Or:

```bash
cd /etc/personaios
git fetch origin
git merge --ff-only origin/main   # or: git reset --hard origin/main
./install.sh --yes --update
```

**After every code pull that touches web/API**, rebuild for Tailscale:

```bash
cd /etc/personaios
./scripts/vps-tailscale.sh your-host.tailXXXX.ts.net
# force clean rebuild if UI still wrong:
# NO_CACHE=1 ./scripts/vps-tailscale.sh your-host.tailXXXX.ts.net
```

Manual rebuild (without Tailscale bake-in):

```bash
cd /etc/personaios
COMPOSE_PROFILES= docker compose up -d --build --remove-orphans
# or:
./scripts/vps-up.sh
```

Update checklist:

1. `git pull` / `install.sh --update`
2. Confirm `.env` has empty `COMPOSE_PROFILES` and no `COMPOSE_FILE=`
3. `./scripts/vps-tailscale.sh <your-magicdns-fqdn>`
4. `./scripts/vps-verify.sh <your-magicdns-fqdn>`
5. On phone: clear site data, unlock profile, verify Settings API URL

---

## 5. Complete `.env` template (every variable explained)

Copy from `.env.example` in the repo. Key variables:

```bash
# --- Paths & ports ---
DATA_DIR=/etc/personaios/data
# Host port mapped to API container :4000 (install.sh writes PORT)
PORT=4000
# Web host port (install.sh / override only — not read by base compose)
PERSONAI_WEB_PORT=3000
# Prisma SQLite path inside container (install.sh sets from DATA_DIR)
DATABASE_URL=file:/etc/personaios/data/profiles/bootstrap/personai.db

# --- Ollama (API container perspective) ---
# Host native Ollama (DEFAULT for VPS):
OLLAMA_HOST=http://host.docker.internal:11434
# Browser/host perspective (optional metadata)
OLLAMA_PUBLIC_HOST=http://127.0.0.1:11434
PERSONAI_OLLAMA_MODE=existing-native
# Bundled Docker Ollama ONLY if using docker-compose.ollama.yml:
# OLLAMA_HOST=http://ollama:11434
# PERSONAI_OLLAMA_MODE=new-docker

OLLAMA_VISION_MODEL=maternion/LightOnOCR-2
OLLAMA_REASONING_MODEL=deepseek-r1:8b
OLLAMA_CODER_MODEL=qwen2.5-coder:7b
# OLLAMA_VISION_TIMEOUT_MS=180000
# OLLAMA_CHAT_TIMEOUT_MS=180000

# --- Compose hygiene (CRITICAL on VPS) ---
COMPOSE_PROFILES=
# Do NOT set COMPOSE_FILE= unless you intentionally want bundled Ollama every time

# --- Web → API URL (baked into web image at BUILD time) ---
# No trailing slash. Use full MagicDNS FQDN for Android.
# HTTP (browse-only; Chrome will NOT Install app / PWA):
NEXT_PUBLIC_API_URL=http://your-host.tailXXXX.ts.net:4000
PUBLIC_API_URL=http://your-host.tailXXXX.ts.net:4000
PUBLIC_WEB_URL=http://your-host.tailXXXX.ts.net:3000
# HTTPS via Tailscale Serve (PWA-installable) — set by:
#   HTTPS=1 ./scripts/vps-tailscale.sh your-host.tailXXXX.ts.net
# NEXT_PUBLIC_API_URL=https://your-host.tailXXXX.ts.net:8443
# PUBLIC_API_URL=https://your-host.tailXXXX.ts.net:8443
# PUBLIC_WEB_URL=https://your-host.tailXXXX.ts.net
# PERSONAI_TAILSCALE_HTTPS=1

LICENSE_TIER=pro

# --- Install.sh / Caddy metadata (optional) ---
PERSONAI_DOMAIN=
PERSONAI_TLS=no
# PERSONAI_USE_PROD=1   # force docker-compose.prod.yml in vps-* scripts

# --- Google Drive archive (all optional) ---
# Prefer OAuth (Settings → Link Google Drive). After .env change:
#   COMPOSE_PROFILES= docker compose up -d --force-recreate api
# GOOGLE_DRIVE_ENABLED=true
# OAuth (preferred):
# GOOGLE_OAUTH_CLIENT_ID=
# GOOGLE_OAUTH_CLIENT_SECRET=
# HTTP redirect:
# GOOGLE_OAUTH_REDIRECT_URI=http://your-host.tailXXXX.ts.net:4000/archive/drive/oauth/callback
# HTTPS / Tailscale Serve redirect (must match Google Cloud authorized URI):
# GOOGLE_OAUTH_REDIRECT_URI=https://your-host.tailXXXX.ts.net:8443/archive/drive/oauth/callback
# PUBLIC_WEB_URL must match the web UI (post-link redirect).
# Service account (headless) — Docker only mounts ./data → /app/data:
#   put JSON under data/ and set path inside the container, or use INLINE:
# GOOGLE_SERVICE_ACCOUNT_JSON=/app/data/secrets/google-service-account.json
# GOOGLE_SERVICE_ACCOUNT_JSON_INLINE={"type":"service_account",...}
# Share Drive folders with the SA client_email (Editor), then:
# GOOGLE_DRIVE_ROOT_FOLDER_ID=   # preferred on Docker (passed into api)
# Note: GOOGLE_DRIVE_FOLDER_* / GOOGLE_DRIVE_FOLDERS are read by the API process
# but are not currently listed in docker-compose.yml environment — use ROOT_FOLDER_ID on VPS.
# Legacy env refresh token (Settings stores per-profile instead):
# GOOGLE_OAUTH_REFRESH_TOKEN=

# --- Auth / encryption ---
# NO plaintext passwords in .env. Per-profile passwords are set in the UI.
# Sessions live in data/sessions.json on disk.
# Integration tests only:
# PERSONAI_TEST_PASSWORD=...

# --- Ingest tuning (optional) ---
# INGEST_PDF_DPI=140
# INGEST_MAX_PAGES=40
```

**Auth note (since commit `91de559`):** All API routes except health, profile list, login, and setup require `Authorization: Bearer <session>`. There are **no** `PERSONAI_*` auth env vars — unlock with your profile password on `/profiles/`.

---

## 6. Phone access (Tailscale MagicDNS)

Your VPS hostname example: **`your-host.tailXXXX.ts.net`**

### Chrome PWA installability (secure context)

Chrome treats a site as **installable** only in a [**secure context**](https://developer.mozilla.org/en-US/docs/Web/Security/Secure_Contexts):

| Origin | Install app (real PWA)? |
|--------|-------------------------|
| `https://…` (valid TLS) | Yes — if manifest + service worker criteria are met |
| `http://localhost` / `http://127.0.0.1` | Yes (dev exception) |
| `http://your-host.tailXXXX.ts.net:3000` | **No** — WireGuard ≠ browser HTTPS |

**Add to Home screen / shortcut on HTTP is not a PWA** (no proper SW scope / installability). Use Tailscale Serve HTTPS below.

### Recommended: HTTPS via Tailscale Serve (PWA)

Minimal path — no public DNS, no Caddy, no mkcert. Tailscale provisions `*.ts.net` certificates.

| Surface | URL |
|---------|-----|
| Phone browser / **Install app** | `https://your-host.tailXXXX.ts.net` |
| API (Settings / baked URL) | `https://your-host.tailXXXX.ts.net:8443` |
| API health | `https://your-host.tailXXXX.ts.net:8443/health` |
| OAuth redirect URI | `https://your-host.tailXXXX.ts.net:8443/archive/drive/oauth/callback` |

`:8443` avoids clashing with Docker publishing `0.0.0.0:4000`. Loopback HTTP `:3000` / `:4000` stay up for host curls.

#### One-liner (deploy@your-host)

```bash
# 1) Once per tailnet: https://login.tailscale.com/admin/dns → Enable HTTPS
cd /etc/personaios
git fetch && git reset --hard origin/main
./scripts/vps-verify.sh your-host.tailXXXX.ts.net
HTTPS=1 ./scripts/vps-tailscale.sh your-host.tailXXXX.ts.net
# equivalent: ./scripts/vps-tailscale.sh --https your-host.tailXXXX.ts.net
tailscale serve status
```

#### Recovery: `tailscale serve status` → **No serve config**

Serve was never set or was cleared. Loopback `:3000`/`:4000` can be healthy while `https://HOST` and `:8443` fail with “Could not connect”.

**A) Quick path — HTTP for Drive today (not Install app):**

```text
Phone → http://your-host.tailXXXX.ts.net:3000
Settings → API Server → http://your-host.tailXXXX.ts.net:4000 → Save & test
```

**B) Full path — restore Serve for PWA (no rebuild if stack is up):**

```bash
cd /etc/personaios
HTTPS=1 ./scripts/vps-tailscale.sh --serve-only your-host.tailXXXX.ts.net
# manual:
sudo tailscale serve reset
sudo tailscale serve --bg --yes --https=443 3000
sudo tailscale serve --bg --yes --https=8443 4000
sudo tailscale serve status
curl -skS https://your-host.tailXXXX.ts.net:8443/health
```

If the web image still bakes a stale API URL, run the full bake+rebuild (`HTTPS=1 ./scripts/vps-tailscale.sh HOST`).

Then bake HTTPS URLs + recreate (script does this when `HTTPS=1`):

```bash
# .env (no trailing slash on API URL)
NEXT_PUBLIC_API_URL=https://your-host.tailXXXX.ts.net:8443
PUBLIC_API_URL=https://your-host.tailXXXX.ts.net:8443
PUBLIC_WEB_URL=https://your-host.tailXXXX.ts.net
GOOGLE_OAUTH_REDIRECT_URI=https://your-host.tailXXXX.ts.net:8443/archive/drive/oauth/callback
COMPOSE_PROFILES= docker compose build web api && COMPOSE_PROFILES= docker compose up -d
```

#### On the phone (HTTPS / Install app)

1. Phone on the same Tailscale tailnet as `your-host`.
2. Chrome → open **`https://your-host.tailXXXX.ts.net`** (no `:3000`).
3. Delete site data for any old **`http://…:3000`** origin; uninstall bogus shortcuts.
4. Unlock on `/profiles/`.
5. Settings → API Server → `https://your-host.tailXXXX.ts.net:8443` if needed → Save & test.
6. Chrome menu → **Install app** (or Install PersonAI). Homescreeen shortcut from HTTP does not count.

If OAuth is configured, add the **HTTPS** redirect URI in Google Cloud (exact match).

### Browse-only HTTP (not installable)

| Surface | URL |
|---------|-----|
| Phone browser | `http://your-host.tailXXXX.ts.net:3000` |
| API | `http://your-host.tailXXXX.ts.net:4000` |

```bash
./scripts/vps-tailscale.sh your-host.tailXXXX.ts.net   # HTTP bake-in
```

**Android:** always use the **full** `*.ts.net` FQDN — short names like `your-host` often fail.

**Security:** Tailscale encrypts transit; browsers still require HTTPS for PWA APIs. PersonAI still requires password + session.

---

## 7. Verify setup complete

### Quick checks

```bash
cd /etc/personaios
./scripts/vps-verify.sh your-host.tailXXXX.ts.net
```

### Manual success criteria

```bash
# Containers up (api + web; NO ollama in compose project)
COMPOSE_PROFILES= docker compose ps
# Expect: api Up, web Up, ports 0.0.0.0:4000->4000 and 0.0.0.0:3000->80
# If api shows only "4000/tcp" (no host mapping), Serve :8443 cannot reach the API.
# Fix: git pull + recreate api (docker-compose.prod.yml always publishes 4000:4000).

# API health
curl -sS http://127.0.0.1:4000/health
curl -sS http://127.0.0.1:4000/health/

# Web
curl -sS -o /dev/null -w 'web %{http_code}\n' http://127.0.0.1:3000/

# Ollama on host
curl -sS http://127.0.0.1:11434/api/tags | head -c 200

# Via Tailscale hostname (from VPS)
curl -sS http://your-host.tailXXXX.ts.net:4000/health
curl -sS -o /dev/null -w 'web-ts %{http_code}\n' http://your-host.tailXXXX.ts.net:3000/
```

### From the phone browser

- `http://your-host.tailXXXX.ts.net:3000` — PersonAI UI loads
- `http://your-host.tailXXXX.ts.net:4000/health` — JSON health response

### What success looks like

- `vps-verify.sh` exits 0
- `vps-tailscale.sh` prints `✓ Tailscale stack ready`
- Profile unlock works; Team chat responds (not "Failed to fetch")
- No `ollama` service in `docker compose config --services`
- Web redirect `/dashboard` → relative `/dashboard/` (not `:80` or `localhost`)

---

## 8. Troubleshooting

### "Failed to fetch" in UI

| Cause | Fix |
|-------|-----|
| Wrong baked `NEXT_PUBLIC_API_URL` (`localhost`) | `./scripts/vps-tailscale.sh your-host.tailXXXX.ts.net` |
| Stale phone cache / Service Worker | Delete site data; reinstall PWA |
| Profile not unlocked (401) | `/profiles/` → enter password |
| API down or loopback-only bind | `docker compose ps`; API must publish `0.0.0.0:4000` |
| API crash-loop (`curl` → connection reset; container “Up Less than a second”) | See below — usually missing `--experimental-sqlite` in API image |
| Settings override wrong | Settings → API URL without trailing slash |

Run: `./scripts/vps-verify.sh your-host.tailXXXX.ts.net`

### API `:4000` connection reset / crash-loop

Symptom: port published (`0.0.0.0:4000->4000`) but `curl http://127.0.0.1:4000/health` → **Recv failure: Connection reset by peer**. Container restarts every second.

Cause (post drive-knowledge): `node:sqlite` needs `--experimental-sqlite`. If `Dockerfile.api` CMD is bare `node dist/index.js`, the process dies before listen.

```bash
cd /etc/personaios
docker compose logs api --tail 100
# Expect: ERR_UNKNOWN_BUILTIN_MODULE / node:sqlite  OR exit before "Server listening"

git pull
# rebuild api with NODE_OPTIONS / --experimental-sqlite CMD
docker compose build --no-cache api && docker compose up -d --force-recreate api
# wait for: Server listening on http://0.0.0.0:4000
sleep 3; curl -v http://127.0.0.1:4000/health
docker inspect personaios-api-1 --format '{{.State.Status}} {{.State.ExitCode}} {{.RestartCount}}'
```

Profile `YOUR-PROFILE-UUID` / `profiles.json` are untouched by this rebuild (data volume / `DATA_DIR` bind).

### Install stops silently at "Scanning for Ollama"

Fixed in current `install.sh` — scan is non-fatal. If an old installer hangs, update:

```bash
cd /etc/personaios && git pull && ./install.sh --yes --update
```

### Port `:11434` already in use / compose ollama conflict

Symptom: `bind: address already in use` or unexpected `ollama` container.

```bash
cd /etc/personaios
./scripts/vps-recover-api.sh
# or one-shot from curl:
# curl -fsSL https://raw.githubusercontent.com/YOUR_ORG/personai-os/main/scripts/vps-recover-api.sh | bash
./scripts/vps-tailscale.sh your-host.tailXXXX.ts.net
```

Also verify:

```bash
grep -E '^(COMPOSE_FILE|COMPOSE_PROFILES|OLLAMA_HOST)=' .env
COMPOSE_PROFILES= docker compose config --services   # must NOT list ollama
docker rm -f personaios-ollama-1 2>/dev/null || true
```

### Open WebUI / foreign app on same origin

If phone shows `/_app/immutable/...` 404s or redirects to `/auth?redirect=...`, the browser is serving **another app** from cache (e.g. Open WebUI), not PersonAI.

1. Delete site data on phone
2. On VPS: `docker compose exec web ls /usr/share/nginx/html/_app 2>/dev/null || echo "OK: no _app"`
3. Re-run `./scripts/vps-tailscale.sh`

### Ollama unreachable from API container

```bash
# From host
curl http://127.0.0.1:11434/api/tags

# From API container
docker compose exec api wget -qO- http://host.docker.internal:11434/api/tags
```

Ensure `.env` has `OLLAMA_HOST=http://host.docker.internal:11434` (not `127.0.0.1` — that's the container's loopback).

### Can't unlock / "Restore unlock keys" / CRYPTO_RESTORE_REQUIRED

Symptom: profile `Example User` (`YOUR-PROFILE-UUID`) still listed, but Unlock fails or the UI says **Restore unlock keys** / API returns `CRYPTO_RESTORE_REQUIRED`.

Cause: `profiles.json` lost `passwordHash` / `kdfSalt` / `wrappedDek` (empty-registry / Default-profile chaos, bad `DATA_DIR`, or partial restore) while `profiles/<uuid>/personai.db.enc` remains. Password alone cannot unwrap the DEK without those fields.

**Prefer restore (keeps sealed DB):**

```bash
cd /etc/personaios
docker compose stop api
ls -lt data/profiles.json* /etc/personaios/data/profiles.json* 2>/dev/null | head
# Restore the newest backup that still contains wrappedDek for YOUR-PROFILE-UUID
# Example:
#   cp -a data/profiles.json.bak.<stamp> data/profiles.json
docker compose start api
curl -sS http://127.0.0.1:4000/profiles | python3 -m json.tool | head
```

Phone: clear site data if needed → open `http://your-host.tailXXXX.ts.net:3000/profiles/` (or HTTPS once Serve is up) → **Unlock** with the old password.

**Emergency reset (one profile — keeps uploads/archive files, fresh empty DB):**

```bash
cd /etc/personaios
docker compose stop api
./scripts/emergency-reset-profile-crypto.sh YOUR-PROFILE-UUID
docker compose start api
```

Phone → `/profiles/` → **Set password & continue**. Quarantined `*.quarantine.*` under the profile dir can be deleted later; they are unreadable without the old `wrappedDek`.

### Nuclear recovery

```bash
cd /etc/personaios
git fetch && git reset --hard origin/main
./scripts/vps-recover-api.sh
./scripts/vps-tailscale.sh your-host.tailXXXX.ts.net
./scripts/vps-verify.sh your-host.tailXXXX.ts.net
```

---

## 9. Optional: bundled Docker Ollama

Only if **no** native Ollama on the host:

```bash
# .env
OLLAMA_HOST=http://ollama:11434
docker compose -f docker-compose.yml -f docker-compose.ollama.yml up -d --build
ollama pull maternion/LightOnOCR-2   # via docker exec or compose exec
```

Or via install.sh: `--ollama=new-docker`

**Do not** combine host Ollama + `docker-compose.ollama.yml` — both bind `:11434`.

---

## 10. Tailscale HTTPS vs Caddy vs mkcert

| Path | When to use | Notes |
|------|-------------|-------|
| **`tailscale serve` (recommended)** | Phone PWA on MagicDNS | Auto TLS for `*.ts.net`; `HTTPS=1 ./scripts/vps-tailscale.sh` |
| **Caddy + `docker-compose.prod.yml`** | Public internet hostname | Let's Encrypt; not needed for tailnet-only |
| **mkcert / self-signed** | Lab only | Phone must trust the CA; painful on Android — avoid |

### Optional: Caddy HTTPS (public internet)

For a real domain (not Tailscale-only):

1. During install, set `--domain=app.example.com --tls=yes`
2. Or edit `Caddyfile` and use `docker-compose.prod.yml`
3. Set `NEXT_PUBLIC_API_URL=https://api.app.example.com` and matching `PUBLIC_WEB_URL`
4. Rebuild web: `docker compose -f docker-compose.prod.yml build web && docker compose -f docker-compose.prod.yml up -d`

For **Tailscale phone PWA**, prefer Serve (§6) over Caddy.

---

## Script reference

| Script | Purpose |
|--------|---------|
| `install.sh` | Fresh install or update; writes `.env`, override, starts stack |
| `setup.sh --mode=vps` | Wizard → delegates to `install.sh` |
| `scripts/vps-tailscale.sh HOST` | Bake MagicDNS API/web URLs, rebuild api+web, health-check |
| `HTTPS=1 ./scripts/vps-tailscale.sh HOST` | Same + Tailscale Serve TLS + HTTPS env (PWA) |
| `HTTPS=1 ./scripts/vps-tailscale.sh --serve-only HOST` | Recreate Serve only when status is “No serve config” |
| `scripts/vps-verify.sh HOST` | Git SHA, compose ps, health curls, OAuth env, phone checklist |
| `scripts/vps-recover-api.sh` | Reset to no-compose-ollama, fix stale `.env`/override |
| `scripts/vps-up.sh` | Start stack with host Ollama hygiene (no Tailscale bake-in) |

---

## Related README sections

- [Security](../README.md#security) — password auth, encryption, Tailscale notes
- [Phone via Tailscale](../README.md#phone-via-tailscale-magicdns)
- [Google Drive](../README.md#configure-google-drive)
- [Archive OCR](../README.md#archive-ocr--ingest-scanned-pdfs-swiss-qr)
