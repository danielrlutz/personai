/**
 * Confirm closer inspection: re-OCR a segment with neighbor context, refine with
 * a higher-tier model, then publish a fresh confirmation (Reinspected · …).
 */
import fs from "node:fs/promises";
import path from "node:path";
import type { PrismaClient, ServerJob } from "@prisma/client";
import {
  chatCompletion,
  resolveOllamaHost,
  visionExtract,
} from "../ollama/client.js";
import { vramLock } from "../ollama/vram-lock.js";
import { prepareDocumentForOcr } from "../ingest/pdf-prepare.js";
import {
  mergePageExtractions,
  type PreparedPage,
} from "../ingest/bulk-split.js";
import { OCR_PROMPT, parseStructured } from "../ingest/ocr-prompt.js";
import {
  findSwissQrInPng,
  isLikelySwissIban,
  type SwissQrBill,
} from "../ingest/swiss-qr.js";
import {
  resolveReinspectModel,
  resolveVisionModel,
} from "../specialists/resolve-model.js";
import {
  suggestArchiveCategory,
  suggestArchiveName,
} from "../specialists/roster.js";
import { lookupEntityArchiveCategory } from "../memory/filing-memory.js";
import {
  lookupCorrectionArchiveCategory,
  lookupCorrectionDocTypeToken,
} from "../memory/corrections.js";
import { getActiveProfileId } from "../db/prisma-singleton.js";
import { guessMime } from "../archive/commit.js";
import { normalizeDocumentType } from "../archive/doc-type-tokens.js";
import { safeDate, safeDateOrNow, safeFiniteNumber } from "../lib/safe-data.js";
import { createConfirmation } from "./confirm-service.js";

export const SERVER_JOB_CONFIRM_REINSPECT = "confirm.reinspect";

export type ReinspectStatus = "flagged" | "reinspecting" | "ready" | "failed";

export type ConfirmReinspectJobPayload = {
  confirmationId: string;
  documentId: string;
  neighborRadius?: number;
};

type PageOcr = {
  page: PreparedPage;
  raw: string;
  structured: Record<string, unknown>;
  qr: SwissQrBill | null;
  role: "core" | "neighbor";
};

const OCR_JSON_SCHEMA_HINT = `{
  "documentType": "BILL|MEDICAL_RECORD|LEGAL|CONTRACT|RECEIPT|OFFICIAL|OTHER",
  "vendor": string|null,
  "amount": number|null,
  "currency": "CHF"|string|null,
  "date": "YYYY-MM-DD"|null,
  "category": string|null,
  "vatAmount": number|null,
  "invoiceNumber": string|null,
  "iban": string|null,
  "reference": string|null,
  "referenceType": "QRR|SCOR|NON"|null,
  "creditorName": string|null,
  "creditorAddress": string|null,
  "dueDate": "YYYY-MM-DD"|null,
  "hasSwissQrBill": boolean,
  "pageLabel": string|null,
  "provider": string|null,
  "diagnosis": string|null,
  "medications": string[]|null,
  "parties": string[]|null,
  "summary": string
}`;

function parseJobPayload(raw: string): ConfirmReinspectJobPayload {
  try {
    const parsed = JSON.parse(raw || "{}") as Partial<ConfirmReinspectJobPayload>;
    return {
      confirmationId: String(parsed.confirmationId ?? ""),
      documentId: String(parsed.documentId ?? ""),
      neighborRadius:
        parsed.neighborRadius == null ? undefined : Number(parsed.neighborRadius),
    };
  } catch {
    return { confirmationId: "", documentId: "" };
  }
}

function clampNeighborRadius(value: unknown): number {
  const n = typeof value === "number" && Number.isFinite(value) ? value : 1;
  return Math.max(0, Math.min(3, Math.floor(n)));
}

function parsePayloadObject(raw: string): Record<string, unknown> {
  try {
    const v = JSON.parse(raw || "{}");
    return v && typeof v === "object" && !Array.isArray(v)
      ? (v as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

async function patchConfirmationPayload(
  prisma: PrismaClient,
  confirmationId: string,
  patch: Record<string, unknown>,
): Promise<void> {
  const row = await prisma.pendingConfirmation.findUnique({
    where: { id: confirmationId },
  });
  if (!row) return;
  const prev = parsePayloadObject(row.payload);
  await prisma.pendingConfirmation.update({
    where: { id: confirmationId },
    data: { payload: JSON.stringify({ ...prev, ...patch }) },
  });
}

function readSourcePages(structured: Record<string, unknown>): [number, number] {
  const sp = structured.sourcePages;
  if (Array.isArray(sp) && sp.length >= 2) {
    const start = Number(sp[0]);
    const end = Number(sp[1]);
    if (
      Number.isFinite(start) &&
      Number.isFinite(end) &&
      start >= 1 &&
      end >= start
    ) {
      return [Math.floor(start), Math.floor(end)];
    }
  }
  return [1, 1];
}

function pickEntity(structured: Record<string, unknown>): string {
  for (const key of ["creditorName", "vendor", "provider"] as const) {
    const s = String(structured[key] ?? "").trim();
    if (s) return s;
  }
  return "Unknown";
}

function applySwissQr(
  structured: Record<string, unknown>,
  qr: SwissQrBill | null,
): Record<string, unknown> {
  if (!qr) return structured;
  const next = { ...structured };
  next.hasSwissQrBill = true;
  next.qrPayload = qr.payload;
  next.iban = qr.iban;
  next.creditorName = qr.creditorName || next.creditorName;
  next.creditorAddress = qr.creditorAddress ?? next.creditorAddress;
  next.currency = qr.currency || next.currency || "CHF";
  next.reference = qr.reference ?? next.reference;
  next.referenceType = qr.referenceType ?? next.referenceType;
  if (qr.amount != null) next.amount = qr.amount;
  if (!next.documentType || next.documentType === "OTHER") next.documentType = "BILL";
  if (!next.vendor) next.vendor = qr.creditorName;
  return next;
}

async function findOriginalBulkInDir(dir: string): Promise<string | null> {
  try {
    const entries = await fs.readdir(dir);
    const bulk = entries.find((e) => e.startsWith("original-bulk"));
    if (!bulk) return null;
    return path.join(dir, bulk);
  } catch {
    return null;
  }
}

/**
 * Prefer original-bulk* (full Genius Scan stack) so neighbor pages exist.
 * Never deletes originals — only returns a path to prepare from.
 */
async function resolveSourceStoragePath(opts: {
  prisma: PrismaClient;
  document: { id: string; storagePath: string };
  structured: Record<string, unknown>;
}): Promise<string> {
  const docDir = path.dirname(opts.document.storagePath);
  const inDoc = await findOriginalBulkInDir(docDir);
  if (inDoc) return inDoc;

  const parentId = opts.structured.parentDocumentId
    ? String(opts.structured.parentDocumentId)
    : "";
  if (parentId) {
    const parent = await opts.prisma.document.findUnique({
      where: { id: parentId },
    });
    if (parent?.storagePath) {
      const inParent = await findOriginalBulkInDir(path.dirname(parent.storagePath));
      if (inParent) return inParent;
      // Parent dir may still hold original-bulk under a rewritten segment path.
      try {
        await fs.access(parent.storagePath);
        return parent.storagePath;
      } catch {
        // fall through
      }
    }
  }

  return opts.document.storagePath;
}

async function ocrPage(opts: {
  host: string;
  model: string;
  page: PreparedPage;
  role: "core" | "neighbor";
}): Promise<PageOcr> {
  let qr: SwissQrBill | null = null;
  if (opts.page.path.toLowerCase().endsWith(".png")) {
    qr = await findSwissQrInPng(opts.page.path);
  }
  const fileBuf = await fs.readFile(opts.page.path);
  const raw = await visionExtract({
    host: opts.host,
    model: opts.model,
    imageBase64: fileBuf.toString("base64"),
    prompt: OCR_PROMPT,
  });
  return {
    page: opts.page,
    raw,
    structured: applySwissQr(parseStructured(raw), qr),
    qr,
    role: opts.role,
  };
}

function buildRefinePrompt(opts: {
  sourceStart: number;
  sourceEnd: number;
  neighborRadius: number;
  core: PageOcr[];
  neighbors: PageOcr[];
}): string {
  const coreJson = opts.core.map((p) => ({
    page: p.page.pageNumber,
    role: "core",
    structured: p.structured,
  }));
  const neighborJson = opts.neighbors.map((p) => ({
    page: p.page.pageNumber,
    role: "neighbor",
    structured: p.structured,
  }));
  return `You refine Swiss document OCR after a closer inspection pass.

Core pages [${opts.sourceStart}–${opts.sourceEnd}] are the document segment under review.
Neighbor pages (radius ${opts.neighborRadius}) are adjacent stack pages that may belong to another document or were wrongly excluded.

Correct for:
- missing pages that belong to this document
- bad split boundaries (segment too short/long)
- wrong entity/vendor mixed in from a neighbor page

Prefer core-page evidence; use neighbors only to fix boundaries or entity mixups.
Return ONLY valid JSON matching this OCR schema (no markdown):
${OCR_JSON_SCHEMA_HINT}

Core page extractions:
${JSON.stringify(coreJson, null, 2)}

Neighbor page extractions:
${JSON.stringify(neighborJson, null, 2)}`;
}

async function createConfirmForReinspect(opts: {
  prisma: PrismaClient;
  documentId: string;
  structured: Record<string, unknown>;
  archiveName: string;
  archiveCategory: number;
  deadline: Date | null;
  documentType: string;
  extension: string;
  mimeType: string;
  reinspectMeta: {
    reinspectJobId: string;
    reinspectAt: string;
    reinspectVisionModel: string;
    reinspectModel: string;
    reinspectNeighborPages: number[];
  };
}): Promise<{ id: string }> {
  const {
    prisma,
    documentId,
    structured,
    archiveName,
    archiveCategory,
    deadline,
    documentType,
    extension,
    mimeType,
    reinspectMeta,
  } = opts;
  const entity = pickEntity(structured);
  const namingMeta = {
    documentType,
    displayType: documentType,
    entity,
    sourceExtension: extension,
    mimeType,
  };
  const readyPayload = {
    reinspectStatus: "ready" as const,
    reinspectJobId: reinspectMeta.reinspectJobId,
    reinspectAt: reinspectMeta.reinspectAt,
    reinspectVisionModel: reinspectMeta.reinspectVisionModel,
    reinspectModel: reinspectMeta.reinspectModel,
    reinspectNeighborPages: reinspectMeta.reinspectNeighborPages,
  };
  const iban = structured.iban ? String(structured.iban) : "";
  const hasQr =
    Boolean(structured.hasSwissQrBill) ||
    Boolean(structured.qrPayload) ||
    (Boolean(structured.amount) && isLikelySwissIban(iban));

  if (hasQr && iban) {
    const amountNum = safeFiniteNumber(structured.amount);
    const due = safeDate(structured.dueDate);
    return createConfirmation(prisma, {
      action: "ledger.write",
      summary: `Reinspected · Save QR bill ${entity} · ${amountNum ?? "open amount"} ${structured.currency ?? "CHF"} · file as ${archiveName}`,
      entity: "Document",
      entityId: documentId,
      payload: {
        kind: "qr_bill",
        documentId,
        creditorName: entity,
        creditorAddress: structured.creditorAddress
          ? String(structured.creditorAddress)
          : null,
        iban,
        amount: amountNum ?? 0,
        currency: String(structured.currency ?? "CHF"),
        reference: structured.reference ? String(structured.reference) : null,
        referenceType: structured.referenceType
          ? String(structured.referenceType)
          : null,
        dueDate: due ? due.toISOString().slice(0, 10) : null,
        qrPayload: structured.qrPayload ? String(structured.qrPayload) : null,
        archiveName,
        archiveCategory,
        openAmount: amountNum == null,
        fileArchive: true,
        markPaid: false,
        ...namingMeta,
        ...readyPayload,
      },
    });
  }

  const amountNum = safeFiniteNumber(structured.amount);
  if (amountNum != null && structured.vendor) {
    return createConfirmation(prisma, {
      action: "ledger.write",
      summary: `Reinspected · Save expense ${entity} · ${amountNum} ${structured.currency ?? "CHF"} · file as ${archiveName}`,
      entity: "Document",
      entityId: documentId,
      payload: {
        kind: "transaction",
        documentId,
        type: "EXPENSE",
        amount: amountNum,
        currency: String(structured.currency ?? "CHF"),
        description: entity,
        date: safeDateOrNow(structured.date).toISOString(),
        archiveName,
        archiveCategory,
        ...namingMeta,
        ...readyPayload,
      },
    });
  }

  return createConfirmation(prisma, {
    action: "archive.commit",
    summary: `Reinspected · File as ${archiveName} (folder ${archiveCategory})${
      deadline ? ` · deadline (Frist) ${deadline.toISOString().slice(0, 10)}` : ""
    }`,
    entity: "Document",
    entityId: documentId,
    payload: {
      documentId,
      archiveName,
      archiveCategory,
      deadline: deadline ? deadline.toISOString() : null,
      createFristenTask: Boolean(deadline),
      ...namingMeta,
      ...readyPayload,
    },
  });
}

async function expireOtherPendingForDocument(
  prisma: PrismaClient,
  documentId: string,
  keepConfirmationId: string,
): Promise<void> {
  await prisma.pendingConfirmation.updateMany({
    where: {
      status: "pending",
      entity: "Document",
      entityId: documentId,
      NOT: { id: keepConfirmationId },
    },
    data: { status: "expired", resolvedAt: new Date() },
  });
}

/**
 * Run closer inspection for a flagged confirmation.
 * Caller owns ServerJob status transitions; this throws on failure.
 */
export async function processConfirmReinspect(
  prisma: PrismaClient,
  job: ServerJob,
): Promise<Record<string, unknown>> {
  const payload = parseJobPayload(job.payload);
  const confirmationId = payload.confirmationId;
  const documentId = payload.documentId || job.documentId || "";
  const neighborRadius = clampNeighborRadius(payload.neighborRadius);

  if (!confirmationId || !documentId) {
    throw new Error("confirm.reinspect payload missing confirmationId/documentId");
  }

  await patchConfirmationPayload(prisma, confirmationId, {
    reinspectStatus: "reinspecting",
    reinspectJobId: job.id,
    reinspectError: null,
  });

  const document = await prisma.document.findUnique({ where: { id: documentId } });
  if (!document) throw new Error(`Document not found: ${documentId}`);

  const latestExtraction = await prisma.documentExtraction.findFirst({
    where: { documentId },
    orderBy: { createdAt: "desc" },
  });
  const priorStructured = latestExtraction
    ? parsePayloadObject(latestExtraction.structured)
    : {};
  const [sourceStart, sourceEnd] = readSourcePages(priorStructured);

  const sourcePath = await resolveSourceStoragePath({
    prisma,
    document,
    structured: priorStructured,
  });

  const workDir = path.join(path.dirname(document.storagePath), `reinspect-${job.id}`);
  await fs.rm(workDir, { recursive: true, force: true }).catch(() => undefined);

  const host = await resolveOllamaHost();
  let visionModelName = "";
  let reinspectModelName = "";
  let pageOcrs: PageOcr[] = [];
  let refinedStructured: Record<string, unknown> = {};
  let refinedRaw = "";

  try {
    const prepared = await prepareDocumentForOcr({
      storagePath: sourcePath,
      workDir,
      mimeType: guessMime(sourcePath, document.mimeType),
    });

    const ocrLo = Math.max(1, sourceStart - neighborRadius);
    const ocrHi = sourceEnd + neighborRadius;
    const pagesInRange = prepared.pages.filter(
      (p) => p.pageNumber >= ocrLo && p.pageNumber <= ocrHi && !p.blank,
    );
    if (pagesInRange.length === 0) {
      throw new Error(
        `No pages to OCR in range [${ocrLo}, ${ocrHi}] (sourcePages [${sourceStart}, ${sourceEnd}])`,
      );
    }

    const releaseVision = await vramLock.acquire("VISION");
    try {
      const vision = await resolveVisionModel(host);
      visionModelName = vision.model;
      for (const page of pagesInRange) {
        const role: "core" | "neighbor" =
          page.pageNumber >= sourceStart && page.pageNumber <= sourceEnd
            ? "core"
            : "neighbor";
        pageOcrs.push(
          await ocrPage({ host, model: vision.model, page, role }),
        );
      }
    } finally {
      await releaseVision();
    }

    const core = pageOcrs.filter((p) => p.role === "core");
    const neighbors = pageOcrs.filter((p) => p.role === "neighbor");
    // If radius clipped everything to neighbors somehow, treat all as core.
    const coreForRefine = core.length > 0 ? core : pageOcrs;
    const neighborForRefine = core.length > 0 ? neighbors : [];

    const releaseReasoning = await vramLock.acquire("REASONING");
    try {
      const reinspect = await resolveReinspectModel(host);
      reinspectModelName = reinspect.model;
      const refinePrompt = buildRefinePrompt({
        sourceStart,
        sourceEnd,
        neighborRadius,
        core: coreForRefine,
        neighbors: neighborForRefine,
      });
      refinedRaw = await chatCompletion({
        host,
        model: reinspect.model,
        messages: [{ role: "user", content: refinePrompt }],
      });
      const qr =
        coreForRefine.find((p) => p.qr)?.qr ??
        pageOcrs.find((p) => p.qr)?.qr ??
        null;
      refinedStructured = applySwissQr(parseStructured(refinedRaw), qr);
    } finally {
      await releaseReasoning();
    }

    // Fall back to merged core OCR if refine produced empty/useless JSON.
    if (
      !refinedStructured.summary &&
      !refinedStructured.vendor &&
      !refinedStructured.creditorName &&
      !refinedStructured.iban
    ) {
      const merged = mergePageExtractions(coreForRefine.map((p) => p.structured));
      const qr = coreForRefine.find((p) => p.qr)?.qr ?? null;
      refinedStructured = applySwissQr(merged, qr);
      refinedRaw = JSON.stringify({
        refineFallback: true,
        pages: pageOcrs.map((p) => ({
          page: p.page.pageNumber,
          role: p.role,
          raw: p.raw,
          swissQr: p.qr,
        })),
      });
    }

    refinedStructured.sourcePages = [sourceStart, sourceEnd];
    if (priorStructured.parentDocumentId) {
      refinedStructured.parentDocumentId = priorStructured.parentDocumentId;
    }
    refinedStructured.reinspectNeighborRadius = neighborRadius;

    const neighborPages = neighbors.map((p) => p.page.pageNumber).sort((a, b) => a - b);
    const extension =
      path.extname(document.filename) ||
      path.extname(document.storagePath) ||
      ".pdf";
    const documentType = normalizeDocumentType(refinedStructured.documentType);
    refinedStructured.documentType = documentType;
    const entity = pickEntity(refinedStructured);
    const profileId = getActiveProfileId();
    const preferredTypeToken = profileId
      ? await lookupCorrectionDocTypeToken(profileId, documentType)
      : null;
    const archiveName = suggestArchiveName({
      date: refinedStructured.date ? String(refinedStructured.date) : null,
      documentType,
      entity,
      extension,
      preferredTypeToken,
    });
    const learnedCategory = await lookupEntityArchiveCategory(prisma, entity);
    const correctionCategory = profileId
      ? await lookupCorrectionArchiveCategory(profileId, entity)
      : null;
    const archiveCategory =
      learnedCategory ?? correctionCategory ?? suggestArchiveCategory(documentType);
    const deadline = safeDate(refinedStructured.dueDate);
    const mimeType = document.mimeType || guessMime(`file${extension}`, null);
    const reinspectAt = new Date().toISOString();

    await prisma.documentExtraction.create({
      data: {
        documentId,
        jobId: job.id,
        rawJson: refinedRaw,
        structured: JSON.stringify(refinedStructured),
        confidence: pageOcrs.some((p) => p.qr) ? 0.95 : 0.85,
      },
    });

    await prisma.document.update({
      where: { id: documentId },
      data: {
        documentType,
        archiveName,
        archiveCategory,
        deadline,
      },
    });

    const confirmation = await createConfirmForReinspect({
      prisma,
      documentId,
      structured: refinedStructured,
      archiveName,
      archiveCategory,
      deadline,
      documentType,
      extension,
      mimeType,
      reinspectMeta: {
        reinspectJobId: job.id,
        reinspectAt,
        reinspectVisionModel: visionModelName,
        reinspectModel: reinspectModelName,
        reinspectNeighborPages: neighborPages,
      },
    });

    if (confirmation.id !== confirmationId) {
      await expireOtherPendingForDocument(prisma, documentId, confirmation.id);
    }

    await prisma.auditLog.create({
      data: {
        action: "confirm.reinspect",
        entity: "Document",
        entityId: documentId,
        metadata: JSON.stringify({
          confirmationId: confirmation.id,
          flaggedConfirmationId: confirmationId,
          jobId: job.id,
          sourcePages: [sourceStart, sourceEnd],
          ocrPages: [ocrLo, ocrHi],
          neighborPages,
          visionModel: visionModelName,
          reinspectModel: reinspectModelName,
          neighborRadius,
        }),
      },
    });

    return {
      confirmationId: confirmation.id,
      documentId,
      models: {
        vision: visionModelName,
        reinspect: reinspectModelName,
      },
      ranges: {
        sourcePages: [sourceStart, sourceEnd],
        ocrPages: [ocrLo, Math.min(ocrHi, prepared.pages.at(-1)?.pageNumber ?? ocrHi)],
        neighborPages,
      },
    };
  } finally {
    await fs.rm(workDir, { recursive: true, force: true }).catch(() => undefined);
  }
}

/** Patch the flagged confirmation when the reinspect job fails. */
export async function markReinspectFailed(
  prisma: PrismaClient,
  job: ServerJob,
  errorMessage: string,
): Promise<void> {
  const payload = parseJobPayload(job.payload);
  if (!payload.confirmationId) return;
  await patchConfirmationPayload(prisma, payload.confirmationId, {
    reinspectStatus: "failed",
    reinspectError: errorMessage,
    reinspectJobId: job.id,
  });
}
