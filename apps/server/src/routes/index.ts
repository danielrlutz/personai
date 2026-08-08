import type { FastifyInstance } from "fastify";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { renderToBuffer } from "@react-pdf/renderer";
import React from "react";
import { createProfile, listProfiles, switchProfile, getActiveProfile } from "../profiles/registry.js";
import { config, profileExportsDir, profileUploadsDir } from "../config.js";
import { ollamaHealth, resolveOllamaHost, streamChat, chatCompletion } from "../ollama/client.js";
import { vramLock } from "../ollama/vram-lock.js";
import { ingestionEvents } from "../ollama/ingestion-worker.js";
import {
  getOrCreateTodayBriefing,
  regenerateBriefing,
  streamBriefingNarrative,
} from "../briefing/briefing-service.js";
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
          remaining: (c.monthlyLimit ?? 0) - spent,
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
