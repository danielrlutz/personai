import type { FastifyReply, FastifyRequest } from "fastify";
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
