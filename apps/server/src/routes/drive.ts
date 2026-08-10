import type { FastifyInstance } from "fastify";
import {
  buildOauthConsentUrl,
  completeOauthLink,
  driveStatus,
  exchangeOauthCode,
  getWebAppBaseUrl,
  preferTaxonomyFolderForever,
  scanTaxonomyHealth,
  verifyDriveConnection,
} from "../archive/drive.js";
import {
  clearDriveOauthStore,
  consumeOauthPending,
  createOauthPending,
  readDriveOauthStore,
  writeDriveOauthStore,
  writeDrivePrefs,
} from "../archive/drive-oauth-store.js";
import { getArchiveContextMeta, refreshArchiveContext } from "../archive/init-context.js";
import {
  enqueueDriveKnowledgeReindexForProfile,
  getDriveKnowledgeStatus,
} from "../archive/drive-knowledge/index.js";
import { getActiveProfileId, getPrisma } from "../db/prisma-singleton.js";
import { getRequestSession } from "../auth/middleware.js";
import { sendError, withPrisma, getProfileId } from "./helpers.js";

export async function registerDriveRoutes(app: FastifyInstance): Promise<void> {
  app.get("/archive/drive", async (req) => {
    const profileId = getRequestSession(req)?.profileId ?? getActiveProfileId();
    const status = driveStatus(profileId);
    let archiveContext = {
      ready: false,
      refreshedAt: null as string | null,
      indexPreview: null as string | null,
    };
    const knowledge = getDriveKnowledgeStatus(profileId);
    try {
      if (profileId) {
        const { prisma } = await withPrisma(req);
        archiveContext = await getArchiveContextMeta(prisma);
      }
    } catch {
      // Locked / no session — status-only is fine.
    }
    return { ...status, archiveContext, knowledge };
  });

  app.post("/archive/drive/verify", async (req, reply) => {
    try {
      const profileId = getProfileId(req);
      return await verifyDriveConnection(profileId);
    } catch (err) {
      return sendError(reply, err);
    }
  });

  app.post<{ Body: { returnTo?: string } }>("/archive/drive/oauth/start", async (req, reply) => {
    try {
      const profileId = getProfileId(req);
      const status = driveStatus(profileId);
      if (!status.canStartOauth) {
        return reply.status(400).send({
          error:
            "OAuth is not available on this server. Set GOOGLE_OAUTH_CLIENT_ID and GOOGLE_OAUTH_CLIENT_SECRET (and GOOGLE_OAUTH_REDIRECT_URI), or configure a service account.",
          code: "OAUTH_NOT_CONFIGURED",
          status,
        });
      }
      const returnTo =
        typeof req.body?.returnTo === "string" && req.body.returnTo.startsWith("http")
          ? req.body.returnTo
          : `${getWebAppBaseUrl()}/settings/?drive=linked`;
      const state = createOauthPending(profileId, returnTo);
      const url = buildOauthConsentUrl(state);
      return {
        url,
        redirectUri: status.oauthRedirectUri,
        state,
      };
    } catch (err) {
      return sendError(reply, err);
    }
  });

  /** Google redirects here (public). State carries the profile binding. */
  app.get<{ Querystring: { code?: string; state?: string; error?: string } }>(
    "/archive/drive/oauth/callback",
    async (req, reply) => {
      const fail = (message: string) => {
        const dest = `${getWebAppBaseUrl()}/settings/?drive=error&message=${encodeURIComponent(message)}`;
        return reply.redirect(dest);
      };
      try {
        if (req.query.error) {
          return fail(`Google denied access: ${req.query.error}`);
        }
        const code = req.query.code?.trim();
        const state = req.query.state?.trim();
        if (!code || !state) return fail("Missing OAuth code or state.");
        const pending = consumeOauthPending(state);
        if (!pending) return fail("OAuth link expired. Try Link Google Drive again.");

        const tokens = await exchangeOauthCode(code);
        await completeOauthLink({
          profileId: pending.profileId,
          refreshToken: tokens.refreshToken,
          accessToken: tokens.accessToken,
        });

        // Best-effort content init (may no-op if Ollama down / DB sealed).
        try {
          const prisma = await getPrisma(pending.profileId);
          await refreshArchiveContext(prisma, pending.profileId);
        } catch {
          // User can hit Refresh archive context in Settings.
        }

        const dest = pending.returnTo.includes("?")
          ? `${pending.returnTo}&drive=linked`
          : `${pending.returnTo}?drive=linked`;
        return reply.redirect(dest);
      } catch (err) {
        return fail(err instanceof Error ? err.message : String(err));
      }
    },
  );

  app.post("/archive/drive/unlink", async (req, reply) => {
    try {
      const profileId = getProfileId(req);
      clearDriveOauthStore(profileId);
      return { ok: true, ...driveStatus(profileId) };
    } catch (err) {
      return sendError(reply, err);
    }
  });

  app.put<{ Body: { rootFolderId?: string | null } }>("/archive/drive/prefs", async (req, reply) => {
    try {
      const profileId = getProfileId(req);
      const root =
        req.body?.rootFolderId === undefined || req.body.rootFolderId === null
          ? null
          : String(req.body.rootFolderId).trim() || null;
      writeDrivePrefs(profileId, { rootFolderId: root });
      const oauth = readDriveOauthStore(profileId);
      if (oauth?.refreshToken) {
        writeDriveOauthStore(profileId, { ...oauth, rootFolderId: root });
      }
      return driveStatus(profileId);
    } catch (err) {
      return sendError(reply, err);
    }
  });

  app.post("/archive/drive/refresh-context", async (req, reply) => {
    try {
      const profileId = getProfileId(req);
      const { prisma } = await withPrisma(req);
      const status = driveStatus(profileId);
      if (!status.enabled && !status.linked) {
        return reply.status(400).send({
          error: status.message,
          code: "DRIVE_NOT_LINKED",
          status,
        });
      }
      const result = await refreshArchiveContext(prisma, profileId);
      return {
        ...result,
        status: driveStatus(profileId),
        knowledge: getDriveKnowledgeStatus(profileId),
      };
    } catch (err) {
      return sendError(reply, err);
    }
  });


  /**
   * Reindex everything under the configured Drive root into the private local
   * knowledge store (Ollama embeddings when available + FTS). Not Gemini.
   */
  app.post("/archive/drive/reindex-knowledge", async (req, reply) => {
    try {
      const profileId = getProfileId(req);
      const { prisma } = await withPrisma(req);
      const status = driveStatus(profileId);
      if (!status.enabled && !status.linked) {
        return reply.status(400).send({
          error: status.message,
          code: "DRIVE_NOT_LINKED",
          status,
        });
      }
      if (!status.rootFolderId) {
        return reply.status(400).send({
          error: "Set a Drive root folder ID in Settings before reindexing.",
          code: "DRIVE_ROOT_REQUIRED",
          status,
        });
      }
      const { jobId, stats } = await enqueueDriveKnowledgeReindexForProfile(
        prisma,
        profileId,
      );
      return {
        ok: true,
        jobId,
        message:
          "Drive knowledge reindex queued. Private local index under your profile data dir — not Google Gemini API.",
        stats,
        knowledge: getDriveKnowledgeStatus(profileId),
        status: driveStatus(profileId),
      };
    } catch (err) {
      return sendError(reply, err);
    }
  });

  app.get("/archive/drive/knowledge", async (req, reply) => {
    try {
      const profileId = getProfileId(req);
      return {
        knowledge: getDriveKnowledgeStatus(profileId),
        status: driveStatus(profileId),
      };
    } catch (err) {
      return sendError(reply, err);
    }
  });

  /** Scan archive root for duplicate taxonomy folders (never deletes). */
  app.get("/archive/drive/taxonomy-health", async (req, reply) => {
    try {
      const profileId = getProfileId(req);
      const status = driveStatus(profileId);
      if (!status.enabled && !status.linked) {
        return reply.status(400).send({
          error: status.message,
          code: "DRIVE_NOT_LINKED",
          status,
        });
      }
      return await scanTaxonomyHealth(profileId);
    } catch (err) {
      return sendError(reply, err);
    }
  });

  /** Cache a preferred folder for a category forever (never deletes Drive folders). */
  app.post<{ Body: { category?: number; folderId?: string } }>(
    "/archive/drive/taxonomy-health/prefer",
    async (req, reply) => {
      try {
        const profileId = getProfileId(req);
        const status = driveStatus(profileId);
        if (!status.enabled && !status.linked) {
          return reply.status(400).send({
            error: status.message,
            code: "DRIVE_NOT_LINKED",
            status,
          });
        }
        const category = Number(req.body?.category);
        const folderId = typeof req.body?.folderId === "string" ? req.body.folderId : "";
        return await preferTaxonomyFolderForever({ profileId, category, folderId });
      } catch (err) {
        return sendError(reply, err);
      }
    },
  );
}
