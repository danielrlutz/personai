# Agent Debug — phone inbox → Cursor MCP

Dev chat UI (messages + images) that batches your balcony/phone notes into **one Cursor-ready prompt**, then exposes them to the Cursor agent over **MCP**.

This does **not** auto-inject into Cursor chat. The agent must call `agent_debug_poll` (e.g. when you say you’re on the balcony, or at the start of turns).

## Paths

| Piece | Path |
|-------|------|
| App | `apps/agent-debug` |
| HTTP API + UI | port **8790** (`HOST=0.0.0.0`) |
| MCP stdio | `apps/agent-debug/src/mcp/index.ts` → `dist/mcp/index.js` |
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
export AGENT_DEBUG_VPS_HOST=debi9.tail8175e6.ts.net
```

Pull the light compose model once:

```bash
ollama pull llama3.1:8b
```

## Run on debi9 (phone via Tailscale)

```bash
cd /etc/personaios   # or your clone
# set in .env (no secrets committed):
#   AGENT_DEBUG_TOKEN=...
#   AGENT_DEBUG_VPS_HOST=debi9.tail8175e6.ts.net
#   AGENT_DEBUG_COMPOSE_MODEL=llama3.1:8b

docker compose --profile agent-debug up -d --build agent-debug
curl -sS http://127.0.0.1:8790/health
```

Phone (Tailscale MagicDNS FQDN preferred):

```text
http://debi9.tail8175e6.ts.net:8790
```

Paste `AGENT_DEBUG_TOKEN` into the UI Token field. Attach/paste images; say “wait for pictures in my second message” to hold the batch, or tap **Send now**.

## MCP in Cursor

Project snippet — `.cursor/mcp.json` (or Cursor Settings → MCP):

```json
{
  "mcpServers": {
    "agent-debug": {
      "command": "node",
      "args": [
        "C:/Users/danie/OneDrive/source/personai-os/apps/agent-debug/dist/mcp/index.js"
      ],
      "env": {
        "AGENT_DEBUG_URL": "http://127.0.0.1:8790",
        "AGENT_DEBUG_TOKEN": ""
      }
    }
  }
}
```

On Linux / debi9 host MCP (if Cursor runs there):

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

### Tools

| Tool | Purpose |
|------|---------|
| `agent_debug_poll` | Pending composed prompts + raw pending messages |
| `agent_debug_ack` | Mark batch/message consumed |
| `agent_debug_status` | Queue depth, `awaiting_more`, last activity |
| `agent_debug_compose_now` | Force flush open batches |

Resource: `agent-debug://inbox`

### Agent habit

Tell the agent (or add a user rule / Automation):

> When I say I’m on the balcony or using agent-debug, call `agent_debug_poll` at the start of the turn, act on ready prompts, then `agent_debug_ack`.

Optional: a Cursor Automation/hook that reminds the agent to poll — still requires an agent turn; nothing injects into chat by itself.

## REST (LAN)

Auth header when `AGENT_DEBUG_TOKEN` is set: `Authorization: Bearer …` or `X-Agent-Debug-Token`.

| Method | Path | Notes |
|--------|------|-------|
| GET | `/health` | No auth |
| GET | `/v1/status` | Queue snapshot |
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
- Light Ollama model composes one prompt (`AGENT_DEBUG_COMPOSE_MODEL`)
