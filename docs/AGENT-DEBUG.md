# Agent Debug — phone inbox → Cursor

Dev chat UI (messages + images) that batches balcony/phone notes into **one Cursor-ready prompt**.

## Architecture (layered)

| Layer | Role | Status |
|-------|------|--------|
| **UI + HTTP inbox** | Capture text/images over Tailscale | shipped |
| **Batch FSM** (`inbox.ts`) | `awaiting_more` / timeout / send-now | keep |
| **Compose** (`compose/` + Ollama) | High-fidelity Cursor prompt | shipped |
| **SDK dispatcher** (`dispatch/`) | Primary delivery via `@cursor/sdk` when `CURSOR_API_KEY` set | Phase 2 skeleton |
| **MCP poll** (`src/mcp/`) | Debug / fallback when no API key or SDK unavailable | keep |

```text
Phone → :8790  →  batch FSM  →  Ollama compose
                                    ↓ ready
                         ┌──────────┴──────────┐
                         ▼                     ▼
                  SDK queue (primary)    MCP poll (fallback)
                  Agent.create/send      agent_debug_poll
```

Do **not** big-bang rewrite. Keep the inbox FSM and worker tick; add delivery adapters beside them.

### What to prune vs keep

| Piece | Verdict |
|-------|---------|
| MCP tools + `agent-debug://inbox` | **Keep** as debug/fallback — mark as secondary in docs |
| Worker tick | **Keep** — flushes timeouts + composes ready batches |
| `compose.ts` + `compose/system-prompts.ts` | **Keep / extend** |
| Inbox FSM | **Keep** — core product |
| REST `/v1/status` + `/v1/pending` | **Keep** — UI + MCP share them (not duplicates to delete) |
| SDK bridge without API key | **No-op log** — server still runs |

### Refactor phases

1. **Phase 1 (done):** PersonAI UI, richer compose system prompts, docs.
2. **Phase 2 (skeleton now):** `dispatch/queue.ts` + `dispatch/cursor-sdk-bridge.ts` hooked after compose; optional `@cursor/sdk`.
3. **Phase 3:** Harden SDK (ack after successful run, retries, status `dispatched` in store, optional retire “you must poll” from agent habit).
4. **Phase 4 (optional):** Rename MCP module under `delivery/mcp-adapter` without changing tool names.

## Paths

| Piece | Path |
|-------|------|
| App | `apps/agent-debug` |
| HTTP API + UI | port **8790** (`HOST=0.0.0.0`) |
| Compose prompts | `apps/agent-debug/src/compose/system-prompts.ts` |
| SDK bridge | `apps/agent-debug/src/dispatch/cursor-sdk-bridge.ts` |
| MCP stdio (debug path) | `apps/agent-debug/src/mcp/index.ts` → `dist/mcp/index.js` |
| Data | `DATA_DIR` (default `./data/agent-debug`) |
| Docs | this file + `apps/agent-debug/README.md` |

## Run locally

```bash
pnpm install
pnpm --filter @personai/agent-debug dev
# UI: http://127.0.0.1:8790
```

Optional env (see `apps/agent-debug/.env.example`):

```bash
export AGENT_DEBUG_TOKEN='long-random'
export AGENT_DEBUG_COMPOSE_MODEL=llama3.1:8b
export OLLAMA_HOST=http://127.0.0.1:11434
export AGENT_DEBUG_VPS_HOST=your-host.tailXXXX.ts.net
export AGENT_DEBUG_REPO_PATH='/path/to/personai-os'
# Phase 2 — omit to keep MCP-only delivery:
# export CURSOR_API_KEY='…'
# export CURSOR_MODEL=composer-2.5
```

Pull the light compose model once:

```bash
ollama pull llama3.1:8b
```

### Phase 2 — SDK dispatch

When `CURSOR_API_KEY` is set and `@cursor/sdk` is installed (`optionalDependencies`), each batch that reaches `ready` is enqueued on a **single-flight** queue and sent via `Agent.create` + `agent.send` against `AGENT_DEBUG_REPO_PATH` (or monorepo root).

Without the key, the server logs a no-op and leaves the prompt for **MCP poll**. Missing `@cursor/sdk` logs a clear install hint and does not crash the HTTP server.

```bash
pnpm --filter @personai/agent-debug add @cursor/sdk   # if optional install skipped
```

## Run on VPS (phone via Tailscale)

```bash
cd /etc/personaios   # or your clone
# set in .env (no secrets committed):
#   AGENT_DEBUG_TOKEN=...
#   AGENT_DEBUG_VPS_HOST=your-host.tailXXXX.ts.net
#   AGENT_DEBUG_COMPOSE_MODEL=llama3.1:8b

docker compose --profile agent-debug up -d --build agent-debug
curl -sS http://127.0.0.1:8790/health
```

Phone (Tailscale MagicDNS FQDN preferred — use the machine that runs agent-debug):

```text
http://your-laptop.tailXXXX.ts.net:8790
```

Paste `AGENT_DEBUG_TOKEN` into the UI Token field (Send stays disabled until set). Attach/paste images; say “wait for pictures in my second message” to hold the batch, or tap **Send now**.

> Note: the UI is plain `http://` over Tailscale. Session IDs use a secure-context-safe fallback because `crypto.randomUUID()` is unavailable on non-HTTPS hosts.

## MCP in Cursor (debug / fallback path)

MCP does **not** auto-inject into Cursor chat. Use it when SDK dispatch is off, or to inspect the inbox.

Project snippet — `.cursor/mcp.json` (or Cursor Settings → MCP):

```json
{
  "mcpServers": {
    "agent-debug": {
      "command": "node",
      "args": [
        "/path/to/personai-os/apps/agent-debug/dist/mcp/index.js"
      ],
      "env": {
        "AGENT_DEBUG_URL": "http://127.0.0.1:8790",
        "AGENT_DEBUG_TOKEN": ""
      }
    }
  }
}
```

On Linux / VPS host MCP (if Cursor runs there):

```json
{
  "mcpServers": {
    "agent-debug": {
      "command": "node",
      "args": ["/etc/personaios/apps/agent-debug/dist/mcp/index.js"],
      "env": {
        "AGENT_DEBUG_URL": "http://127.0.0.1:8790",
        "AGENT_DEBUG_TOKEN": ""
      }
    }
  }
}
```

Dev without build:

```json
{
  "mcpServers": {
    "agent-debug": {
      "command": "pnpm",
      "args": ["--filter", "@personai/agent-debug", "dev:mcp"],
      "env": {
        "AGENT_DEBUG_URL": "http://127.0.0.1:8790"
      }
    }
  }
}
```

Build MCP entry once: `pnpm --filter @personai/agent-debug build`.

### Tools (debug path)

| Tool | Purpose |
|------|---------|
| `agent_debug_poll` | Pending composed prompts + raw pending messages |
| `agent_debug_ack` | Mark batch/message consumed |
| `agent_debug_status` | Queue depth, `awaiting_more`, last activity |
| `agent_debug_compose_now` | Force flush open batches |

Resource: `agent-debug://inbox`

### Agent habit (MCP fallback)

Tell the agent (or add a user rule / Automation) when SDK dispatch is not armed:

> When I say I’m on the balcony or using agent-debug, call `agent_debug_poll` at the start of the turn, act on ready prompts, then `agent_debug_ack`.

Optional: a Cursor Automation/hook that reminds the agent to poll — still requires an agent turn; nothing injects into chat by itself.

## REST (LAN)

Auth header when `AGENT_DEBUG_TOKEN` is set: `Authorization: Bearer …` or `X-Agent-Debug-Token`.

| Method | Path | Notes |
|--------|------|-------|
| GET | `/health` | No auth |
| GET | `/v1/status` | Queue snapshot (+ SDK dispatch flags) |
| GET | `/v1/pending` | Ready prompts + open batches |
| POST | `/v1/messages` | `{ text, sessionId?, urgent?, sendNow? }` |
| POST | `/v1/upload` | multipart `file`(+), `text`, `urgent`, `sendNow` |
| POST | `/v1/compose-now` | Force compose |
| POST | `/v1/ack` | `{ batchIds?, messageIds? }` |

## Batching

- Phrases like “wait for…”, “second message”, “coming next” → `awaiting_more`
- Default timeout **90s** (`AGENT_DEBUG_BATCH_TIMEOUT_MS`)
- “send now” / UI **Send now** / MCP `agent_debug_compose_now` flushes
- Delivering images after a “wait for pictures…” hold also flushes
- Light Ollama model composes one prompt (`AGENT_DEBUG_COMPOSE_MODEL`) using `compose/system-prompts.ts`
