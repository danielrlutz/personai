import type { FastifyInstance } from "fastify";
import { ensureBusinessCategoryShells } from "../db/prisma-singleton.js";
import {
  collectMemoryDistillCandidates,
  queueMemoryDistillConfirmations,
} from "../memory/distill.js";
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
      const { prisma } = await withPrisma(req);
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
}
