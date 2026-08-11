#!/usr/bin/env node
/**
 * MCP stdio server — debug / fallback delivery path.
 *
 * Primary delivery (when CURSOR_API_KEY is set) is the SDK bridge in
 * `src/dispatch/cursor-sdk-bridge.ts`. Keep these tools for inbox inspection,
 * manual poll/ack, and environments without an API key.
 *
 * Env:
 *   AGENT_DEBUG_URL   default http://127.0.0.1:8790
 *   AGENT_DEBUG_TOKEN optional shared token
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

const baseUrl = (process.env.AGENT_DEBUG_URL || "http://127.0.0.1:8790").replace(
  /\/$/,
  "",
);
const token = (process.env.AGENT_DEBUG_TOKEN || "").trim();

function headers(json = false): Record<string, string> {
  const h: Record<string, string> = {};
  if (json) h["content-type"] = "application/json";
  if (token) {
    h.Authorization = `Bearer ${token}`;
    h["X-Agent-Debug-Token"] = token;
  }
  return h;
}

async function api<T>(
  method: string,
  path: string,
  body?: unknown,
): Promise<T> {
  const res = await fetch(`${baseUrl}${path}`, {
    method,
    headers: headers(body !== undefined),
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`${method} ${path} → ${res.status}: ${text.slice(0, 400)}`);
  }
  return text ? (JSON.parse(text) as T) : ({} as T);
}

function asText(data: unknown) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }],
  };
}

const server = new McpServer({
  name: "agent-debug",
  version: "0.1.0",
});

server.registerTool(
  "agent_debug_poll",
  {
    title: "Poll agent-debug inbox",
    description:
      "Return pending composed Cursor prompts and raw pending messages from the phone/balcony agent-debug inbox. Call at the start of turns when the user is on the balcony / using agent-debug.",
    inputSchema: z.object({}),
  },
  async () => {
    const pending = await api<unknown>("GET", "/v1/pending");
    const status = await api<unknown>("GET", "/v1/status");
    return asText({ status, pending, polledAt: new Date().toISOString() });
  },
);

server.registerTool(
  "agent_debug_ack",
  {
    title: "Ack agent-debug items",
    description:
      "Mark composed prompt batches and/or messages as consumed after you have acted on them.",
    inputSchema: z.object({
      batchIds: z.array(z.string()).optional(),
      messageIds: z.array(z.string()).optional(),
      batchId: z.string().optional(),
      messageId: z.string().optional(),
    }),
  },
  async (args) => {
    const result = await api<unknown>("POST", "/v1/ack", args);
    return asText(result);
  },
);

server.registerTool(
  "agent_debug_status",
  {
    title: "Agent-debug queue status",
    description:
      "Queue depth, awaiting_more batches, last activity, and model config.",
    inputSchema: z.object({}),
  },
  async () => asText(await api<unknown>("GET", "/v1/status")),
);

server.registerTool(
  "agent_debug_compose_now",
  {
    title: "Force flush / compose batch",
    description:
      "Force-flush open batches (or one batchId) through the Ollama compose worker into Cursor-ready prompts.",
    inputSchema: z.object({
      batchId: z.string().optional(),
      sessionId: z.string().optional(),
    }),
  },
  async (args) => asText(await api<unknown>("POST", "/v1/compose-now", args)),
);

server.registerResource(
  "inbox",
  "agent-debug://inbox",
  {
    title: "Agent-debug inbox",
    description: "Live pending prompts + open batches from agent-debug",
    mimeType: "application/json",
  },
  async () => {
    const pending = await api<unknown>("GET", "/v1/pending");
    return {
      contents: [
        {
          uri: "agent-debug://inbox",
          mimeType: "application/json",
          text: JSON.stringify(pending, null, 2),
        },
      ],
    };
  },
);

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
