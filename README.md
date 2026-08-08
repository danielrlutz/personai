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

## One-line install **or update** (Linux / VPS)

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
pnpm build:server
pnpm build:web
# Requires Rust + Tauri CLI
cd src-tauri && cargo tauri dev
```

## Profiles

Multi-profile: each profile has its own SQLite DB under `data/profiles/{id}/`. Switching profiles disconnects the previous Prisma client (singleton) before opening the next DB.

## License tiers

Set `LICENSE_TIER=core|pro` in `.env`. Pro unlocks OCR, advisor chat, dual medical analysis, and AI briefing narrative.
