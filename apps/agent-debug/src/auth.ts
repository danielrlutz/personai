import type { FastifyReply, FastifyRequest } from "fastify";
import { config } from "./config.js";

export function extractToken(req: FastifyRequest): string | null {
  const header = req.headers["x-agent-debug-token"];
  if (typeof header === "string" && header.trim()) return header.trim();
  const auth = req.headers.authorization;
  if (typeof auth === "string") {
    const m = auth.match(/^Bearer\s+(.+)$/i);
    if (m?.[1]) return m[1].trim();
  }
  const q = (req.query as { token?: string } | undefined)?.token;
  if (typeof q === "string" && q.trim()) return q.trim();
  return null;
}

export async function requireToken(
  req: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  if (!config.token) return;
  // Public: health + static UI shell (API still protected).
  const url = req.url.split("?")[0] ?? "";
  if (
    url === "/health" ||
    url === "/" ||
    url === "/index.html" ||
    url.startsWith("/styles.css") ||
    url.startsWith("/app.js") ||
    url.startsWith("/favicon")
  ) {
    return;
  }
  const got = extractToken(req);
  if (got !== config.token) {
    await reply.code(401).send({
      error: "unauthorized",
      hint: "Authorization: Bearer <AGENT_DEBUG_TOKEN> or X-Agent-Debug-Token",
    });
  }
}
