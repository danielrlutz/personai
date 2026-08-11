# @personai/agent-debug

Mobile-first dark chat UI + Fastify API that batches phone messages/images into Cursor-ready prompts via a light Ollama model, exposed to Cursor through an MCP stdio server.

See **[docs/AGENT-DEBUG.md](../../docs/AGENT-DEBUG.md)** for Tailscale/debi9, MCP config, and agent polling habits.

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
| `dev:mcp` | MCP stdio (tsx) |
| `build` | compile + copy `public/` |
| `start` | `node dist/index.js` |
| `test` | batching unit checks |
