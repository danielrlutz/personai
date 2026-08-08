# PersonAI OS

Privacy-first local operating system for freelancers — finance, legal tasks, medical history, and AI briefings. Data stays on disk (SQLite per profile). AI runs via local Ollama.

## Stack

- **Web**: Next.js (static export), React, Tailwind, Framer Motion
- **Server**: Fastify sidecar + Prisma + SQLite
- **Desktop**: Tauri v2 (spawns Node sidecar)
- **AI**: Ollama (`maternion/LightOnOCR-2`, `deepseek-r1:8b`) with VRAM semaphore
- **Deploy**: Docker Compose (dev + VPS with Caddy)

## One-line install (Linux / VPS)

```bash
curl -fsSL https://raw.githubusercontent.com/danielrlutz/personai/main/install.sh | bash
```

The installer scans for existing Ollama runtimes (processes, Docker containers/images, ports `11434`/`11435`, HTTP `/api/tags`), then lets you choose:

1. Use existing Ollama (native)
2. Use existing Ollama (Docker)
3. Start a new Ollama via Docker
4. Skip AI (Core tier)

It also prompts for install/data dirs, ports, license tier, domain + Caddy TLS, model pulls, stack start, and an optional user systemd unit.

Non-interactive example:

```bash
curl -fsSL https://raw.githubusercontent.com/danielrlutz/personai/main/install.sh | bash -s -- \
  --yes \
  --ollama=new-docker \
  --tier=pro \
  --domain=app.example.com \
  --tls=yes \
  --pull-models=yes \
  --start=yes
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
