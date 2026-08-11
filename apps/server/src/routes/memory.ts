import type { FastifyInstance } from "fastify";
import { ensureBusinessCategoryShells } from "../db/prisma-singleton.js";
import {
  collectMemoryDistillCandidates,
  queueMemoryDistillConfirmations,
} from "../memory/distill.js";
import { searchMemorySnippets } from "../memory/rag-lite.js";
import {
  correctionsStatus,
  listCorrections,
  queueStagingBulletProposal,
  recordStagingEdit,
  recordTeamRemember,
} from "../memory/corrections.js";
import {
  STAGING_DOCS,
  STAGING_TOTAL_INJECT_BUDGET,
  isStagingDocId,
  listStagingDocs,
  loadStagingForPrompt,
  readStagingDoc,
  writeStagingDoc,
} from "../memory/staging.js";
import { ensureCeoProfile } from "../memory/user-care.js";
import { sendError, withPrisma } from "./helpers.js";

const USAGE_MODES = new Set(["PERSONAL", "BUSINESS", "BOTH"]);

export async function registerMemoryRoutes(app: FastifyInstance): Promise<void> {
  app.get("/ceo-profile", async (req, reply) => {
    try {
      const { prisma } = await withPrisma(req);
      return await ensureCeoProfile(prisma);
    } catch (err) {
      return sendError(reply, err);
    }
  });

  app.put<{
    Body: {
      displayName?: string | null;
      company?: string | null;
      usageMode?: "PERSONAL" | "BUSINESS" | "BOTH";
      locale?: string | null;
      language?: string | null;
      timezone?: string | null;
      briefHour?: string | null;
      notes?: string | null;
      dashboardLayout?: string | null;
    };
  }>("/ceo-profile", async (req, reply) => {
    try {
      const { prisma } = await withPrisma(req);
      await ensureCeoProfile(prisma);
      const body = req.body ?? {};
      if (body.usageMode !== undefined && !USAGE_MODES.has(body.usageMode)) {
        return reply.status(400).send({ error: "usageMode must be PERSONAL, BUSINESS, or BOTH" });
      }
      const trimOrNull = (v: string | null | undefined) => {
        if (v === undefined) return undefined;
        if (v === null) return null;
        const t = v.trim();
        return t.length ? t : null;
      };
      let dashboardLayout: string | null | undefined = undefined;
      if (body.dashboardLayout !== undefined) {
        if (body.dashboardLayout === null || body.dashboardLayout === "") {
          dashboardLayout = null;
        } else if (typeof body.dashboardLayout === "string") {
          try {
            const parsed = JSON.parse(body.dashboardLayout) as unknown;
            if (!parsed || typeof parsed !== "object" || !Array.isArray((parsed as { widgets?: unknown }).widgets)) {
              return reply.status(400).send({ error: "dashboardLayout must be JSON with widgets[]" });
            }
            dashboardLayout = JSON.stringify(parsed);
          } catch {
            return reply.status(400).send({ error: "dashboardLayout must be valid JSON" });
          }
        } else {
          return reply.status(400).send({ error: "dashboardLayout must be a JSON string" });
        }
      }
      const updated = await prisma.ceoProfile.update({
        where: { id: "default" },
        data: {
          ...(body.displayName !== undefined ? { displayName: trimOrNull(body.displayName) } : {}),
          ...(body.company !== undefined ? { company: trimOrNull(body.company) } : {}),
          ...(body.usageMode !== undefined ? { usageMode: body.usageMode } : {}),
          ...(body.locale !== undefined ? { locale: trimOrNull(body.locale) } : {}),
          ...(body.language !== undefined ? { language: trimOrNull(body.language) } : {}),
          ...(body.timezone !== undefined ? { timezone: trimOrNull(body.timezone) } : {}),
          ...(body.briefHour !== undefined ? { briefHour: trimOrNull(body.briefHour) } : {}),
          ...(body.notes !== undefined ? { notes: trimOrNull(body.notes) } : {}),
          ...(dashboardLayout !== undefined ? { dashboardLayout } : {}),
        },
      });
      // Opt-in only: empty business category shells when user enables business — never legal/MWST tasks.
      if (updated.usageMode === "BUSINESS" || updated.usageMode === "BOTH") {
        await ensureBusinessCategoryShells(prisma);
      }
      return updated;
    } catch (err) {
      return sendError(reply, err);
    }
  });

  app.get("/memory-facts", async (req, reply) => {
    try {
      const { prisma } = await withPrisma(req);
      const facts = await prisma.memoryFact.findMany({
        orderBy: { updatedAt: "desc" },
      });
      return { facts };
    } catch (err) {
      return sendError(reply, err);
    }
  });

  app.post<{
    Body: {
      key: string;
      value: string;
      source?: string;
      specialistId?: string;
    };
  }>("/memory-facts", async (req, reply) => {
    try {
      const { prisma, profileId } = await withPrisma(req);
      const key = req.body?.key?.trim();
      const value = req.body?.value?.trim();
      if (!key) return reply.status(400).send({ error: "key is required" });
      if (!value) return reply.status(400).send({ error: "value is required" });
      if (key.length > 120) return reply.status(400).send({ error: "key too long" });
      if (value.length > 2000) return reply.status(400).send({ error: "value too long" });

      const fact = await prisma.memoryFact.upsert({
        where: { key },
        create: {
          key,
          value,
          source: req.body.source?.trim() || "user",
          specialistId: req.body.specialistId?.trim() || null,
        },
        update: {
          value,
          source: req.body.source?.trim() || "user",
          specialistId: req.body.specialistId?.trim() || null,
        },
      });
      await recordTeamRemember({
        profileId,
        key,
        value,
        source: req.body.source?.trim() || "user",
        specialistId: req.body.specialistId?.trim() || null,
      }).catch(() => undefined);
      return fact;
    } catch (err) {
      return sendError(reply, err);
    }
  });

  app.delete<{ Params: { id: string } }>("/memory-facts/:id", async (req, reply) => {
    try {
      const { prisma } = await withPrisma(req);
      await prisma.memoryFact.delete({ where: { id: req.params.id } });
      return { ok: true };
    } catch (err) {
      return sendError(reply, err, 404);
    }
  });

  /** Scan recent chats for durable-looking facts; queue confirm-gated promotions. */
  app.post<{
    Body: { sessionId?: string; queue?: boolean };
  }>("/memory-facts/distill", async (req, reply) => {
    try {
      const { prisma } = await withPrisma(req);
      const candidates = await collectMemoryDistillCandidates(prisma, {
        sessionId: req.body?.sessionId?.trim() || undefined,
      });
      if (req.body?.queue === false) {
        return { candidates, queued: 0, confirmations: [] };
      }
      const { queued, confirmations } = await queueMemoryDistillConfirmations(
        prisma,
        candidates,
      );
      return {
        candidates,
        queued,
        confirmations,
        message:
          queued > 0
            ? `${queued} memory promotion(s) waiting under Needs your confirmation.`
            : "No new durable facts found in recent chats.",
      };
    } catch (err) {
      return sendError(reply, err);
    }
  });

  /** Personality vault — OpenClaw-style staging markdown under profile memory/. */
  app.get("/staging", async (req, reply) => {
    try {
      const { profileId } = await withPrisma(req);
      const docs = await listStagingDocs(profileId);
      const prompt = await loadStagingForPrompt(profileId);
      return {
        docs,
        inject: {
          totalBudget: STAGING_TOTAL_INJECT_BUDGET,
          totalInjected: prompt.totalInjected,
          slices: prompt.slices.map((s) => ({
            id: s.id,
            filename: s.filename,
            charCount: s.charCount,
            truncated: s.truncated,
          })),
        },
        catalog: STAGING_DOCS.map((d) => ({
          id: d.id,
          filename: d.filename,
          title: d.title,
          description: d.description,
          injectBudget: d.injectBudget,
          maxChars: d.maxChars,
        })),
      };
    } catch (err) {
      return sendError(reply, err);
    }
  });

  app.get<{ Querystring: { q?: string; limit?: string } }>("/staging/search", async (req, reply) => {
    try {
      const { prisma, profileId } = await withPrisma(req);
      const q = (req.query?.q ?? "").trim();
      if (!q) return reply.status(400).send({ error: "q is required" });
      const limit = req.query?.limit ? Number(req.query.limit) : 8;
      const snippets = await searchMemorySnippets(prisma, profileId, {
        query: q,
        limit: Number.isFinite(limit) ? limit : 8,
      });
      return { query: q, snippets };
    } catch (err) {
      return sendError(reply, err);
    }
  });

  app.get<{ Params: { docId: string } }>("/staging/:docId", async (req, reply) => {
    try {
      const { profileId } = await withPrisma(req);
      const docId = req.params.docId.trim();
      if (!isStagingDocId(docId)) {
        return reply.status(404).send({
          error: `Unknown staging doc. Use: ${STAGING_DOCS.map((d) => d.id).join(", ")}`,
        });
      }
      return await readStagingDoc(profileId, docId);
    } catch (err) {
      return sendError(reply, err);
    }
  });

  app.put<{ Params: { docId: string }; Body: { content?: string } }>(
    "/staging/:docId",
    async (req, reply) => {
      try {
        const { profileId } = await withPrisma(req);
        const docId = req.params.docId.trim();
        if (!isStagingDocId(docId)) {
          return reply.status(404).send({
            error: `Unknown staging doc. Use: ${STAGING_DOCS.map((d) => d.id).join(", ")}`,
          });
        }
        if (typeof req.body?.content !== "string") {
          return reply.status(400).send({ error: "content string is required" });
        }
        const before = await readStagingDoc(profileId, docId);
        const saved = await writeStagingDoc(profileId, docId, req.body.content);
        await recordStagingEdit({
          profileId,
          docId,
          beforeContent: before.content,
          afterContent: saved.content,
        }).catch(() => undefined);
        return saved;
      } catch (err) {
        return sendError(reply, err);
      }
    },
  );

  /** Recent local correction log — Settings → About you learning strip. */
  app.get("/corrections", async (req, reply) => {
    try {
      const { profileId } = await withPrisma(req);
      return await correctionsStatus(profileId);
    } catch (err) {
      return sendError(reply, err);
    }
  });

  app.get<{ Querystring: { limit?: string; kind?: string } }>(
    "/corrections/recent",
    async (req, reply) => {
      try {
        const { profileId } = await withPrisma(req);
        const limit = req.query?.limit ? Number(req.query.limit) : 20;
        const kind = req.query?.kind?.trim() || undefined;
        const corrections = await listCorrections(profileId, {
          limit: Number.isFinite(limit) ? limit : 20,
          kind: kind as
            | "naming.patch"
            | "confirm.reject"
            | "reinspect.flag"
            | "drive.prefer_folder"
            | "staging.edit"
            | "team.remember"
            | undefined,
        });
        return { corrections };
      } catch (err) {
        return sendError(reply, err);
      }
    },
  );

  /**
   * Explicit "Remember this" from a correction — queues confirm-gated staging bullet
   * (preferences.md / ADHD.md). Never silent-writes the vault.
   */
  app.post<{
    Body: {
      docId?: "preferences" | "ADHD";
      bullet?: string;
      reason?: string;
      correctionId?: string;
    };
  }>("/corrections/remember", async (req, reply) => {
    try {
      const { prisma } = await withPrisma(req);
      const docId = req.body?.docId === "ADHD" ? "ADHD" : "preferences";
      const bullet = String(req.body?.bullet ?? "").trim();
      if (!bullet) return reply.status(400).send({ error: "bullet is required" });
      const out = await queueStagingBulletProposal(prisma, {
        docId,
        bullet,
        reason: req.body?.reason,
        sourceCorrectionId: req.body?.correctionId ?? null,
      });
      return {
        ...out,
        message: out.queued
          ? "Queued under Needs your confirmation (Remember for later)."
          : out.reason,
      };
    } catch (err) {
      return sendError(reply, err);
    }
  });
}
