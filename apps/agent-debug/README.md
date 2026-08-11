# @personai/agent-debug

Mobile-first PersonAI chat UI + Fastify API that batches phone messages/images into Cursor-ready prompts via a light Ollama model.

**Delivery:** Cursor SDK dispatcher when `CURSOR_API_KEY` is set; **MCP poll** remains the debug/fallback path.

See **[docs/AGENT-DEBUG.md](../../docs/AGENT-DEBUG.md)** for architecture layers, Tailscale phone URL, MCP config, and Phase 2 SDK notes.

## Quick start

```bash
pnpm --filter @personai/agent-debug dev
```

- UI/API: `http://0.0.0.0:8790`
- Health: `GET /health`
- Pending: `GET /v1/pending`

```bash
pnpm --filter @personai/agent-debug build
pnpm --filter @personai/agent-debug start:mcp
```

## Scripts

| Script | |
|--------|--|
| `dev` | HTTP server + UI (tsx watch) |
| `dev:mcp` | MCP stdio (tsx) — debug/fallback path |
| `build` | compile + copy `public/` |
| `start` | `node dist/index.js` |
| `test` | batching unit checks |
