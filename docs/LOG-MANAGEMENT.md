# Log management

PersonAI OS writes structured JSON logs to a gitignored `logs/` tree at the repo root (or `LOG_DIR` on VPS/Docker).

## Layout

```text
logs/
  info/YYYY-MM-DD.log      # bootstrap, routine events
  warning/YYYY-MM-DD.log   # 4xx, slow paths, missing routes
  error/YYYY-MM-DD.log     # 5xx, exceptions, uncaught errors
```

Each line is one JSON object: `{ ts, level, service, message, context?, stack? }`. Secrets in context keys (`password`, `token`, `authorization`, …) are redacted.

## Configuration

| Variable | Default | Notes |
|----------|---------|-------|
| `LOG_DIR` | `./logs` (repo root) | Set in `.env` or Docker (`/app/logs`) |

Docker Compose mounts `./logs:/app/logs` on the API service.

## Web client errors

The static web app POSTs sanitized errors to `POST /ops/client-log` (no auth). The API persists them under `logs/error/` with `source: personai-web`.

## VPS (read-only check)

From your laptop (uses same `DEPLOY_*` / plink settings as `scripts/deploy-vps.sh`):

```bash
./scripts/vps-check-logs.sh
LINES=100 ./scripts/vps-check-logs.sh
```

On the VPS, logs live under `${INSTALL_DIR}/logs` (typically `/etc/personaios/logs`).

## Tests

```bash
pnpm --filter @personai/server exec tsx src/lib/file-logger.test.ts
pnpm --filter @personai/server exec tsx src/lib/file-logger.stress.test.ts
pnpm --filter @personai/server exec tsx src/lib/file-logger.integration.test.ts
```

Or run the full server test suite (`pnpm --filter @personai/server test`).

## Periodic monitoring (`/loop`)

From your laptop or balcony machine (uses `.env.deploy.local` — never commit):

```bash
# One-shot: only print NEW error lines since last run
./scripts/vps-log-loop.sh

# Poll every 5 minutes (Ctrl+C to stop)
INTERVAL=300 ./scripts/vps-log-loop.sh

# Full tail (no delta tracking)
./scripts/vps-check-logs.sh
LINES=100 ./scripts/vps-check-logs.sh
```

`vps-log-loop.sh` stores line counts in `.vps-log-loop.state` (gitignored) so Cursor `/loop` automations can surface only new `error/` entries.

After deploy, `scripts/deploy-vps.sh` and `scripts/vps-verify.sh` confirm `logs/{info,warning,error}` exist on the VPS host and inside the API container.
