import type { FastifyInstance } from "fastify";
import { createConfirmation } from "../confirm/confirm-service.js";
import { config } from "../config.js";
import { resolveProductConfig } from "../settings/host-vault.js";
import { ARCHIVE_TAXONOMY } from "../specialists/roster.js";
import { sendError, withPrisma } from "./helpers.js";
import { ingestionEvents } from "../ollama/ingestion-worker.js";

function monthKey(d = new Date()): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

async function getPremiumUsage(prisma: Awaited<ReturnType<typeof withPrisma>>["prisma"]) {
  const quota = resolveProductConfig().premiumMonthlyQuota;
  const key = `premium.usage.${monthKey()}`;
  const row = await prisma.setting.findUnique({ where: { key } });
  const used = row ? Number(JSON.parse(row.value).used ?? 0) : 0;
  return { key, used, quota, remaining: Math.max(0, quota - used) };
}

export async function registerOpsRoutes(app: FastifyInstance): Promise<void> {
  app.get("/activity", async (req, reply) => {
    try {
      const { prisma } = await withPrisma(req);
      const take = Math.min(200, Number((req.query as { limit?: string }).limit ?? 80) || 80);
      const logs = await prisma.auditLog.findMany({
        orderBy: { createdAt: "desc" },
        take,
      });
      return {
        logs: logs.map((l) => ({
          ...l,
          metadata: l.metadata ? safeJson(l.metadata) : null,
        })),
      };
    } catch (err) {
      return sendError(reply, err);
    }
  });

  app.get("/search", async (req, reply) => {
    try {
      const { prisma } = await withPrisma(req);
      const q = String((req.query as { q?: string }).q ?? "")
        .trim()
        .toLowerCase();
      if (!q || q.length < 2) {
        return { q, documents: [], transactions: [], tasks: [], confirmations: [], facts: [] };
      }

      const [documents, transactions, tasks, confirmations, facts] = await Promise.all([
        prisma.document.findMany({
          where: {
            OR: [
              { filename: { contains: q } },
              { archiveName: { contains: q } },
            ],
          },
          orderBy: { uploadedAt: "desc" },
          take: 20,
        }),
        prisma.transaction.findMany({
          where: { description: { contains: q } },
          orderBy: { date: "desc" },
          take: 20,
        }),
        prisma.legalTask.findMany({
          where: {
            OR: [{ title: { contains: q } }, { description: { contains: q } }],
          },
          orderBy: { dueDate: "asc" },
          take: 20,
        }),
        prisma.pendingConfirmation.findMany({
          where: {
            status: "pending",
            OR: [{ summary: { contains: q } }, { action: { contains: q } }],
          },
          orderBy: { createdAt: "desc" },
          take: 10,
        }),
        prisma.memoryFact.findMany({
          where: {
            OR: [{ key: { contains: q } }, { value: { contains: q } }],
          },
          orderBy: { updatedAt: "desc" },
          take: 15,
        }),
      ]);

      return { q, documents, transactions, tasks, confirmations, facts };
    } catch (err) {
      return sendError(reply, err);
    }
  });

  app.get("/archive/library", async (req, reply) => {
    try {
      const { prisma } = await withPrisma(req);
      const query = req.query as {
        category?: string;
        type?: string;
        q?: string;
        confirmed?: string;
      };
      const category = query.category ? Number(query.category) : undefined;
      const confirmedOnly = query.confirmed === "1" || query.confirmed === "true";
      const q = (query.q ?? "").trim();

      const documents = await prisma.document.findMany({
        where: {
          ...(category && !Number.isNaN(category) ? { archiveCategory: category } : {}),
          ...(query.type ? { documentType: query.type as never } : {}),
          ...(confirmedOnly ? { confirmedAt: { not: null } } : {}),
          ...(q
            ? {
                OR: [
                  { filename: { contains: q } },
                  { archiveName: { contains: q } },
                ],
              }
            : {}),
        },
        orderBy: { uploadedAt: "desc" },
        take: 150,
        include: {
          jobs: { orderBy: { createdAt: "desc" }, take: 1 },
        },
      });

      return { documents, taxonomy: ARCHIVE_TAXONOMY };
    } catch (err) {
      return sendError(reply, err);
    }
  });

  app.get("/fristen", async (req, reply) => {
    try {
      const { prisma } = await withPrisma(req);
      const includeDone = String((req.query as { includeDone?: string }).includeDone ?? "") === "1";
      const now = new Date();
      const [tasks, docs] = await Promise.all([
        prisma.legalTask.findMany({
          where: includeDone
            ? {}
            : { status: { in: ["TODO", "IN_PROGRESS", "BLOCKED"] } },
          orderBy: { dueDate: "asc" },
        }),
        prisma.document.findMany({
          where: { deadline: { not: null } },
          orderBy: { deadline: "asc" },
          take: 80,
        }),
      ]);

      const items = [
        ...tasks.map((t) => ({
          id: `task:${t.id}`,
          kind: "legal_task" as const,
          sourceId: t.id,
          title: t.title,
          description: t.description,
          dueDate: t.dueDate,
          status: t.status,
          overdue: Boolean(t.dueDate && t.dueDate < now && t.status !== "DONE"),
        })),
        ...docs
          .filter((d) => d.deadline)
          .map((d) => ({
            id: `doc:${d.id}`,
            kind: "document" as const,
            sourceId: d.id,
            title: d.archiveName || d.filename,
            description: `Archive category ${d.archiveCategory ?? "—"}`,
            dueDate: d.deadline,
            status: d.confirmedAt ? "FILED" : "STAGED",
            overdue: Boolean(d.deadline && d.deadline < now),
          })),
      ].sort((a, b) => {
        const ad = a.dueDate ? new Date(a.dueDate).getTime() : Number.MAX_SAFE_INTEGER;
        const bd = b.dueDate ? new Date(b.dueDate).getTime() : Number.MAX_SAFE_INTEGER;
        return ad - bd;
      });

      return { items };
    } catch (err) {
      return sendError(reply, err);
    }
  });

  app.post<{ Params: { id: string } }>("/fristen/tasks/:id/done", async (req, reply) => {
    try {
      const { prisma } = await withPrisma(req);
      const task = await prisma.legalTask.update({
        where: { id: req.params.id },
        data: { status: "DONE", completedAt: new Date() },
      });
      await prisma.auditLog.create({
        data: {
          action: "fristen.done",
          entity: "LegalTask",
          entityId: task.id,
          metadata: JSON.stringify({ title: task.title }),
        },
      });
      return task;
    } catch (err) {
      return sendError(reply, err);
    }
  });

  app.get("/finance/transactions/export.csv", async (req, reply) => {
    try {
      const { prisma } = await withPrisma(req);
      const transactions = await prisma.transaction.findMany({
        orderBy: { date: "desc" },
        include: { category: true },
        take: 5000,
      });
      const header = "date,type,amount,currency,description,category,id\n";
      const rows = transactions
        .map((t) => {
          const cells = [
            t.date.toISOString().slice(0, 10),
            t.type,
            String(t.amount),
            t.currency,
            csvEscape(t.description),
            csvEscape(t.category?.name ?? ""),
            t.id,
          ];
          return cells.join(",");
        })
        .join("\n");
      await prisma.auditLog.create({
        data: {
          action: "finance.csv_export",
          entity: "Transaction",
          metadata: JSON.stringify({ count: transactions.length }),
        },
      });
      reply.header("Content-Type", "text/csv; charset=utf-8");
      reply.header(
        "Content-Disposition",
        `attachment; filename="personai-ledger-${new Date().toISOString().slice(0, 10)}.csv"`,
      );
      return reply.send(header + rows + (rows ? "\n" : ""));
    } catch (err) {
      return sendError(reply, err);
    }
  });

  app.post<{ Params: { id: string } }>("/ingest/jobs/:id/retry", async (req, reply) => {
    try {
      const { profileId, prisma } = await withPrisma(req);
      const job = await prisma.ingestionJob.findUnique({ where: { id: req.params.id } });
      if (!job) return reply.status(404).send({ error: "Job not found" });
      if (job.status !== "FAILED") {
        return reply.status(400).send({ error: "Only failed jobs can be retried" });
      }
      const updated = await prisma.ingestionJob.update({
        where: { id: job.id },
        data: {
          status: "QUEUED",
          errorMessage: null,
          pausedReason: null,
          startedAt: null,
          completedAt: null,
        },
      });
      await prisma.auditLog.create({
        data: {
          action: "ingest.retry",
          entity: "IngestionJob",
          entityId: job.id,
          metadata: JSON.stringify({ documentId: job.documentId }),
        },
      });
      ingestionEvents.emit("queue", { profileId });
      return updated;
    } catch (err) {
      return sendError(reply, err);
    }
  });

  app.get("/usage/premium", async (req, reply) => {
    try {
      const { prisma } = await withPrisma(req);
      const usage = await getPremiumUsage(prisma);
      const product = resolveProductConfig();
      return {
        provider: "ollama-local",
        localDefault: true,
        premiumProvider: product.premiumProvider,
        premiumKeyConfigured: Boolean(product.premiumApiKey),
        month: monthKey(),
        used: usage.used,
        quota: usage.quota,
        remaining: usage.remaining,
        tier: config.licenseTier,
      };
    } catch (err) {
      return sendError(reply, err);
    }
  });

  app.post<{ Body: { reason?: string; confirmed?: boolean } }>(
    "/usage/premium/request",
    async (req, reply) => {
      try {
        const { prisma } = await withPrisma(req);
        const usage = await getPremiumUsage(prisma);
        if (usage.remaining <= 0) {
          return reply.status(402).send({
            error: "Premium monthly quota exhausted",
            code: "PREMIUM_QUOTA",
            usage,
          });
        }
        if (!req.body?.confirmed) {
          const confirmation = await createConfirmation(prisma, {
            action: "premium.inference",
            summary: `Use 1 premium/cloud inference (${usage.remaining} of ${usage.quota} left this month)`,
            entity: "PremiumUsage",
            payload: {
              reason: req.body?.reason ?? "manual",
              month: monthKey(),
            },
          });
          return reply.status(202).send({
            needsConfirm: true,
            confirmation,
            usage,
            message: "Confirm before spending premium quota.",
          });
        }
        return { ok: true, usage };
      } catch (err) {
        return sendError(reply, err);
      }
    },
  );

  app.post<{
    Body: {
      title: string;
      start: string;
      end?: string;
      description?: string;
      confirmed?: boolean;
    };
  }>("/calendar/events/propose", async (req, reply) => {
    try {
      const { prisma } = await withPrisma(req);
      const title = req.body?.title?.trim();
      const start = req.body?.start;
      if (!title || !start) {
        return reply.status(400).send({ error: "title and start are required" });
      }
      if (!req.body.confirmed) {
        const confirmation = await createConfirmation(prisma, {
          action: "calendar.event",
          summary: `Create calendar event: ${title} @ ${start.slice(0, 16)}`,
          entity: "CalendarEvent",
          payload: {
            title,
            start,
            end: req.body.end ?? null,
            description: req.body.description ?? null,
          },
        });
        return reply.status(202).send({
          needsConfirm: true,
          confirmation,
          message: "Confirm before writing to Google Calendar (or local staging).",
        });
      }
      return { ok: true };
    } catch (err) {
      return sendError(reply, err);
    }
  });

  app.get("/calendar/status", async (req, reply) => {
    try {
      const { prisma } = await withPrisma(req);
      const row = await prisma.setting.findUnique({ where: { key: "google.calendar.connected" } });
      const connected = row ? Boolean(JSON.parse(row.value).connected) : false;
      return {
        connected,
        note: connected
          ? "Calendar connect flag set — event writes still require confirmation."
          : "Not connected. Use Settings → Google to connect Calendar (OAuth same client as Drive).",
      };
    } catch (err) {
      return sendError(reply, err);
    }
  });

  app.put<{ Body: { connected: boolean } }>("/calendar/status", async (req, reply) => {
    try {
      const { prisma } = await withPrisma(req);
      const connected = Boolean(req.body?.connected);
      await prisma.setting.upsert({
        where: { key: "google.calendar.connected" },
        create: { key: "google.calendar.connected", value: JSON.stringify({ connected }) },
        update: { value: JSON.stringify({ connected }) },
      });
      await prisma.auditLog.create({
        data: {
          action: connected ? "calendar.connect" : "calendar.disconnect",
          entity: "Setting",
          metadata: JSON.stringify({ connected }),
        },
      });
      return { connected };
    } catch (err) {
      return sendError(reply, err);
    }
  });
}

function safeJson(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}

function csvEscape(value: string): string {
  if (/[",\n\r]/.test(value)) return `"${value.replace(/"/g, '""')}"`;
  return value;
}
