import type { FastifyReply, FastifyRequest } from "fastify";

/** SSE hijacks the raw socket — @fastify/cors never runs, so echo Origin for cross-port clients. */
export function sseStart(reply: FastifyReply, request: FastifyRequest): void {
  reply.hijack();
  const headers: Record<string, string> = {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
  };
  const origin = request.headers.origin;
  if (typeof origin === "string" && origin) {
    headers["Access-Control-Allow-Origin"] = origin;
    headers["Vary"] = "Origin";
  }
  reply.raw.writeHead(200, headers);
}
import { requireProfileId } from "../profiles/registry.js";
import { getPrisma } from "../db/prisma-singleton.js";
import { getRequestSession } from "../auth/middleware.js";

/** Prefer authenticated session profile; never trust bare X-Profile-Id alone on protected routes. */
export function getProfileId(request: FastifyRequest): string {
  const session = getRequestSession(request);
  if (session?.profileId) return session.profileId;

  const header = request.headers["x-profile-id"];
  return requireProfileId(typeof header === "string" ? header : undefined);
}

export async function withPrisma(request: FastifyRequest) {
  const profileId = getProfileId(request);
  const prisma = await getPrisma(profileId);
  return { profileId, prisma };
}

export function sendError(reply: FastifyReply, err: unknown, status = 400) {
  const message = err instanceof Error ? err.message : String(err);
  return reply.status(status).send({ error: message });
}

export function sseWrite(reply: FastifyReply, event: string, data: unknown) {
  reply.raw.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}
