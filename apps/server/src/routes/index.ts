import type { FastifyInstance } from "fastify";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { renderToBuffer } from "@react-pdf/renderer";
import React from "react";
import { createProfile, listProfiles, switchProfile, getActiveProfile } from "../profiles/registry.js";
import { config, profileExportsDir, profileUploadsDir } from "../config.js";
import {
  ollamaHealth,
  resolveOllamaHost,
  streamChat,
  chatCompletion,
  setOllamaHostOverride,
  probeOllamaHost,
} from "../ollama/client.js";
import { vramLock } from "../ollama/vram-lock.js";
import { ingestionEvents } from "../ollama/ingestion-worker.js";
import {
  getOrCreateTodayBriefing,
  regenerateBriefing,
  streamBriefingNarrative,
} from "../briefing/briefing-service.js";
import { buildPersonalTodaySummary, startOfDay } from "../life/life-service.js";
import { MedicalReportDocument } from "../export/medical-report.js";
import { getPrisma } from "../db/prisma-singleton.js";
import { sendError, sseWrite, withPrisma, getProfileId } from "./helpers.js";

export async function registerRoutes(app: FastifyInstance): Promise<void> {
  app.get("/health", async () => ({
    ok: true,
    service: "personai-server",
    tier: config.licenseTier,
    activeProfileId: getActiveProfile()?.id ?? null,
  }));

  app.get("/ollama/health", async () => {
    const health = await ollamaHealth();
    return { ...health, vram: vramLock.getState() };
  });

  /** Set Ollama base URL for this API process (in-memory; prefer OLLAMA_HOST in .env for persistence). */
  app.put<{ Body: { host: string } }>("/ollama/host", async (req, reply) => {
    const raw = req.body?.host?.trim();
    if (!raw) return reply.status(400).send({ error: "host is required" });
    let parsed: URL;
    try {
      parsed = new URL(raw);
    } catch {
      return reply.status(400).send({ error: "Invalid URL" });
    }
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return reply.status(400).send({ error: "host must be http(s)" });
    }
    const host = raw.replace(/\/$/, "");
    const reachable = await probeOllamaHost(host, 3000);
    setOllamaHostOverride(host);
    const health = await ollamaHealth();
    return {
      ...health,
      reachable,
      vram: vramLock.getState(),
      note: reachable
        ? "Ollama host updated for this process. Set OLLAMA_HOST in .env to persist across restarts."
        : "Saved host, but /api/tags was not reachable yet. If the API runs in Docker and Ollama is native, use http://host.docker.internal:11434.",
    };
  });

  // Profiles
  app.get("/profiles", async () => listProfiles());

  app.post<{ Body: { name: string; avatar?: string } }>("/profiles", async (req, reply) => {
    try {
      const profile = await createProfile(req.body.name, req.body.avatar);
      return profile;
    } catch (err) {
      return sendError(reply, err);
    }
  });

  app.post<{ Body: { profileId: string } }>("/profiles/switch", async (req, reply) => {
    try {
      const profile = await switchProfile(req.body.profileId);
      return profile;
    } catch (err) {
      return sendError(reply, err, 404);
    }
  });

  // Ingest
  app.post("/ingest/upload", async (req, reply) => {
    try {
      const profileId = getProfileId(req);
      const prisma = await getPrisma(profileId);
      const file = await req.file();
      if (!file) return reply.status(400).send({ error: "No file uploaded" });

      const documentId = randomUUID();
      const uploadsRoot = profileUploadsDir(profileId);
      const dir = path.join(uploadsRoot, documentId);
      fs.mkdirSync(dir, { recursive: true });
      const ext = path.extname(file.filename) || ".bin";
      const storagePath = path.join(dir, `original${ext}`);
      const buffer = await file.toBuffer();
      await fsp.writeFile(storagePath, buffer);

      const document = await prisma.document.create({
        data: {
          id: documentId,
          filename: file.filename,
          mimeType: file.mimetype,
          storagePath,
          fileSize: buffer.length,
        },
      });

      const host = await resolveOllamaHost();
      const job = await prisma.ingestionJob.create({
        data: {
          documentId: document.id,
          status: "QUEUED",
          ollamaModel: config.visionModel,
          ollamaHost: host,
        },
      });

      await prisma.auditLog.create({
        data: {
          action: "document.upload",
          entity: "Document",
          entityId: document.id,
          metadata: JSON.stringify({ filename: file.filename }),
        },
      });

      ingestionEvents.emit("queue", { profileId });
      return { document, job };
    } catch (err) {
      return sendError(reply, err);
    }
  });

  app.get("/ingest/queue", async (req, reply) => {
    try {
      const { prisma } = await withPrisma(req);
      const jobs = await prisma.ingestionJob.findMany({
        orderBy: { createdAt: "desc" },
        take: 50,
        include: { document: true },
      });
      return { jobs, vram: vramLock.getState() };
    } catch (err) {
      return sendError(reply, err);
    }
  });

  app.get("/ingest/queue/stream", async (req, reply) => {
    try {
      getProfileId(req);
      reply.raw.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      });

      const send = async () => {
        try {
          const { prisma } = await withPrisma(req);
          const jobs = await prisma.ingestionJob.findMany({
            orderBy: { createdAt: "desc" },
            take: 50,
            include: { document: true },
          });
          sseWrite(reply, "queue", { jobs, vram: vramLock.getState() });
        } catch {
          // ignore
        }
      };

      await send();
      const onChange = () => void send();
      ingestionEvents.on("queue", onChange);
      vramLock.on("change", onChange);

      req.raw.on("close", () => {
        ingestionEvents.off("queue", onChange);
        vramLock.off("change", onChange);
      });
    } catch (err) {
      return sendError(reply, err);
    }
  });

  // Finance
  app.get("/finance/budget", async (req, reply) => {
    try {
      const { prisma } = await withPrisma(req);
      const categories = await prisma.budgetCategory.findMany({ include: { transactions: true } });
      const monthStart = new Date();
      monthStart.setDate(1);
      monthStart.setHours(0, 0, 0, 0);

      const overview = categories.map((c) => {
        const spent = c.transactions
          .filter((t) => t.type === "EXPENSE" && t.date >= monthStart)
          .reduce((s, t) => s + t.amount, 0);
        return {
          id: c.id,
          name: c.name,
          monthlyLimit: c.monthlyLimit,
          color: c.color,
          spent,
          // null when unused — category monthlyLimit shells are templates, not remaining cash
          remaining: spent > 0 ? (c.monthlyLimit ?? 0) - spent : null,
        };
      });
      return { categories: overview };
    } catch (err) {
      return sendError(reply, err);
    }
  });

  app.get("/finance/qr-bills", async (req, reply) => {
    try {
      const { prisma } = await withPrisma(req);
      const bills = await prisma.qRBill.findMany({ orderBy: { dueDate: "asc" } });
      return { bills };
    } catch (err) {
      return sendError(reply, err);
    }
  });

  app.post<{
    Body: {
      creditorName: string;
      iban: string;
      amount: number;
      currency?: string;
      reference?: string;
      dueDate?: string;
      notes?: string;
    };
  }>("/finance/qr-bills", async (req, reply) => {
    try {
      const { prisma } = await withPrisma(req);
      const bill = await prisma.qRBill.create({
        data: {
          creditorName: req.body.creditorName,
          iban: req.body.iban,
          amount: req.body.amount,
          currency: req.body.currency ?? "CHF",
          reference: req.body.reference,
          dueDate: req.body.dueDate ? new Date(req.body.dueDate) : null,
          notes: req.body.notes,
        },
      });
      return bill;
    } catch (err) {
      return sendError(reply, err);
    }
  });

  app.patch<{ Params: { id: string }; Body: { status?: "PENDING" | "PAID" | "OVERDUE" | "CANCELLED" } }>(
    "/finance/qr-bills/:id",
    async (req, reply) => {
      try {
        const { prisma } = await withPrisma(req);
        const bill = await prisma.qRBill.update({
          where: { id: req.params.id },
          data: {
            status: req.body.status,
            paidAt: req.body.status === "PAID" ? new Date() : undefined,
          },
        });
        return bill;
      } catch (err) {
        return sendError(reply, err);
      }
    },
  );

  app.get("/finance/transactions", async (req, reply) => {
    try {
      const { prisma } = await withPrisma(req);
      const transactions = await prisma.transaction.findMany({
        orderBy: { date: "desc" },
        include: { category: true },
        take: 200,
      });
      return { transactions };
    } catch (err) {
      return sendError(reply, err);
    }
  });

  app.post<{
    Body: {
      type: "INCOME" | "EXPENSE" | "TRANSFER";
      amount: number;
      description: string;
      date?: string;
      categoryId?: string;
      currency?: string;
    };
  }>("/finance/transactions", async (req, reply) => {
    try {
      const { prisma } = await withPrisma(req);
      const tx = await prisma.transaction.create({
        data: {
          type: req.body.type,
          amount: req.body.amount,
          description: req.body.description,
          date: req.body.date ? new Date(req.body.date) : new Date(),
          categoryId: req.body.categoryId,
          currency: req.body.currency ?? "CHF",
        },
      });
      return tx;
    } catch (err) {
      return sendError(reply, err);
    }
  });

  // Legal
  app.get("/legal/tasks", async (req, reply) => {
    try {
      const { prisma } = await withPrisma(req);
      const tasks = await prisma.legalTask.findMany({ orderBy: { dueDate: "asc" } });
      return { tasks };
    } catch (err) {
      return sendError(reply, err);
    }
  });

  app.post<{
    Body: {
      title: string;
      description?: string;
      type: "TAX" | "FILING" | "CONTRACT" | "REVIEW" | "DEADLINE" | "COMPLIANCE" | "OTHER";
      dueDate?: string;
      status?: "TODO" | "IN_PROGRESS" | "DONE" | "BLOCKED";
    };
  }>("/legal/tasks", async (req, reply) => {
    try {
      const { prisma } = await withPrisma(req);
      const task = await prisma.legalTask.create({
        data: {
          title: req.body.title,
          description: req.body.description,
          type: req.body.type,
          dueDate: req.body.dueDate ? new Date(req.body.dueDate) : null,
          status: req.body.status ?? "TODO",
        },
      });
      return task;
    } catch (err) {
      return sendError(reply, err);
    }
  });

  app.patch<{
    Params: { id: string };
    Body: { status?: "TODO" | "IN_PROGRESS" | "DONE" | "BLOCKED"; title?: string };
  }>("/legal/tasks/:id", async (req, reply) => {
    try {
      const { prisma } = await withPrisma(req);
      const task = await prisma.legalTask.update({
        where: { id: req.params.id },
        data: {
          status: req.body.status,
          title: req.body.title,
          completedAt: req.body.status === "DONE" ? new Date() : undefined,
        },
      });
      return task;
    } catch (err) {
      return sendError(reply, err);
    }
  });

  // Medical
  app.get("/medical/complaints", async (req, reply) => {
    try {
      const { prisma } = await withPrisma(req);
      const complaints = await prisma.complaintLog.findMany({
        orderBy: { occurredAt: "desc" },
        include: { analyses: true },
      });
      return { complaints };
    } catch (err) {
      return sendError(reply, err);
    }
  });

  app.post<{
    Body: {
      category: "PHYSICAL" | "PSYCHOLOGICAL" | "BOTH";
      title: string;
      description: string;
      bodyRegion?: string;
      severity?: "MILD" | "MODERATE" | "SEVERE";
      moodScore?: number;
      sleepHours?: number;
      triggers?: string[];
      occurredAt?: string;
    };
  }>("/medical/complaints", async (req, reply) => {
    try {
      const { prisma } = await withPrisma(req);
      const complaint = await prisma.complaintLog.create({
        data: {
          category: req.body.category,
          title: req.body.title,
          description: req.body.description,
          bodyRegion: req.body.bodyRegion,
          severity: req.body.severity ?? "MILD",
          moodScore: req.body.moodScore,
          sleepHours: req.body.sleepHours,
          triggers: req.body.triggers ? JSON.stringify(req.body.triggers) : null,
          occurredAt: req.body.occurredAt ? new Date(req.body.occurredAt) : new Date(),
        },
      });
      return complaint;
    } catch (err) {
      return sendError(reply, err);
    }
  });

  app.post<{ Body: { complaintId: string } }>("/medical/analyze", async (req, reply) => {
    try {
      const { prisma } = await withPrisma(req);
      const complaint = await prisma.complaintLog.findUnique({
        where: { id: req.body.complaintId },
      });
      if (!complaint) return reply.status(404).send({ error: "Complaint not found" });

      const host = await resolveOllamaHost();
      const frameworks = [
        {
          framework: "WESTERN" as const,
          prompt: `Analysiere die folgende Beschwerde aus westlich-medizinischer Sicht. Antworte als JSON mit hypotheses, patterns, recommendations. Keine Diagnose.\n\n${JSON.stringify(complaint)}`,
        },
        {
          framework: "EASTERN" as const,
          prompt: `Analysiere die folgende Beschwerde aus östlich-ganzheitlicher Sicht (TCM/Ayurveda-ähnlich). Antworte als JSON mit hypotheses, patterns, recommendations. Keine Diagnose.\n\n${JSON.stringify(complaint)}`,
        },
      ];

      const results = [];
      for (const fw of frameworks) {
        const release = await vramLock.acquire("REASONING");
        try {
          const result = await chatCompletion({
            host,
            model: config.reasoningModel,
            messages: [
              {
                role: "system",
                content:
                  "Du bist ein vorsichtiger Analyseassistent. Keine Diagnose. Immer auf Konsultation eines Arztes hinweisen.",
              },
              { role: "user", content: fw.prompt },
            ],
          });
          const analysis = await prisma.medicalAnalysis.create({
            data: {
              complaintId: complaint.id,
              framework: fw.framework,
              ollamaModel: config.reasoningModel,
              prompt: fw.prompt,
              result,
            },
          });
          results.push(analysis);
        } finally {
          await release();
        }
      }
      return { analyses: results };
    } catch (err) {
      return sendError(reply, err);
    }
  });

  app.post<{
    Body: {
      title: string;
      dateRangeFrom: string;
      dateRangeTo: string;
      complaintIds: string[];
      analysisIds?: string[];
    };
  }>("/medical/export", async (req, reply) => {
    try {
      const { profileId, prisma } = await withPrisma(req);
      const profile = getActiveProfile();
      const complaints = await prisma.complaintLog.findMany({
        where: { id: { in: req.body.complaintIds } },
        orderBy: { occurredAt: "asc" },
      });
      const analyses = await prisma.medicalAnalysis.findMany({
        where: {
          id: { in: req.body.analysisIds ?? [] },
        },
      });

      const exportRec = await prisma.medicalExport.create({
        data: {
          title: req.body.title,
          dateRangeFrom: new Date(req.body.dateRangeFrom),
          dateRangeTo: new Date(req.body.dateRangeTo),
          complaintIds: JSON.stringify(req.body.complaintIds),
          analysisIds: JSON.stringify(req.body.analysisIds ?? []),
          status: "DRAFT",
        },
      });

      const pdfData = {
        profileName: profile?.name ?? "Patient",
        title: req.body.title,
        dateFrom: req.body.dateRangeFrom.slice(0, 10),
        dateTo: req.body.dateRangeTo.slice(0, 10),
        complaints: complaints.map((c) => ({
          title: c.title,
          category: c.category,
          severity: c.severity,
          description: c.description,
          occurredAt: c.occurredAt.toISOString().slice(0, 10),
          moodScore: c.moodScore,
          sleepHours: c.sleepHours,
        })),
        analyses: analyses.map((a) => ({
          framework: a.framework,
          result: a.result,
          disclaimer: a.disclaimer,
        })),
      };

      const doc = React.createElement(MedicalReportDocument, { data: pdfData });
      const buffer = await renderToBuffer(doc as Parameters<typeof renderToBuffer>[0]);

      const exportsDir = profileExportsDir(profileId);
      fs.mkdirSync(exportsDir, { recursive: true });
      const storagePath = path.join(exportsDir, `${exportRec.id}.pdf`);
      await fsp.writeFile(storagePath, buffer);

      const updated = await prisma.medicalExport.update({
        where: { id: exportRec.id },
        data: {
          storagePath,
          status: "GENERATED",
          generatedAt: new Date(),
        },
      });

      await prisma.auditLog.create({
        data: {
          action: "export.generate",
          entity: "MedicalExport",
          entityId: updated.id,
        },
      });

      reply.header("Content-Type", "application/pdf");
      reply.header("Content-Disposition", `attachment; filename="medical-report-${exportRec.id}.pdf"`);
      return reply.send(buffer);
    } catch (err) {
      return sendError(reply, err, 500);
    }
  });

  // Advisor chat
  app.get("/advisor/sessions", async (req, reply) => {
    try {
      const { prisma } = await withPrisma(req);
      const sessions = await prisma.chatSession.findMany({
        orderBy: { updatedAt: "desc" },
        include: { messages: { orderBy: { createdAt: "asc" }, take: 100 } },
      });
      return { sessions };
    } catch (err) {
      return sendError(reply, err);
    }
  });

  app.post<{
    Body: {
      message: string;
      sessionId?: string;
      persona?: "CFO" | "COUNSEL" | "COMBINED";
    };
  }>("/advisor/chat/stream", async (req, reply) => {
    try {
      const { prisma } = await withPrisma(req);
      const persona = req.body.persona ?? "COMBINED";

      let session = req.body.sessionId
        ? await prisma.chatSession.findUnique({ where: { id: req.body.sessionId } })
        : null;
      if (!session) {
        session = await prisma.chatSession.create({
          data: {
            title: req.body.message.slice(0, 60),
            persona,
            model: config.reasoningModel,
          },
        });
      }

      const budget = await prisma.budgetCategory.findMany({ include: { transactions: true } });
      const bills = await prisma.qRBill.findMany({ where: { status: "PENDING" }, take: 10 });
      const tasks = await prisma.legalTask.findMany({
        where: { status: { in: ["TODO", "IN_PROGRESS"] } },
        take: 10,
      });
      const context = { budget, bills, tasks, persona };

      await prisma.chatMessage.create({
        data: {
          sessionId: session.id,
          role: "USER",
          content: req.body.message,
          context: JSON.stringify(context),
        },
      });

      reply.raw.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      });

      sseWrite(reply, "context", { sessionId: session.id, vram: vramLock.getState() });

      const release = await vramLock.acquire("REASONING", (reason) => {
        sseWrite(reply, "context", { waiting: true, reason });
      });

      let full = "";
      try {
        const host = await resolveOllamaHost();
        const personaPrompt =
          persona === "CFO"
            ? "Du bist CFO für einen Schweizer Freelancer. Antworte strategisch zu Finanzen, Cashflow und Budget (CHF)."
            : persona === "COUNSEL"
              ? "Du bist Corporate Counsel für einen Schweizer Freelancer. Antworte zu rechtlichen/steuerlichen Themen (Schweiz)."
              : "Du bist dualer CFO und Corporate Counsel für einen Schweizer Freelancer.";

        const history = await prisma.chatMessage.findMany({
          where: { sessionId: session.id },
          orderBy: { createdAt: "asc" },
          take: 20,
        });

        for await (const token of streamChat({
          host,
          model: config.reasoningModel,
          messages: [
            {
              role: "system",
              content: `${personaPrompt}\nKontext:\n${JSON.stringify(context)}`,
            },
            ...history.map((m) => ({
              role: m.role === "USER" ? "user" : m.role === "ASSISTANT" ? "assistant" : "system",
              content: m.content,
            })),
          ],
        })) {
          full += token;
          sseWrite(reply, "token", { token });
        }

        await prisma.chatMessage.create({
          data: {
            sessionId: session.id,
            role: "ASSISTANT",
            content: full,
          },
        });
        await prisma.chatSession.update({
          where: { id: session.id },
          data: { updatedAt: new Date() },
        });
        sseWrite(reply, "done", { sessionId: session.id, content: full });
      } catch (err) {
        sseWrite(reply, "error", {
          message: err instanceof Error ? err.message : String(err),
        });
      } finally {
        await release();
        reply.raw.end();
      }
    } catch (err) {
      return sendError(reply, err);
    }
  });

  // Personal manners (Life)
  app.get("/life/today", async (req, reply) => {
    try {
      const { prisma } = await withPrisma(req);
      const summary = await buildPersonalTodaySummary(prisma);
      return { summary };
    } catch (err) {
      return sendError(reply, err);
    }
  });

  app.get("/life/habits", async (req, reply) => {
    try {
      const { prisma } = await withPrisma(req);
      const day = startOfDay();
      const habits = await prisma.habit.findMany({
        orderBy: { createdAt: "desc" },
        include: {
          logs: {
            where: { date: day },
            take: 1,
          },
        },
      });
      return {
        habits: habits.map((h) => ({
          ...h,
          completedToday: h.logs.length > 0,
          logs: undefined,
        })),
      };
    } catch (err) {
      return sendError(reply, err);
    }
  });

  app.post<{
    Body: {
      title: string;
      description?: string;
      frequency?: "DAILY" | "WEEKLY" | "CUSTOM";
      schedule?: string;
      domain?: "PERSONAL" | "BUSINESS" | "BOTH";
      color?: string;
      active?: boolean;
    };
  }>("/life/habits", async (req, reply) => {
    try {
      const { prisma } = await withPrisma(req);
      const habit = await prisma.habit.create({
        data: {
          title: req.body.title,
          description: req.body.description,
          frequency: req.body.frequency ?? "DAILY",
          schedule: req.body.schedule,
          domain: req.body.domain ?? "PERSONAL",
          color: req.body.color,
          active: req.body.active ?? true,
        },
      });
      return habit;
    } catch (err) {
      return sendError(reply, err);
    }
  });

  app.patch<{
    Params: { id: string };
    Body: {
      title?: string;
      description?: string | null;
      frequency?: "DAILY" | "WEEKLY" | "CUSTOM";
      domain?: "PERSONAL" | "BUSINESS" | "BOTH";
      active?: boolean;
      color?: string | null;
    };
  }>("/life/habits/:id", async (req, reply) => {
    try {
      const { prisma } = await withPrisma(req);
      const habit = await prisma.habit.update({
        where: { id: req.params.id },
        data: {
          title: req.body.title,
          description: req.body.description,
          frequency: req.body.frequency,
          domain: req.body.domain,
          active: req.body.active,
          color: req.body.color,
        },
      });
      return habit;
    } catch (err) {
      return sendError(reply, err);
    }
  });

  app.post<{
    Params: { id: string };
    Body: { note?: string; energy?: number; focus?: number; date?: string };
  }>("/life/habits/:id/log", async (req, reply) => {
    try {
      const { prisma } = await withPrisma(req);
      const date = req.body.date ? startOfDay(new Date(req.body.date)) : startOfDay();
      const log = await prisma.habitLog.upsert({
        where: { habitId_date: { habitId: req.params.id, date } },
        create: {
          habitId: req.params.id,
          date,
          note: req.body.note,
          energy: req.body.energy,
          focus: req.body.focus,
        },
        update: {
          note: req.body.note,
          energy: req.body.energy,
          focus: req.body.focus,
          loggedAt: new Date(),
        },
      });
      return log;
    } catch (err) {
      return sendError(reply, err);
    }
  });

  app.delete<{ Params: { id: string }; Querystring: { date?: string } }>(
    "/life/habits/:id/log",
    async (req, reply) => {
      try {
        const { prisma } = await withPrisma(req);
        const date = req.query.date ? startOfDay(new Date(req.query.date)) : startOfDay();
        await prisma.habitLog.deleteMany({
          where: { habitId: req.params.id, date },
        });
        return { ok: true };
      } catch (err) {
        return sendError(reply, err);
      }
    },
  );

  app.get("/life/goals", async (req, reply) => {
    try {
      const { prisma } = await withPrisma(req);
      const goals = await prisma.personalGoal.findMany({ orderBy: { updatedAt: "desc" } });
      return { goals };
    } catch (err) {
      return sendError(reply, err);
    }
  });

  app.post<{
    Body: {
      title: string;
      description?: string;
      targetDate?: string;
      progress?: number;
      domain?: "PERSONAL" | "BUSINESS" | "BOTH";
      status?: "ACTIVE" | "PAUSED" | "DONE" | "DROPPED";
    };
  }>("/life/goals", async (req, reply) => {
    try {
      const { prisma } = await withPrisma(req);
      const progress = Math.min(100, Math.max(0, req.body.progress ?? 0));
      const goal = await prisma.personalGoal.create({
        data: {
          title: req.body.title,
          description: req.body.description,
          targetDate: req.body.targetDate ? new Date(req.body.targetDate) : null,
          progress,
          domain: req.body.domain ?? "PERSONAL",
          status: req.body.status ?? "ACTIVE",
        },
      });
      return goal;
    } catch (err) {
      return sendError(reply, err);
    }
  });

  app.patch<{
    Params: { id: string };
    Body: {
      title?: string;
      description?: string | null;
      targetDate?: string | null;
      progress?: number;
      domain?: "PERSONAL" | "BUSINESS" | "BOTH";
      status?: "ACTIVE" | "PAUSED" | "DONE" | "DROPPED";
    };
  }>("/life/goals/:id", async (req, reply) => {
    try {
      const { prisma } = await withPrisma(req);
      const data: Record<string, unknown> = {};
      if (req.body.title !== undefined) data.title = req.body.title;
      if (req.body.description !== undefined) data.description = req.body.description;
      if (req.body.domain !== undefined) data.domain = req.body.domain;
      if (req.body.status !== undefined) data.status = req.body.status;
      if (req.body.progress !== undefined) {
        data.progress = Math.min(100, Math.max(0, req.body.progress));
      }
      if (req.body.targetDate !== undefined) {
        data.targetDate = req.body.targetDate ? new Date(req.body.targetDate) : null;
      }
      const goal = await prisma.personalGoal.update({
        where: { id: req.params.id },
        data,
      });
      return goal;
    } catch (err) {
      return sendError(reply, err);
    }
  });

  app.get("/life/tasks", async (req, reply) => {
    try {
      const { prisma } = await withPrisma(req);
      const tasks = await prisma.personalTask.findMany({ orderBy: { dueDate: "asc" } });
      return { tasks };
    } catch (err) {
      return sendError(reply, err);
    }
  });

  app.post<{
    Body: {
      title: string;
      description?: string;
      dueDate?: string;
      domain?: "PERSONAL" | "BUSINESS" | "BOTH";
      category?: string;
      status?: "TODO" | "IN_PROGRESS" | "DONE" | "CANCELLED";
    };
  }>("/life/tasks", async (req, reply) => {
    try {
      const { prisma } = await withPrisma(req);
      const task = await prisma.personalTask.create({
        data: {
          title: req.body.title,
          description: req.body.description,
          dueDate: req.body.dueDate ? new Date(req.body.dueDate) : null,
          domain: req.body.domain ?? "PERSONAL",
          category: req.body.category,
          status: req.body.status ?? "TODO",
        },
      });
      return task;
    } catch (err) {
      return sendError(reply, err);
    }
  });

  app.patch<{
    Params: { id: string };
    Body: {
      title?: string;
      description?: string | null;
      dueDate?: string | null;
      domain?: "PERSONAL" | "BUSINESS" | "BOTH";
      category?: string | null;
      status?: "TODO" | "IN_PROGRESS" | "DONE" | "CANCELLED";
    };
  }>("/life/tasks/:id", async (req, reply) => {
    try {
      const { prisma } = await withPrisma(req);
      const data: Record<string, unknown> = {};
      if (req.body.title !== undefined) data.title = req.body.title;
      if (req.body.description !== undefined) data.description = req.body.description;
      if (req.body.domain !== undefined) data.domain = req.body.domain;
      if (req.body.category !== undefined) data.category = req.body.category;
      if (req.body.dueDate !== undefined) {
        data.dueDate = req.body.dueDate ? new Date(req.body.dueDate) : null;
      }
      if (req.body.status !== undefined) {
        data.status = req.body.status;
        data.completedAt = req.body.status === "DONE" ? new Date() : null;
      }
      const task = await prisma.personalTask.update({
        where: { id: req.params.id },
        data,
      });
      return task;
    } catch (err) {
      return sendError(reply, err);
    }
  });

  app.get("/life/touchpoints", async (req, reply) => {
    try {
      const { prisma } = await withPrisma(req);
      const touchpoints = await prisma.relationshipTouchpoint.findMany({
        orderBy: { nextCheckInAt: "asc" },
      });
      return { touchpoints };
    } catch (err) {
      return sendError(reply, err);
    }
  });

  app.post<{
    Body: {
      personName: string;
      relationship?: string;
      lastContactAt?: string;
      nextCheckInAt?: string;
      notes?: string;
      cadenceDays?: number;
    };
  }>("/life/touchpoints", async (req, reply) => {
    try {
      const { prisma } = await withPrisma(req);
      const touchpoint = await prisma.relationshipTouchpoint.create({
        data: {
          personName: req.body.personName,
          relationship: req.body.relationship,
          lastContactAt: req.body.lastContactAt ? new Date(req.body.lastContactAt) : null,
          nextCheckInAt: req.body.nextCheckInAt ? new Date(req.body.nextCheckInAt) : null,
          notes: req.body.notes,
          cadenceDays: req.body.cadenceDays,
        },
      });
      return touchpoint;
    } catch (err) {
      return sendError(reply, err);
    }
  });

  app.patch<{
    Params: { id: string };
    Body: {
      personName?: string;
      relationship?: string | null;
      lastContactAt?: string | null;
      nextCheckInAt?: string | null;
      notes?: string | null;
      cadenceDays?: number | null;
      markContacted?: boolean;
    };
  }>("/life/touchpoints/:id", async (req, reply) => {
    try {
      const { prisma } = await withPrisma(req);
      const existing = await prisma.relationshipTouchpoint.findUnique({
        where: { id: req.params.id },
      });
      if (!existing) return reply.status(404).send({ error: "Touchpoint not found" });

      const data: Record<string, unknown> = {};
      if (req.body.personName !== undefined) data.personName = req.body.personName;
      if (req.body.relationship !== undefined) data.relationship = req.body.relationship;
      if (req.body.notes !== undefined) data.notes = req.body.notes;
      if (req.body.cadenceDays !== undefined) data.cadenceDays = req.body.cadenceDays;
      if (req.body.lastContactAt !== undefined) {
        data.lastContactAt = req.body.lastContactAt ? new Date(req.body.lastContactAt) : null;
      }
      if (req.body.nextCheckInAt !== undefined) {
        data.nextCheckInAt = req.body.nextCheckInAt ? new Date(req.body.nextCheckInAt) : null;
      }
      if (req.body.markContacted) {
        const now = new Date();
        data.lastContactAt = now;
        const cadence = req.body.cadenceDays ?? existing.cadenceDays ?? 14;
        const next = new Date(now);
        next.setDate(next.getDate() + cadence);
        data.nextCheckInAt = startOfDay(next);
      }

      const touchpoint = await prisma.relationshipTouchpoint.update({
        where: { id: req.params.id },
        data,
      });
      return touchpoint;
    } catch (err) {
      return sendError(reply, err);
    }
  });

  app.get("/life/notes", async (req, reply) => {
    try {
      const { prisma } = await withPrisma(req);
      const notes = await prisma.personalNote.findMany({
        orderBy: [{ pinned: "desc" }, { noteDate: "asc" }, { updatedAt: "desc" }],
      });
      return { notes };
    } catch (err) {
      return sendError(reply, err);
    }
  });

  app.post<{
    Body: {
      title: string;
      body: string;
      noteDate?: string;
      domain?: "PERSONAL" | "BUSINESS" | "BOTH";
      pinned?: boolean;
    };
  }>("/life/notes", async (req, reply) => {
    try {
      const { prisma } = await withPrisma(req);
      const note = await prisma.personalNote.create({
        data: {
          title: req.body.title,
          body: req.body.body,
          noteDate: req.body.noteDate ? startOfDay(new Date(req.body.noteDate)) : null,
          domain: req.body.domain ?? "PERSONAL",
          pinned: req.body.pinned ?? false,
        },
      });
      return note;
    } catch (err) {
      return sendError(reply, err);
    }
  });

  app.patch<{
    Params: { id: string };
    Body: {
      title?: string;
      body?: string;
      noteDate?: string | null;
      domain?: "PERSONAL" | "BUSINESS" | "BOTH";
      pinned?: boolean;
    };
  }>("/life/notes/:id", async (req, reply) => {
    try {
      const { prisma } = await withPrisma(req);
      const data: Record<string, unknown> = {};
      if (req.body.title !== undefined) data.title = req.body.title;
      if (req.body.body !== undefined) data.body = req.body.body;
      if (req.body.domain !== undefined) data.domain = req.body.domain;
      if (req.body.pinned !== undefined) data.pinned = req.body.pinned;
      if (req.body.noteDate !== undefined) {
        data.noteDate = req.body.noteDate ? startOfDay(new Date(req.body.noteDate)) : null;
      }
      const note = await prisma.personalNote.update({
        where: { id: req.params.id },
        data,
      });
      return note;
    } catch (err) {
      return sendError(reply, err);
    }
  });

  app.get("/life/metrics", async (req, reply) => {
    try {
      const { prisma } = await withPrisma(req);
      const metrics = await prisma.lifestyleMetric.findMany({
        orderBy: { date: "desc" },
        take: 30,
      });
      return { metrics };
    } catch (err) {
      return sendError(reply, err);
    }
  });

  app.post<{
    Body: { date?: string; energy?: number; focus?: number; note?: string };
  }>("/life/metrics", async (req, reply) => {
    try {
      const { prisma } = await withPrisma(req);
      const date = req.body.date ? startOfDay(new Date(req.body.date)) : startOfDay();
      const metric = await prisma.lifestyleMetric.upsert({
        where: { date },
        create: {
          date,
          energy: req.body.energy,
          focus: req.body.focus,
          note: req.body.note,
        },
        update: {
          energy: req.body.energy,
          focus: req.body.focus,
          note: req.body.note,
        },
      });
      return metric;
    } catch (err) {
      return sendError(reply, err);
    }
  });

  // Briefing
  app.get("/briefing/today", async (req, reply) => {
    try {
      const { prisma } = await withPrisma(req);
      const briefing = await getOrCreateTodayBriefing(prisma);
      return {
        ...briefing,
        snapshot: JSON.parse(briefing.snapshot),
        tier: config.licenseTier,
      };
    } catch (err) {
      return sendError(reply, err);
    }
  });

  app.post("/briefing/generate", async (req, reply) => {
    try {
      const { prisma } = await withPrisma(req);
      const briefing = await regenerateBriefing(prisma);
      return {
        ...briefing,
        snapshot: JSON.parse(briefing.snapshot),
        tier: config.licenseTier,
      };
    } catch (err) {
      return sendError(reply, err);
    }
  });

  app.get("/briefing/stream", async (req, reply) => {
    try {
      const { prisma } = await withPrisma(req);
      reply.raw.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      });

      try {
        for await (const token of streamBriefingNarrative(prisma)) {
          sseWrite(reply, "token", { token });
        }
        sseWrite(reply, "done", {});
      } catch (err) {
        sseWrite(reply, "error", {
          message: err instanceof Error ? err.message : String(err),
        });
      } finally {
        reply.raw.end();
      }
    } catch (err) {
      return sendError(reply, err);
    }
  });

  // License
  app.get("/license", async () => ({
    tier: config.licenseTier,
    features: {
      aiNarrative: config.licenseTier === "pro",
      ocr: config.licenseTier === "pro",
      advisorChat: config.licenseTier === "pro",
      dualMedicalAnalysis: config.licenseTier === "pro",
    },
  }));
}
