import fs from "node:fs/promises";
import path from "node:path";
import { EventEmitter } from "node:events";
import { getPrisma, getActiveProfileId } from "../db/prisma-singleton.js";
import { config, profileUploadsDir } from "../config.js";
import { resolveOllamaHost, visionExtract } from "./client.js";
import { vramLock } from "./vram-lock.js";

export const ingestionEvents = new EventEmitter();

let running = false;
let timer: NodeJS.Timeout | null = null;

const OCR_PROMPT = `Extract structured data from this document image/PDF page.
Return ONLY valid JSON with these fields when applicable:
{
  "documentType": "BILL|MEDICAL_RECORD|LEGAL|CONTRACT|RECEIPT|OTHER",
  "vendor": string|null,
  "amount": number|null,
  "currency": "CHF"|string|null,
  "date": "YYYY-MM-DD"|null,
  "category": string|null,
  "vatAmount": number|null,
  "invoiceNumber": string|null,
  "iban": string|null,
  "reference": string|null,
  "creditorName": string|null,
  "dueDate": "YYYY-MM-DD"|null,
  "provider": string|null,
  "diagnosis": string|null,
  "medications": string[]|null,
  "parties": string[]|null,
  "summary": string
}`;

function parseStructured(raw: string): Record<string, unknown> {
  try {
    const match = raw.match(/\{[\s\S]*\}/);
    if (!match) return { summary: raw, documentType: "OTHER" };
    return JSON.parse(match[0]) as Record<string, unknown>;
  } catch {
    return { summary: raw, documentType: "OTHER" };
  }
}

async function processJob(profileId: string, jobId: string): Promise<void> {
  const prisma = await getPrisma(profileId);
  const job = await prisma.ingestionJob.findUnique({
    where: { id: jobId },
    include: { document: true },
  });
  if (!job || job.status !== "QUEUED") return;

  const release = await vramLock.acquire("VISION", async (reason) => {
    await prisma.ingestionJob.update({
      where: { id: jobId },
      data: { pausedReason: reason },
    });
    ingestionEvents.emit("queue", { profileId });
  });

  try {
    await prisma.ingestionJob.update({
      where: { id: jobId },
      data: {
        status: "PROCESSING",
        pausedReason: null,
        startedAt: new Date(),
        ollamaHost: await resolveOllamaHost(),
      },
    });
    ingestionEvents.emit("queue", { profileId });

    const host = await resolveOllamaHost();
    const fileBuf = await fs.readFile(job.document.storagePath);
    const imageBase64 = fileBuf.toString("base64");

    const raw = await visionExtract({
      host,
      model: config.visionModel,
      imageBase64,
      prompt: OCR_PROMPT,
    });

    const structured = parseStructured(raw);

    await prisma.documentExtraction.create({
      data: {
        documentId: job.documentId,
        jobId: job.id,
        rawJson: raw,
        structured: JSON.stringify(structured),
        confidence: 0.8,
      },
    });

    const docType = String(structured.documentType ?? "OTHER");
    if (["BILL", "MEDICAL_RECORD", "LEGAL", "CONTRACT", "RECEIPT", "OTHER"].includes(docType)) {
      await prisma.document.update({
        where: { id: job.documentId },
        data: { documentType: docType as "BILL" | "MEDICAL_RECORD" | "LEGAL" | "CONTRACT" | "RECEIPT" | "OTHER" },
      });
    }

    if (structured.amount && structured.iban) {
      await prisma.qRBill.create({
        data: {
          creditorName: String(structured.creditorName ?? structured.vendor ?? "Unknown"),
          iban: String(structured.iban),
          amount: Number(structured.amount),
          currency: String(structured.currency ?? "CHF"),
          reference: structured.reference ? String(structured.reference) : null,
          dueDate: structured.dueDate ? new Date(String(structured.dueDate)) : null,
          documentId: job.documentId,
          status: "PENDING",
        },
      });
    } else if (structured.amount && structured.vendor) {
      await prisma.transaction.create({
        data: {
          type: "EXPENSE",
          amount: Number(structured.amount),
          currency: String(structured.currency ?? "CHF"),
          description: String(structured.vendor),
          date: structured.date ? new Date(String(structured.date)) : new Date(),
          documentId: job.documentId,
        },
      });
    }

    await prisma.ingestionJob.update({
      where: { id: jobId },
      data: { status: "COMPLETED", completedAt: new Date(), pausedReason: null },
    });
  } catch (err) {
    await prisma.ingestionJob.update({
      where: { id: jobId },
      data: {
        status: "FAILED",
        errorMessage: err instanceof Error ? err.message : String(err),
        completedAt: new Date(),
        pausedReason: null,
      },
    });
  } finally {
    await release();
    ingestionEvents.emit("queue", { profileId });
  }
}

async function tick(): Promise<void> {
  if (running) return;
  const profileId = getActiveProfileId();
  if (!profileId) return;

  running = true;
  try {
    const prisma = await getPrisma(profileId);
    const jobs = await prisma.ingestionJob.findMany({
      where: { status: "QUEUED" },
      orderBy: { createdAt: "asc" },
      take: 1,
    });
    if (jobs[0]) {
      await processJob(profileId, jobs[0].id);
    }

    const queued = await prisma.ingestionJob.findMany({
      where: { status: "QUEUED" },
      orderBy: { createdAt: "asc" },
    });
    for (let i = 0; i < queued.length; i++) {
      await prisma.ingestionJob.update({
        where: { id: queued[i]!.id },
        data: { queuePosition: i + 1 },
      });
    }
  } finally {
    running = false;
  }
}

export function startIngestionWorker(): void {
  if (timer) return;
  timer = setInterval(() => {
    void tick();
  }, 1500);
}

export function stopIngestionWorker(): void {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}

export function storagePathForUpload(profileId: string, documentId: string, filename: string): string {
  const ext = path.extname(filename) || ".bin";
  return path.join(profileUploadsDir(profileId), documentId, `original${ext}`);
}
