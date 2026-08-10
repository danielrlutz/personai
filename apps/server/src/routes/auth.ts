import type { FastifyInstance } from "fastify";
import {
  changeProfilePassword,
  getProfileById,
  loginProfile,
  sealProfileIfIdle,
  setupProfilePassword,
  toPublicProfile,
} from "../profiles/registry.js";
import {
  createSession,
  revokeSession,
} from "../auth/session.js";
import { getRequestSession, getRequestToken } from "../auth/middleware.js";
import { sendError } from "./helpers.js";

function publicSafeError(err: unknown, fallback: string): string {
  const message = err instanceof Error ? err.message : String(err);
  // Never echo anything that might look like a password material.
  if (/password/i.test(message) && /invalid|incorrect|must be|already set|not set|too long/i.test(message)) {
    return message;
  }
  if (/Unlock keys missing|emergency-reset|sealed database|profiles\.json/i.test(message)) {
    return message;
  }
  if (/not found|required|Authentication|Profile/i.test(message)) {
    return message;
  }
  return fallback;
}

export async function registerAuthRoutes(app: FastifyInstance): Promise<void> {
  app.post<{ Body: { profileId?: string; password?: string } }>("/auth/login", async (req, reply) => {
    try {
      const profileId = req.body?.profileId?.trim();
      const password = req.body?.password;
      if (!profileId || typeof password !== "string") {
        return reply.status(400).send({ error: "profileId and password are required" });
      }

      const profile = getProfileById(profileId);
      if (!profile) {
        return reply.status(404).send({ error: "Profile not found" });
      }
      const pub = toPublicProfile(profile);
      if (pub.needsCryptoRestore) {
        return reply.status(409).send({
          error:
            "Unlock keys missing from profiles.json for a sealed database. " +
            "Restore a backup, or run scripts/emergency-reset-profile-crypto.sh",
          code: "CRYPTO_RESTORE_REQUIRED",
        });
      }
      if (!pub.hasPassword) {
        return reply.status(400).send({
          error: "Password not set. Complete setup first.",
          code: "PASSWORD_SETUP_REQUIRED",
        });
      }

      await loginProfile(profileId, password);
      const token = createSession(profileId);
      return {
        token,
        profile: toPublicProfile(getProfileById(profileId)!),
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (message === "Invalid password") {
        return reply.status(401).send({ error: "Invalid password", code: "INVALID_PASSWORD" });
      }
      if (/Unlock keys missing/i.test(message)) {
        return reply.status(409).send({
          error: publicSafeError(err, "Unlock keys missing"),
          code: "CRYPTO_RESTORE_REQUIRED",
        });
      }
      return reply.status(400).send({ error: publicSafeError(err, "Login failed") });
    }
  });

  /** Migration / first-run: set password when the profile has none. */
  app.post<{ Body: { profileId?: string; password?: string } }>("/auth/setup", async (req, reply) => {
    try {
      const profileId = req.body?.profileId?.trim();
      const password = req.body?.password;
      if (!profileId || typeof password !== "string") {
        return reply.status(400).send({ error: "profileId and password are required" });
      }
      const existing = getProfileById(profileId);
      if (existing && toPublicProfile(existing).needsCryptoRestore) {
        return reply.status(409).send({
          error:
            "Unlock keys missing for a sealed database. Restore profiles.json or run " +
            "scripts/emergency-reset-profile-crypto.sh before setting a new password.",
          code: "CRYPTO_RESTORE_REQUIRED",
        });
      }
      const publicProfile = await setupProfilePassword(profileId, password);
      const token = createSession(profileId);
      return { token, profile: publicProfile };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (/Unlock keys missing|Sealed database exists/i.test(message)) {
        return reply.status(409).send({
          error: publicSafeError(err, "Crypto restore required"),
          code: "CRYPTO_RESTORE_REQUIRED",
        });
      }
      return reply.status(400).send({ error: publicSafeError(err, "Setup failed") });
    }
  });

  app.post("/auth/logout", async (req, reply) => {
    try {
      const session = getRequestSession(req);
      const token = getRequestToken(req);
      revokeSession(token);
      if (session) {
        await sealProfileIfIdle(session.profileId);
      }
      return { ok: true };
    } catch (err) {
      return sendError(reply, err);
    }
  });

  app.get("/auth/session", async (req, reply) => {
    const session = getRequestSession(req);
    if (!session) {
      return reply.status(401).send({ error: "Not authenticated", code: "AUTH_REQUIRED" });
    }
    const profile = getProfileById(session.profileId);
    if (!profile) {
      return reply.status(401).send({ error: "Session profile missing", code: "AUTH_REQUIRED" });
    }
    return {
      profile: toPublicProfile(profile),
      expiresAt: session.expiresAt,
    };
  });

  app.post<{ Body: { currentPassword?: string; newPassword?: string } }>(
    "/auth/password/change",
    async (req, reply) => {
      try {
        const session = getRequestSession(req);
        if (!session) {
          return reply.status(401).send({ error: "Authentication required", code: "AUTH_REQUIRED" });
        }
        const currentPassword = req.body?.currentPassword;
        const newPassword = req.body?.newPassword;
        if (typeof currentPassword !== "string" || typeof newPassword !== "string") {
          return reply.status(400).send({ error: "currentPassword and newPassword are required" });
        }
        const profile = await changeProfilePassword(session.profileId, currentPassword, newPassword);
        return { profile };
      } catch (err) {
        return reply.status(400).send({ error: publicSafeError(err, "Password change failed") });
      }
    },
  );

}
