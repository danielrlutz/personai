# PersonAI OS

Local-first **pocket team** for personal life, business ops, or both (Swiss/CH-DE aware) — twelve specialist modes, archive OCR with confirm gates, finance/legal/medical, morning brief, and local Ollama. Data stays on disk (SQLite per profile). New profiles default to **personal** mode (no business/MWST boilerplate).

Inspired by Harmonia Hermes (one orchestration path, confirm before irreversible writes) — implemented **in-app**, not as Telegram bots or n8n.

## Pocket team (Team)

| Mode | Role |
|------|------|
| Staff (`secretary`) | Triage, archive confirms, morning brief |
| Architect / Forge / QA | Code loop (max 3 retries; ship needs confirm) |
| CFO | Invoices, QR → ledger (confirm before write) |
| Legal Aide | Docs / Fristen (informational) |
| Medical Integrator | Records / timelines (not a diagnosis) |
| Bio / Mystic / Stylist / Wingman | Coaching personas |
| Career Strategist | Career HTML→PDF |

Open **Team** in the app (`/team?specialist=cfo`). Money-adjacent and export actions use **Confirm before write**.

Smoke API: `node scripts/integration-test.mjs` (API on `:4000`).

## Stack

- **Web**: Next.js (static export), React, Tailwind, Framer Motion
- **Server**: Fastify sidecar + Prisma + SQLite (one orchestration path)
- **Desktop**: Tauri v2 (spawns Node sidecar) — MSI / NSIS
- **AI**: Ollama (`maternion/LightOnOCR-2`, `deepseek-r1:8b`) with VRAM semaphore
- **Deploy**: Docker Compose (dev + VPS with Caddy)

## Desktop vs VPS / PWA (data isolation)

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

One-liner after `git` is current (prefer full MagicDNS FQDN — Android often fails on short names like `debi9`):

```bash
cd /etc/personaios && git fetch && git reset --hard origin/main
./scripts/vps-tailscale.sh debi9.tail8175e6.ts.net
# force clean rebuild if needed:
# NO_CACHE=1 ./scripts/vps-tailscale.sh debi9.tail8175e6.ts.net
```

What the script does: sets `NEXT_PUBLIC_API_URL=http://HOST:4000` (no trailing slash), `OLLAMA_HOST=http://host.docker.internal:11434`, clears `COMPOSE_FILE` / `COMPOSE_PROFILES`, rebuilds **api + web**, then health-checks `:4000/health` (and `/health/`) plus `:3000`.

Still recommend baking via `vps-tailscale.sh`. If UI and API share the same MagicDNS hostname, the phone also works without a manual Settings override: when `NEXT_PUBLIC_API_URL` is unset and nothing is stored, the web client defaults to `http://<current-hostname>:4000` (localhost stays for desktop/Tauri).

| Surface | URL |
|---------|-----|
| Phone browser / PWA | `http://debi9.tail8175e6.ts.net:3000` |
| API (auto / Settings) | `http://debi9.tail8175e6.ts.net:4000` |

**On the phone after rebuild:**

1. Chrome → site settings for that origin → **Delete site data** (clears bad Service Worker / old shell). If installed as PWA, uninstall the shortcut first.
2. Open `http://debi9.tail8175e6.ts.net:3000`
3. If the app still cannot reach the API, **Settings → API Server** → use **Use this host's API** (or set `http://debi9.tail8175e6.ts.net:4000`, **no trailing slash**) → Save & test. This localStorage override wins even if the image was built with `localhost:4000`.

The web image is a **static Next.js export** — `NEXT_PUBLIC_API_URL` is baked at **image build** time; `.env` alone is not enough without rebuild (hostname fallback and Settings override still work without a bake-in).

PersonAI routes are `/`, `/profiles/`, `/dashboard/`, etc. There is **no** `/auth` route. There are **no** SvelteKit `/_app/immutable/...` assets — only Next `/_next/static/...`.

Login navigates with a **relative** `/dashboard/` (trailing slash). nginx uses `absolute_redirect off` so directory redirects never rewrite the phone onto `:80` / `localhost` (that looked like `ERR_CONNECTION_REFUSED` after profile select).

### Troubleshooting: `/_app/immutable` 404 or redirect to `/auth`

If nginx/web logs show `/_app/immutable/nodes/...` 404s, or the phone navigates to `/auth?redirect=...`, the browser is almost certainly running a **different app** (or an old Service Worker / site cache) on the same MagicDNS origin — not PersonAI.

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

## Profiles

Multi-profile: each profile has its own SQLite DB under `data/profiles/{id}/`. Switching profiles disconnects the previous Prisma client (singleton) before opening the next DB.

## License tiers

Set `LICENSE_TIER=core|pro` in `.env`. Pro unlocks OCR, advisor chat, dual medical analysis, and AI briefing narrative.
