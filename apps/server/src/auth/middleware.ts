import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { extractBearerToken, resolveSession, type SessionRecord } from "./session.js";

export type AuthedRequest = FastifyRequest & {
  authSession?: SessionRecord;
  authToken?: string;
};

const PUBLIC_EXACT = new Set([
  "/health",
  "/profiles",
  "/auth/login",
  "/auth/setup",
]);

/** Read-only probes — no profile data; keeps status chips honest before/without a session. */
const PUBLIC_GET_EXACT = new Set(["/ollama/health"]);

const PUBLIC_PREFIXES = ["/auth/login", "/auth/setup"];

function normalizePath(url: string): string {
  const pathOnly = url.split("?")[0] ?? url;
  if (pathOnly.length > 1 && pathOnly.endsWith("/")) {
    return pathOnly.slice(0, -1);
  }
  return pathOnly;
}

export function isPublicRoute(method: string, url: string): boolean {
  if (method === "OPTIONS") return true;
  const path = normalizePath(url);
  if (PUBLIC_EXACT.has(path)) return true;
  if (method === "GET" && PUBLIC_GET_EXACT.has(path)) return true;
  return PUBLIC_PREFIXES.some((p) => path === p);
}

export function getRequestSession(request: FastifyRequest): SessionRecord | null {
  return (request as AuthedRequest).authSession ?? null;
}

export function getRequestToken(request: FastifyRequest): string | null {
  return (request as AuthedRequest).authToken ?? null;
}

export async function registerAuthHook(app: FastifyInstance): Promise<void> {
  app.addHook("onRequest", async (request: FastifyRequest, reply: FastifyReply) => {
    if (isPublicRoute(request.method, request.url)) return;

    const token = extractBearerToken(request.headers.authorization);
    const session = resolveSession(token);
    if (!session || !token) {
      return reply.status(401).send({
        error: "Authentication required. Sign in with your profile password.",
        code: "AUTH_REQUIRED",
      });
    }

    (request as AuthedRequest).authSession = session;
    (request as AuthedRequest).authToken = token;

    // Profile-scoped routes: header must match session when present.
    const header = request.headers["x-profile-id"];
    if (typeof header === "string" && header && header !== session.profileId) {
      return reply.status(403).send({
        error: "X-Profile-Id does not match the authenticated session.",
        code: "PROFILE_MISMATCH",
      });
    }
  });
}
