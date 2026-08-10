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
  dryRunCombineFolders,
  listCombineFolders,
  prepareCombineFoldersExecute,
  type CombineConflictAction,
  type CombineExecuteRequest,
  type CombineFileDecision,
} from "../archive/folder-combine.js";
import {
  clearDriveOauthStore,
  consumeOauthPending,
  createOauthPending,
  readDriveOauthStore,
  writeDriveOauthStore,
  writeDrivePrefs,
} from "../archive/drive-oauth-store.js";
import { getArchiveContextMeta, refreshArchiveContext } from "../archive/init-context.js";
import { getActiveProfileId, getPrisma } from "../db/prisma-singleton.js";
import {
  enqueueServerJob,
  SERVER_JOB_DRIVE_COMBINE,
} from "../jobs/server-jobs.js";
import { getRequestSession } from "../auth/middleware.js";
import { sendError, withPrisma, getProfileId } from "./helpers.js";

function requireDriveLinked(profileId: string, reply: { status: (code: number) => { send: (body: unknown) => unknown } }) {
  const status = driveStatus(profileId);
  if (!status.enabled && !status.linked) {
    return {
      blocked: true as const,
      response: reply.status(400).send({
        error: status.message,
        code: "DRIVE_NOT_LINKED",
        status,
      }),
      status,
    };
  }
  return { blocked: false as const, status };
}

function parseCombineDecisions(raw: unknown): Record<string, CombineFileDecision> {
  if (!raw || typeof raw !== "object") return {};
  const out: Record<string, CombineFileDecision> = {};
  for (const [fileId, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!fileId || !value || typeof value !== "object") continue;
    const action = (value as { action?: string }).action;
    if (
      action !== "keep_destination" &&
      action !== "keep_incoming" &&
      action !== "keep_both" &&
      action !== "skip"
    ) {
      continue;
    }
    const decision: CombineFileDecision = { action: action as CombineConflictAction };
    if ((value as { trashOther?: unknown }).trashOther === true) {
      decision.trashOther = true;
    }
    out[fileId] = decision;
  }
  return out;
}

export async function registerDriveRoutes(app: FastifyInstance): Promise<void> {
  app.get("/archive/drive", async (req) => {
    const profileId = getRequestSession(req)?.profileId ?? getActiveProfileId();
    const status = driveStatus(profileId);
    let archiveContext = {
      ready: false,
      refreshedAt: null as string | null,
      indexPreview: null as string | null,
    };
    try {
      if (profileId) {
        const { prisma } = await withPrisma(req);
        archiveContext = await getArchiveContextMeta(prisma);
      }
    } catch {
      // Locked / no session — status-only is fine.
    }
    return { ...status, archiveContext };
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
      return { ...result, status: driveStatus(profileId) };
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

  /** Folder map for manual combine (archive-root children). */
  app.get("/archive/drive/combine/folders", async (req, reply) => {
    try {
      const profileId = getProfileId(req);
      const gate = requireDriveLinked(profileId, reply);
      if (gate.blocked) return gate.response;
      return await listCombineFolders(profileId);
    } catch (err) {
      return sendError(reply, err);
    }
  });

  /** Dry-run: list moves + Explorer-style name conflicts (no Drive writes). */
  app.post<{
    Body: { destinationFolderId?: string; sourceFolderIds?: string[] };
  }>("/archive/drive/combine/dry-run", async (req, reply) => {
    try {
      const profileId = getProfileId(req);
      const gate = requireDriveLinked(profileId, reply);
      if (gate.blocked) return gate.response;
      const destinationFolderId =
        typeof req.body?.destinationFolderId === "string" ? req.body.destinationFolderId : "";
      const sourceFolderIds = Array.isArray(req.body?.sourceFolderIds)
        ? req.body.sourceFolderIds.filter((id): id is string => typeof id === "string")
        : [];
      return await dryRunCombineFolders(profileId, { destinationFolderId, sourceFolderIds });
    } catch (err) {
      return sendError(reply, err);
    }
  });

  /**
   * Execute combine as a durable ServerJob.
   * Never trashes/deletes unless per-file trashOther or empty-folder confirm flags are set.
   */
  app.post<{ Body: CombineExecuteRequest }>("/archive/drive/combine/execute", async (req, reply) => {
    try {
      const profileId = getProfileId(req);
      const gate = requireDriveLinked(profileId, reply);
      if (gate.blocked) return gate.response;

      const body: CombineExecuteRequest = {
        destinationFolderId:
          typeof req.body?.destinationFolderId === "string" ? req.body.destinationFolderId : "",
        sourceFolderIds: Array.isArray(req.body?.sourceFolderIds)
          ? req.body.sourceFolderIds.filter((id): id is string => typeof id === "string")
          : [],
        dryRunAt: typeof req.body?.dryRunAt === "string" ? req.body.dryRunAt : "",
        decisions: parseCombineDecisions(req.body?.decisions),
        removeEmptySourceFolders: req.body?.removeEmptySourceFolders === true,
        iUnderstandRemoveEmptySourceFolders: req.body?.iUnderstandRemoveEmptySourceFolders === true,
      };

      const prepared = await prepareCombineFoldersExecute(profileId, body);
      const { prisma } = await withPrisma(req);
      const job = await enqueueServerJob(prisma, {
        type: SERVER_JOB_DRIVE_COMBINE,
        payload: prepared.payload,
      });

      await prisma.auditLog.create({
        data: {
          action: "archive.drive_combine_enqueue",
          entity: "ServerJob",
          entityId: job.id,
          metadata: JSON.stringify({
            destinationFolderId: prepared.payload.destinationFolderId,
            sourceFolderIds: prepared.payload.sourceFolderIds,
            moveCount: prepared.preview.moveCount,
            conflictCount: prepared.preview.conflictCount,
            removeEmptySourceFolders: prepared.payload.removeEmptySourceFolders,
          }),
        },
      });

      return {
        ok: true as const,
        jobId: job.id,
        message: prepared.message,
        preview: {
          moveCount: prepared.preview.moveCount,
          conflictCount: prepared.preview.conflictCount,
          destination: prepared.preview.destination,
          sources: prepared.preview.sources,
        },
      };
    } catch (err) {
      return sendError(reply, err);
    }
  });
}
