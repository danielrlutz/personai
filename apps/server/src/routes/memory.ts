import type { FastifyInstance } from "fastify";
import { ensureCeoProfile } from "../memory/user-care.js";
import { sendError, withPrisma } from "./helpers.js";

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
      locale?: string | null;
      language?: string | null;
      timezone?: string | null;
      briefHour?: string | null;
      notes?: string | null;
    };
  }>("/ceo-profile", async (req, reply) => {
    try {
      const { prisma } = await withPrisma(req);
      await ensureCeoProfile(prisma);
      const body = req.body ?? {};
      const trimOrNull = (v: string | null | undefined) => {
        if (v === undefined) return undefined;
        if (v === null) return null;
        const t = v.trim();
        return t.length ? t : null;
      };
      const updated = await prisma.ceoProfile.update({
        where: { id: "default" },
        data: {
          ...(body.displayName !== undefined ? { displayName: trimOrNull(body.displayName) } : {}),
          ...(body.company !== undefined ? { company: trimOrNull(body.company) } : {}),
          ...(body.locale !== undefined ? { locale: trimOrNull(body.locale) } : {}),
          ...(body.language !== undefined ? { language: trimOrNull(body.language) } : {}),
          ...(body.timezone !== undefined ? { timezone: trimOrNull(body.timezone) } : {}),
          ...(body.briefHour !== undefined ? { briefHour: trimOrNull(body.briefHour) } : {}),
          ...(body.notes !== undefined ? { notes: trimOrNull(body.notes) } : {}),
        },
      });
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
}
