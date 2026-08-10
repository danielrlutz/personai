# PersonAI OS

Local-first **pocket team** for personal life, business ops, or both (Swiss/CH-DE aware) — twelve specialist modes, archive OCR with confirm gates, finance/legal/medical, morning brief, and local Ollama. Data stays on disk (SQLite per profile). New profiles default to **personal** mode (no business/MWST boilerplate).

Inspired by Harmonia Hermes (one orchestration path, confirm before irreversible writes) — implemented **in-app**, not as Telegram bots or n8n. Specialist **skills** live as `apps/server/skills/*/SKILL.md` (Hermes-style registry, injected per role). **Memory distill** (Settings) promotes chat cues into confirm-gated memory facts.

**New users:** see the end-to-end walkthrough in [docs/USER-GUIDE.md](docs/USER-GUIDE.md) (unlock, Settings / Product vault, Google Drive OAuth, daily Home triage, security habits).

## Pocket team (Team)

| Mode | Role |
|------|------|
| Staff (`secretary`) | Triage, archive confirms, morning brief |
| Architect / Forge / QA | **Forge ↔ QA loop** (server-orchestrated, max 3 retries; ship needs confirm) |
| CFO | Invoices, QR → ledger (confirm before write) |
| Legal Aide | Docs / Fristen (informational); `court` routes here |
| Medical Integrator | Records / timelines (not a diagnosis) |
| Bio / Mystic / Stylist / Wingman | Rich coaching personas (CEO/memory/archive aware) |
| Stylist | Optional **photo upload** → vision notes → coaching |
| Career Strategist | Career HTML→PDF (confirm before download) |

Open **Team** in the app (`/team?specialist=cfo`). Money and export actions use **Needs your confirmation** before anything is written.

**Per-specialist models** (failover within pulled tags — no required new pulls):

| Role | Preferred | Failover |
|------|-----------|----------|
| OCR / Stylist vision | `maternion/LightOnOCR-2:latest` | `maternion/LightOnOCR-2` |
| Staff / CFO / Legal / Medical | `deepseek-r1:8b` | — |
| Architect | `deepseek-r1:14b` | `deepseek-r1:8b` |
| Forge | `qwen2.5-coder:14b-instruct-q5_K_M` | `qwen2.5-coder:14b` → `deepseek-r1:8b` |
| QA Auditor | `deepseek-r1:8b` | `deepseek-r1:14b` |
| Coaching (Bio/Mystic/Wingman/Career) | `llama3.1:8b` | `llama3:latest` → `deepseek-r1:8b` |
| Stylist text | `gemma4:e4b` | `llama3.1:8b` |

Product config (Ollama host, Google OAuth, models, premium keys) lives in **Settings → encrypted host vault** — not day-to-day `.env` edits. `.env` remains Docker bootstrap only.

Smoke API: `node scripts/integration-test.mjs` (API on `:4000`).

## Archive naming, split, and Google Drive

| Piece | Behaviour |
|-------|-----------|
| Naming | `{date}_{DocType}_{Entity}.pdf` (e.g. `2026-08-09_BILL_Swisscom.pdf`) |
| Taxonomy folders | `01_Official` … `10_Vehicles` (local + optional Drive) |
| Bulk PDF split | Multipage scans are rasterized, blank-separated (or per-page for Genius Scan bulks), then each segment gets its own confirm |
| Confirm gate | Ledger / archive / medical export wait for explicit approve |
| Local archive | Always: `data/profiles/{id}/archive/{NN_Category}/{name}` on confirm |
| Google Drive | Link in Settings (OAuth preferred). Until linked: chat works without archive context; Archive upload is soft-gated. |

### Configure Google Drive

**Preferred — user OAuth (Settings → Link Google Drive):**

1. Google Cloud OAuth client (Web), enable **Google Drive API**.
2. Authorized redirect URI: `{API}/archive/drive/oauth/callback` (see `GOOGLE_OAUTH_REDIRECT_URI`).
3. Set `GOOGLE_OAUTH_CLIENT_ID`, `GOOGLE_OAUTH_CLIENT_SECRET`, `PUBLIC_WEB_URL`.
4. After password login: Settings → **Link Google Drive**. PersonAI stores a per-profile refresh token, creates `PersonAI_Archive` if needed, and builds archive context (MemoryFact `archive.index`). Use **Refresh archive context** anytime.

**Alternative — service account (headless VPS):**

1. Create a service account, enable Drive API, download JSON.
2. Share taxonomy folders (or one root) with the SA email (**Editor**).
3. Set env vars (see `.env.example`):

```bash
GOOGLE_DRIVE_ENABLED=true
GOOGLE_SERVICE_ACCOUNT_JSON=./secrets/google-service-account.json
GOOGLE_DRIVE_FOLDER_1=...   # Official (Behörden)
GOOGLE_DRIVE_FOLDER_8=...   # Legal (Gericht / contracts)
# …or a root and let PersonAI create 01_Official … under it:
GOOGLE_DRIVE_ROOT_FOLDER_ID=...
```

Check status: `GET /archive/drive` (includes `linked` + archive context) or `drive` on `GET /health`.

**PDF tooling for split/OCR:** install PyMuPDF (`pip install pymupdf`) or `poppler-utils` (`pdftoppm`) on the API host so multipage PDFs rasterize before vision OCR.

## Stack

- **Web**: Next.js (static export), React, Tailwind, Framer Motion
- **Server**: Fastify sidecar + Prisma + SQLite (one orchestration path)
- **Desktop**: Tauri v2 (spawns Node sidecar) — MSI / NSIS
- **AI**: Ollama (`maternion/LightOnOCR-2`, `deepseek-r1:8b`) with VRAM semaphore
- **Deploy**: Docker Compose (dev + VPS with Caddy)

## Security

**Yes — password auth and at-rest encryption are essential** once the API is reachable beyond loopback (Tailscale phone, VPS). Volume permissions and Tailscale alone are **not** enough: anyone who can hit `:4000` could previously open any profile with only `X-Profile-Id`.

### What ships now

| Control | Behaviour |
|---------|-----------|
| **Password** | Per-profile, Argon2id (64 MiB, t=3). Min 8 characters. |
| **Session** | Opaque Bearer token (SHA-256 stored server-side in `data/sessions.json`). Sent as `Authorization: Bearer …`. |
| **API lock** | All routes except `GET /health`, `GET /profiles`, `POST /auth/login`, `POST /auth/setup` require a valid session. Bare `X-Profile-Id` is **not** a credential. |
| **At rest** | Profile SQLite is sealed as `personai.db.enc` (AES-256-GCM) with a random DEK wrapped by a password-derived KEK. Sign-out / process exit re-seals and deletes plaintext `personai.db`. |
| **UI lock** | Optional PIN and/or WebAuthn passkey (platform authenticator) lock the PWA UI after password unlock once. Passkeys need HTTPS; they never unwrap the DB. |
| **Migration** | Existing profiles without a password must **set one on next open** before entering the app. |

### User setup

1. Open the app → **profiles** screen.
2. Pick your account → **set password** (first time) or **unlock** with password.
3. New accounts: name + password on create (DB encrypted from the start).
4. Change password anytime: **Settings → Password & encryption**.
5. Sign out: seals the DB; you must unlock again.

### Tailscale / transit notes

| Path | Recommendation |
|------|----------------|
| **Tailscale HTTP** `http://HOST:3000` → `http://HOST:4000` | Fine for browsing inside the tailnet. **Not** a Chrome-installable PWA (no secure context). |
| **Tailscale HTTPS (PWA)** | `HTTPS=1 ./scripts/vps-tailscale.sh HOST` → Tailscale Serve: `https://HOST` + API `https://HOST:8443`. Required for **Install app**. |
| **Public internet** | Terminate **HTTPS** with Caddy (`docker-compose.prod.yml` + `Caddyfile`). Do not expose bare `:4000` to the world. |

### What is still out of scope (honest)

- Uploads / archive PDFs are **not** individually encrypted (only the SQLite DB file).
- Session token lives in `localStorage` (needed for static web + cross-origin `:3000`→`:4000` over HTTP; httpOnly Secure cookies need HTTPS).
- Crash before seal can leave a temporary plaintext `personai.db` — treat disk/volume ACLs as a second layer.
- Drive service-account JSON and `.env` secrets remain filesystem-protected; keep them out of git.

### Desktop vs VPS / PWA (data isolation)

These are **separate deployments** of the same UI — decentralized by design.

| Surface | Where it runs | Where data lives | Who talks to whom |
|---------|---------------|------------------|-------------------|
| **Tauri desktop** | Your laptop | Local SQLite under OS app-data (`%APPDATA%/PersonAI` / similar) | Local Node sidecar → local/native Ollama |
| **VPS + PWA** | Server + phone/browser | SQLite volume on the VPS (`DATA_DIR`) | Browser/PWA → VPS API → VPS/host Ollama |

- **They do not share data automatically.** A bill you scan on the desktop does not appear on the phone PWA (and vice versa).
- **Phone PWA + laptop browser** against the *same* VPS URL **do** share that VPS profile database.
- **Optional later:** encrypted export/import, or point a desktop build at a remote API (trades local-first privacy for sync). Not enabled by default.

## Setup wizard (desktop + VPS)

Cross-platform wizard with modes: **desktop deps**, **VPS Docker stack** (delegates to `install.sh`), **full setup**, or **check-only**.

| Goal | What you need | Recommended command |
|------|---------------|---------------------|
| **VPS / PWA** | Docker + Compose only (no Rust/Tauri) | `install.sh` or `./setup.sh` → option **2** |
| **Desktop / Tauri** | Node, pnpm, Rust, Tauri, OS build tools | `./setup.sh` → option **1** (or `setup.ps1` on Windows) |

Check-only detects the toolchain and **installs nothing**, then offers a next-step menu (VPS deps, desktop deps, run `install.sh`, or exit). On headless Linux it recommends the VPS path and does not treat missing Rust/Tauri as a failure.

### One-liners

```bash
# Linux VPS (recommended — Docker Compose stack)
curl -fsSL https://raw.githubusercontent.com/danielrlutz/personai/main/install.sh | bash
```

```bash
# macOS / Linux desktop (or interactive wizard that also offers VPS)
curl -fsSL https://raw.githubusercontent.com/danielrlutz/personai/main/setup.sh | bash
```

```powershell
# Windows desktop (PowerShell)
irm https://raw.githubusercontent.com/danielrlutz/personai/main/setup.ps1 | iex
```

### From a local checkout

```bash
# macOS / Linux
./setup.sh                 # interactive menu (defaults to VPS on headless hosts)
./setup.sh --mode=vps      # Docker stack via install.sh
./scripts/setup --mode=check
./setup.sh --yes --mode=desktop
./setup.sh --yes --mode=full --docker=yes --pull-models=no
```

```powershell
# Windows
.\setup.cmd                # or .\setup.ps1
.\scripts\setup.ps1 -Mode check
.\setup.ps1 -Yes -Mode desktop
.\setup.ps1 -Yes -Mode full -Docker yes -PullModels no
```

Non-interactive: pass `--yes` / `-Yes`. When piped (`curl | bash`), prompts still read from `/dev/tty` when available.

## One-line install **or update** (Linux / VPS)

On a Debian/Ubuntu VPS you only need Docker. Prefer the installer directly (or the wizard’s **VPS** mode):

```bash
curl -fsSL https://raw.githubusercontent.com/danielrlutz/personai/main/install.sh | bash
```

Re-run the **same** command anytime. If `~/personai` (or another detected install) already exists, the script enters **update mode**: backs up `.env` / overrides, `git fetch` + upgrade, merges config, rebuilds containers, and **never wipes** your `data/` directory.

Fresh install additionally scans for Ollama (processes, Docker, ports, HTTP `/api/tags`) and lets you choose:

1. Use existing Ollama (native)
2. Use existing Ollama (Docker)
3. Start a new Ollama via Docker
4. Skip AI (Core tier)

Also configurable: install/data dirs, ports, license tier, domain + Caddy TLS, model pulls, stack start, optional user systemd unit.

```bash
# Non-interactive — host Ollama already installed (typical VPS)
curl -fsSL https://raw.githubusercontent.com/danielrlutz/personai/main/install.sh | bash -s -- \
  --yes --ollama=existing-native --tier=pro --domain=app.example.com --tls=yes --pull-models=yes --start=yes

# Non-interactive — bundled Docker Ollama (opt-in; binds :11434)
curl -fsSL https://raw.githubusercontent.com/danielrlutz/personai/main/install.sh | bash -s -- \
  --yes --ollama=new-docker --tier=pro --domain=app.example.com --tls=yes --pull-models=yes --start=yes

# Force update of an existing install
curl -fsSL https://raw.githubusercontent.com/danielrlutz/personai/main/install.sh | bash -s -- --yes --update --dir ~/personai
```

## Quick start (local dev)

After the setup wizard (or once Node/pnpm are installed):

```bash
pnpm install
cp .env.example .env

# Terminal 1 — API
pnpm dev:server

# Terminal 2 — Web
pnpm dev:web
```

Open http://localhost:3000

### With Docker (API + Web; Ollama optional)

**Default:** use a host-installed Ollama. Base compose has **no** `ollama` service (avoids `bind: address already in use` on `:11434`).

```bash
# Point the API container at host Ollama (Linux gateway is wired in compose)
# In .env:
#   OLLAMA_HOST=http://host.docker.internal:11434
#   COMPOSE_PROFILES=   # must be empty
COMPOSE_PROFILES= docker compose up -d --build
# or just the API:
COMPOSE_PROFILES= docker compose up api -d --build

pnpm pull-models   # or scripts/pull-models.ps1 / native: ollama pull …
```

**Opt-in bundled Ollama** (separate file; binds host `:11434`):

```bash
# In .env:
#   OLLAMA_HOST=http://ollama:11434
docker compose -f docker-compose.yml -f docker-compose.ollama.yml up -d --build
```

## VPS deploy

**Full step-by-step guide:** [docs/VPS-SETUP.md](docs/VPS-SETUP.md) — prerequisites, `.env` (required or not), first install, updates, Tailscale phone access, verify, troubleshooting.

Prefer `./install.sh` (detects native Ollama and wires `host.docker.internal`).

**Recovery when `:11434` is already in use** (stale profile / override / `COMPOSE_FILE` still starting compose ollama):

```bash
cd /etc/personaios   # or ~/personai — your install dir
# One-shot (resets to origin/main if needed, strips ollama, up api):
curl -fsSL https://raw.githubusercontent.com/danielrlutz/personai/main/scripts/vps-recover-api.sh | bash
# Or after git pull:  ./scripts/vps-recover-api.sh
# Ongoing helper:     ./scripts/vps-up.sh api
```

Manual checklist:

```bash
cd /etc/personaios
git fetch && git reset --hard origin/main   # need a2f2533+ (no ollama in base compose)
unset COMPOSE_FILE; export COMPOSE_FILE= COMPOSE_PROFILES=
sed -i '/^COMPOSE_FILE=/d; s/^COMPOSE_PROFILES=.*/COMPOSE_PROFILES=/' .env
# OLLAMA_HOST=http://host.docker.internal:11434
docker rm -f personaios-ollama-1 2>/dev/null || true
docker compose down --remove-orphans
docker compose config --services   # must NOT list ollama
COMPOSE_FILE= COMPOSE_PROFILES= docker compose up api -d --build --remove-orphans
docker compose ps
```

Bundled Ollama only when you intentionally want Docker Ollama (no host listener on `:11434`):

```bash
# .env: OLLAMA_HOST=http://ollama:11434
docker compose -f docker-compose.prod.yml -f docker-compose.ollama.yml up -d --build
```

Edit `Caddyfile` hostnames before production TLS.

### Phone via Tailscale (MagicDNS)

**Chrome Install app** needs HTTPS (secure context). Plain `http://HOST:3000` will not show a real PWA install — use Tailscale Serve:

```bash
# Once: https://login.tailscale.com/admin/dns → Enable HTTPS
cd /etc/personaios && git fetch && git reset --hard origin/main
./scripts/vps-verify.sh
HTTPS=1 ./scripts/vps-tailscale.sh debi9.tail8175e6.ts.net
# Phone: https://debi9.tail8175e6.ts.net  → Chrome → Install app
# API:   https://debi9.tail8175e6.ts.net:8443
```

Browse-only HTTP (not installable):

```bash
./scripts/vps-tailscale.sh debi9.tail8175e6.ts.net
# force clean rebuild if needed:
# NO_CACHE=1 ./scripts/vps-tailscale.sh debi9.tail8175e6.ts.net
```

### VPS verify (“Failed to fetch” checklist)

```bash
cd /etc/personaios
./scripts/vps-verify.sh debi9.tail8175e6.ts.net
```

Paste-ready from the VPS:

```bash
curl -sS http://127.0.0.1:4000/health
curl -sS -o /dev/null -w 'web %{http_code}\n' http://127.0.0.1:3000/
curl -sS http://debi9.tail8175e6.ts.net:4000/health
curl -sS -o /dev/null -w 'web-ts %{http_code}\n' http://debi9.tail8175e6.ts.net:3000/
```

Paste-ready on the phone (browser address bar):

- UI: `http://debi9.tail8175e6.ts.net:3000`
- API health: `http://debi9.tail8175e6.ts.net:4000/health`

If health works but Messages/team chat fails: unlock the profile on `/profiles/` (Bearer session), then Settings → API URL = `http://debi9.tail8175e6.ts.net:4000` (no trailing slash).

What the script does: sets `NEXT_PUBLIC_API_URL` / `PUBLIC_API_URL` / `PUBLIC_WEB_URL` (HTTP `:4000`/`:3000` or HTTPS `:8443` + origin), `OLLAMA_HOST=http://host.docker.internal:11434`, clears `COMPOSE_FILE` / `COMPOSE_PROFILES`, rebuilds **api + web**, health-checks loopback, and with `HTTPS=1` configures **Tailscale Serve**.

| Surface | HTTP (browse) | HTTPS (Install app) |
|---------|---------------|---------------------|
| Phone | `http://debi9.tail8175e6.ts.net:3000` | `https://debi9.tail8175e6.ts.net` |
| API | `http://debi9.tail8175e6.ts.net:4000` | `https://debi9.tail8175e6.ts.net:8443` |

**On the phone after HTTPS rebuild:**

1. Chrome → delete site data for old `http://…:3000` origins; remove fake shortcuts.
2. Open `https://debi9.tail8175e6.ts.net` → unlock → Chrome → **Install app**.
3. If API fails: **Settings → API Server** → `https://debi9.tail8175e6.ts.net:8443` (**no trailing slash**) → Save & test.

The web image is a **static Next.js export** — `NEXT_PUBLIC_API_URL` is baked at **image build** time; `.env` alone is not enough without rebuild (hostname fallback and Settings override still work without a bake-in).

PersonAI **web** routes are `/`, `/profiles/`, `/dashboard/`, etc. Password login happens on `/profiles/` (API uses `/auth/login`, `/auth/setup` — there is **no** Next.js page at `/auth`). There are **no** SvelteKit `/_app/immutable/...` assets — only Next `/_next/static/...`.

Login navigates with a **relative** `/dashboard/` (trailing slash). nginx uses `absolute_redirect off` so directory redirects never rewrite the phone onto `:80` / `localhost` (that looked like `ERR_CONNECTION_REFUSED` after profile select).

### Troubleshooting: `/_app/immutable` 404 or redirect to `/auth?redirect=…`

If nginx/web logs show `/_app/immutable/nodes/...` 404s, or the phone navigates to a **foreign** `/auth?redirect=...` (query-string login from another stack), the browser is almost certainly running a **different app** (or an old Service Worker / site cache) on the same MagicDNS origin — not PersonAI.

1. On the VPS, confirm the web container only has Next `out/` (no `_app`):

```bash
docker compose exec web ls -la /usr/share/nginx/html
docker compose exec web ls /usr/share/nginx/html/_next/static 2>/dev/null | head
docker compose exec web ls /usr/share/nginx/html/_app 2>/dev/null || echo "OK: no _app (expected)"
```

2. From the VPS, curl should show Next assets OK and foreign prefixes as real 404 (not HTML):

```bash
curl -sI http://127.0.0.1:3000/ | head -5
curl -sI http://127.0.0.1:3000/_next/static/ | head -5
curl -sI http://127.0.0.1:3000/_app/immutable/nodes/51.js | head -8
curl -sI http://127.0.0.1:3000/api/config | head -8
# Body of missing /_app or /api must NOT be index.html
curl -s http://127.0.0.1:3000/_app/version.json | head -c 200; echo
```

3. Clear phone site data (section above), then re-run `./scripts/vps-tailscale.sh …` if needed.

## Desktop (Tauri)

### Windows download (v0.5.1)

- [MSI installer](https://github.com/danielrlutz/personai/releases/download/v0.5.1/PersonAI.OS_0.5.1_x64_en-US.msi)
- [NSIS setup EXE](https://github.com/danielrlutz/personai/releases/download/v0.5.1/PersonAI.OS_0.5.1_x64-setup.exe)
- [Release notes](https://github.com/danielrlutz/personai/releases/tag/v0.5.1)

```bash
# Install toolchain first (recommended)
./setup.sh --mode=desktop          # macOS/Linux
.\setup.ps1 -Mode desktop          # Windows
```

The desktop shell runs as a normal app with a **system tray** icon (bottom-right on Windows). The Node API sidecar is spawned **without a console window** — do not look for a terminal to babysit, and do not close a console to stop the app.

- **Start:** installer shortcut / `pnpm tauri:dev:fast` (dev) / packaged MSI·NSIS app
- **Hide:** close the window → app stays in the tray; API keeps running
- **Show:** tray icon click, or tray menu → Open PersonAI OS
- **Quit:** tray menu → Quit (gracefully stops the sidecar we started)
- Single-instance: a second launch focuses the existing window instead of orphaning another API

### Fastest startup (recommended for day-to-day)

Skips the Next.js cold start by serving the static export (`apps/web/out`) and reuses `apps/server/dist` when present:

```bash
pnpm tauri:dev:fast
```

- Rebuild web export when UI changed: `FORCE_WEB_BUILD=1 pnpm tauri:dev:fast` (or `pnpm build:web` then `PERSONAI_DEV_STATIC=1 pnpm tauri:dev`)
- Rebuild server only when API code changed: `pnpm build:server` (sidecar loads `dist/`, not TypeScript sources)
- First Rust compile is slow; later `cargo tauri dev` uses incremental builds
- Your own terminal for `pnpm tauri:dev*` is fine for developers; the **Node sidecar** still runs headless (no extra console)

### Full Next.js HMR (slower first paint)

```bash
pnpm build:server   # once, or after server changes
pnpm tauri:dev      # starts Next via beforeDevCommand
```

### Verify tray / headless sidecar

```bash
pnpm build:server
cd src-tauri && cargo check   # compile shell + tray + CREATE_NO_WINDOW spawn
# or: pnpm tauri:dev:fast     # confirm tray icon, close→hide, Quit stops API
# packaging (v0.5.x): pnpm tauri:build  # MSI/NSIS still use bundle.resources + release windows_subsystem
```

## Archive OCR / ingest (scanned PDFs, Swiss QR)

Optimized for **Genius Scan / phone stacks** and **CH-DE** paperwork:

1. Upload → queue → **VRAM VISION lock** (unchanged failover)
2. **Rasterize PDF pages** (PyMuPDF script, or `pdftoppm` fallback) — do not send raw multipage PDF bytes to LightOnOCR
3. **Blank-page split** + phone-scanner **per-page split**; re-merge when OCR sees `Seite 1 von N`
4. **Swiss QR decode** (SPC payload via jsQR) before/alongside vision; confirm gate still required before ledger
5. CH-DE vision prompt → archive name / QR bill / expense / archive.commit

### VPS / Docker model pull

After deploy (host Ollama or bundled):

```bash
pnpm pull-models          # Linux/macOS helper (vision + reasoning + coder)
# or:
ollama pull maternion/LightOnOCR-2
ollama pull deepseek-r1:8b
ollama pull qwen2.5-coder:7b   # Forge; optional — falls back to reasoning
```

| Env | Default | Used by |
|-----|---------|---------|
| `OLLAMA_VISION_MODEL` | `maternion/LightOnOCR-2` | Archive OCR + Stylist photo notes |
| `OLLAMA_REASONING_MODEL` | `deepseek-r1:8b` | Most specialists, Architect, Legal, QA |
| `OLLAMA_CODER_MODEL` | `qwen2.5-coder:7b` | Forge (fallback → reasoning if missing) |

API image includes **Python 3 + PyMuPDF + poppler-utils** for rasterization. On Windows desktop, install [PyMuPDF](https://pypi.org/project/PyMuPDF/) (`pip install pymupdf`) so scanned PDFs prepare correctly; otherwise the worker falls back to raw PDF (worse for multipage).

Optional env: `INGEST_PDF_DPI` (default 140), `INGEST_MAX_PAGES` (40), `OLLAMA_VISION_TIMEOUT_MS` (180000).

## Profiles

Multi-profile: each profile has its own SQLite DB under `data/profiles/{id}/`. Switching profiles disconnects the previous Prisma client (singleton) before opening the next DB.

## License tiers

Set `LICENSE_TIER=core|pro` in `.env`. Pro unlocks OCR, advisor chat, dual medical analysis, and AI briefing narrative.
