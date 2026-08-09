import type { FastifyReply, FastifyRequest } from "fastify";
import { getRequestSession } from "../auth/middleware.js";
import { getPrisma } from "../db/prisma-singleton.js";
import { publicErrorMessage } from "../lib/safe-data.js";
import { requireProfileId } from "../profiles/registry.js";

/**
 * SSE hijacks the raw socket — @fastify/cors never runs on the 200 response.
 * Echo Origin (and mirror allowed request headers) so phone/MagicDNS :3000 → :4000
 * and https://HOST → :8443 streams are not opaque "Failed to fetch" CORS failures.
 */
export function sseStart(reply: FastifyReply, request: FastifyRequest): void {
  reply.hijack();
  const headers: Record<string, string> = {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  };
  const origin = request.headers.origin;
  if (typeof origin === "string" && origin) {
    headers["Access-Control-Allow-Origin"] = origin;
    headers["Vary"] = "Origin";
    // Match apps/server cors allowedHeaders — some clients re-check on the stream response.
    headers["Access-Control-Allow-Headers"] =
      "Content-Type, Accept, X-Profile-Id, Authorization";
  }
  reply.raw.writeHead(200, headers);
}

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
  const code = (err as { statusCode?: number } | null)?.statusCode;
  const httpStatus = typeof code === "number" && code >= 400 && code < 600 ? code : status;
  return reply.status(httpStatus).send({ error: publicErrorMessage(err) });
}

export function sseWrite(reply: FastifyReply, event: string, data: unknown) {
  reply.raw.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}
