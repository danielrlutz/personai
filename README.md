# PersonAI OS

Privacy-first local operating system for freelancers — finance, legal tasks, medical history, and AI briefings. Data stays on disk (SQLite per profile). AI runs via local Ollama.

## Stack

- **Web**: Next.js (static export), React, Tailwind, Framer Motion
- **Server**: Fastify sidecar + Prisma + SQLite
- **Desktop**: Tauri v2 (spawns Node sidecar)
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

Cross-platform wizard that detects/installs Node (≥20), pnpm, Rust, Tauri CLI v2, and OS build tools (MSVC + WebView2 on Windows, Xcode CLT on macOS, webkit2gtk etc. on Linux). Modes: **desktop deps**, **VPS Docker stack** (delegates to `install.sh`), **full setup**, or **check-only**.

### One-liners

```powershell
# Windows (PowerShell)
irm https://raw.githubusercontent.com/danielrlutz/personai/main/setup.ps1 | iex
```

```bash
# macOS / Linux
curl -fsSL https://raw.githubusercontent.com/danielrlutz/personai/main/setup.sh | bash
```

### From a local checkout

```bash
# macOS / Linux
./setup.sh                 # interactive menu
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

Prefer the wizard’s **VPS** mode, or call the Docker installer directly:

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
# Non-interactive install
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

### With Docker (Ollama + API + Web)

```bash
docker compose up -d --build
pnpm pull-models   # or scripts/pull-models.ps1 on Windows
```

## VPS deploy

```bash
docker compose -f docker-compose.prod.yml up -d --build
```

Edit `Caddyfile` hostnames before production TLS.

## Desktop (Tauri)

```bash
# Install toolchain first (recommended)
./setup.sh --mode=desktop          # macOS/Linux
.\setup.ps1 -Mode desktop          # Windows
```

### Fastest startup (recommended for day-to-day)

Skips the Next.js cold start by serving the static export (`apps/web/out`) and reuses `apps/server/dist` when present:

```bash
pnpm tauri:dev:fast
```

- Rebuild web export when UI changed: `FORCE_WEB_BUILD=1 pnpm tauri:dev:fast` (or `pnpm build:web` then `PERSONAI_DEV_STATIC=1 pnpm tauri:dev`)
- Rebuild server only when API code changed: `pnpm build:server` (sidecar loads `dist/`, not TypeScript sources)
- First Rust compile is slow; later `cargo tauri dev` uses incremental builds

### Full Next.js HMR (slower first paint)

```bash
pnpm build:server   # once, or after server changes
pnpm tauri:dev      # starts Next via beforeDevCommand
```

## Profiles

Multi-profile: each profile has its own SQLite DB under `data/profiles/{id}/`. Switching profiles disconnects the previous Prisma client (singleton) before opening the next DB.

## License tiers

Set `LICENSE_TIER=core|pro` in `.env`. Pro unlocks OCR, advisor chat, dual medical analysis, and AI briefing narrative.
