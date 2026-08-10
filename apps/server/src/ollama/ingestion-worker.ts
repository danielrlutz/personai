import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { EventEmitter } from "node:events";
import { getPrisma, getActiveProfileId } from "../db/prisma-singleton.js";
import { config, profileUploadsDir } from "../config.js";
import { resolveOllamaHost, visionExtract } from "./client.js";
import { vramLock } from "./vram-lock.js";
import { createConfirmation } from "../confirm/confirm-service.js";
import {
  suggestArchiveCategory,
  suggestArchiveName,
} from "../specialists/roster.js";
import { prepareDocumentForOcr, prepareWarning } from "../ingest/pdf-prepare.js";
import { imagesToPdf } from "../ingest/images-to-pdf.js";
import { guessMime } from "../archive/commit.js";
import {
  expandSegmentsForPhoneScanner,
  mergeContinuationGroups,
  mergePageExtractions,
  segmentBulkPages,
  type PageSegment,
  type PreparedPage,
} from "../ingest/bulk-split.js";
import { OCR_PROMPT, parseStructured } from "../ingest/ocr-prompt.js";
import {
  findSwissQrInPng,
  isLikelySwissIban,
  type SwissQrBill,
} from "../ingest/swiss-qr.js";
import {
  finalizeCancelledJob,
  isCancelRequested,
} from "../ingest/cancel-job.js";
import { setJobProgress } from "../ingest/progress.js";
import { safeDate, safeDateOrNow, safeFiniteNumber } from "../lib/safe-data.js";
import { tickServerJobs, recoverStaleServerJobs } from "../jobs/server-jobs.js";

export const ingestionEvents = new EventEmitter();

let running = false;
let timer: NodeJS.Timeout | null = null;
let serverJobTimer: NodeJS.Timeout | null = null;
let serverJobRunning = false;

const DOC_TYPES = [
  "BILL",
  "MEDICAL_RECORD",
  "LEGAL",
  "CONTRACT",
  "RECEIPT",
  "OFFICIAL",
  "OTHER",
] as const;
type DocType = (typeof DOC_TYPES)[number];

type PageOcr = {
  page: PreparedPage;
  raw: string;
  structured: Record<string, unknown>;
  qr: SwissQrBill | null;
};

function asDocType(value: unknown): DocType {
  const s = String(value ?? "OTHER");
  return (DOC_TYPES as readonly string[]).includes(s) ? (s as DocType) : "OTHER";
}

function applySwissQr(structured: Record<string, unknown>, qr: SwissQrBill | null): Record<string, unknown> {
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

async function ocrPage(opts: { host: string; page: PreparedPage }): Promise<PageOcr> {
  let qr: SwissQrBill | null = null;
  if (opts.page.path.toLowerCase().endsWith(".png")) {
    qr = await findSwissQrInPng(opts.page.path);
  }

  const fileBuf = await fs.readFile(opts.page.path);
  const raw = await visionExtract({
    host: opts.host,
    model: config.visionModel,
    imageBase64: fileBuf.toString("base64"),
    prompt: OCR_PROMPT,
  });
  return {
    page: opts.page,
    raw,
    structured: applySwissQr(parseStructured(raw), qr),
    qr,
  };
}

function combinePageOcrs(pages: PageOcr[]): {
  raw: string;
  structured: Record<string, unknown>;
  qr: SwissQrBill | null;
} {
  const qr = pages.find((p) => p.qr)?.qr ?? null;
  const structured = applySwissQr(
    mergePageExtractions(pages.map((p) => p.structured)),
    qr,
  );
  const raw = JSON.stringify({
    pages: pages.map((p) => ({
      page: p.page.pageNumber,
      raw: p.raw,
      swissQr: p.qr,
    })),
  });
  return { raw, structured, qr };
}

async function createConfirmForExtraction(opts: {
  prisma: Awaited<ReturnType<typeof getPrisma>>;
  documentId: string;
  structured: Record<string, unknown>;
  archiveName: string;
  archiveCategory: number;
  deadline: Date | null;
  documentType: string;
  extension: string;
  mimeType: string;
}): Promise<void> {
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
  } = opts;
  const entity = String(
    structured.creditorName ?? structured.vendor ?? structured.provider ?? "Unknown",
  );
  const namingMeta = {
    documentType,
    entity,
    sourceExtension: extension,
    mimeType,
  };
  const iban = structured.iban ? String(structured.iban) : "";
  const hasQr =
    Boolean(structured.hasSwissQrBill) ||
    Boolean(structured.qrPayload) ||
    (Boolean(structured.amount) && isLikelySwissIban(iban));

  if (hasQr && iban) {
    const amountNum = safeFiniteNumber(structured.amount);
    const due = safeDate(structured.dueDate);
    await createConfirmation(prisma, {
      action: "ledger.write",
      summary: `Save QR bill ${entity} · ${amountNum ?? "open amount"} ${structured.currency ?? "CHF"} · file as ${archiveName}`,
      entity: "Document",
      entityId: documentId,
      payload: {
        kind: "qr_bill",
        documentId,
        creditorName: entity,
        creditorAddress: structured.creditorAddress ? String(structured.creditorAddress) : null,
        iban,
        amount: amountNum ?? 0,
        currency: String(structured.currency ?? "CHF"),
        reference: structured.reference ? String(structured.reference) : null,
        referenceType: structured.referenceType ? String(structured.referenceType) : null,
        dueDate: due ? due.toISOString().slice(0, 10) : null,
        qrPayload: structured.qrPayload ? String(structured.qrPayload) : null,
        archiveName,
        archiveCategory,
        openAmount: amountNum == null,
        ...namingMeta,
      },
    });
    return;
  }

  const amountNum = safeFiniteNumber(structured.amount);
  if (amountNum != null && structured.vendor) {
    await createConfirmation(prisma, {
      action: "ledger.write",
      summary: `Save expense ${entity} · ${amountNum} ${structured.currency ?? "CHF"} · file as ${archiveName}`,
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
      },
    });
    return;
  }

  await createConfirmation(prisma, {
    action: "archive.commit",
    summary: `File as ${archiveName} (folder ${archiveCategory})${deadline ? ` · deadline (Frist) ${deadline.toISOString().slice(0, 10)}` : ""}`,
    entity: "Document",
    entityId: documentId,
    payload: {
      documentId,
      archiveName,
      archiveCategory,
      deadline: deadline ? deadline.toISOString() : null,
      createFristenTask: Boolean(deadline),
      ...namingMeta,
    },
  });
}

async function persistExtraction(opts: {
  prisma: Awaited<ReturnType<typeof getPrisma>>;
  documentId: string;
  jobId: string | null;
  raw: string;
  structured: Record<string, unknown>;
  confidence: number;
  extension: string;
}): Promise<void> {
  const { prisma, documentId, jobId, raw, structured, confidence, extension } = opts;
  await prisma.documentExtraction.create({
    data: {
      documentId,
      jobId,
      rawJson: raw,
      structured: JSON.stringify(structured),
      confidence,
    },
  });

  const docType = asDocType(structured.documentType);
  const entity = String(
    structured.creditorName ?? structured.vendor ?? structured.provider ?? "Unknown",
  );
  const archiveName = suggestArchiveName({
    date: structured.date ? String(structured.date) : null,
    documentType: docType,
    entity,
    extension,
  });
  const archiveCategory = suggestArchiveCategory(docType);
  // Invalid OCR dueDate must become null — never Invalid Date into Prisma.
  const deadline = safeDate(structured.dueDate);

  const doc = await prisma.document.findUnique({ where: { id: documentId } });
  const mimeType = doc?.mimeType || guessMime(`file${extension}`, null);

  await prisma.document.update({
    where: { id: documentId },
    data: {
      documentType: docType,
      archiveName,
      archiveCategory,
      deadline,
    },
  });

  await createConfirmForExtraction({
    prisma,
    documentId,
    structured,
    archiveName,
    archiveCategory,
    deadline,
    documentType: docType,
    extension,
    mimeType,
  });
}

/**
 * Materialize a confirmable segment as its own archivable file.
 * Multipage segments (e.g. Genius Scan "Seite 1 von N") become a real PDF so
 * archive naming/extension match the bytes. Single-page segments keep the
 * raster extension (usually .png).
 */
async function materializeSegmentOriginal(
  destDir: string,
  segment: PageSegment,
): Promise<{ storagePath: string; mimeType: string; fileSize: number; extension: string }> {
  const pagesDir = path.join(destDir, "pages");
  await fs.mkdir(pagesDir, { recursive: true });
  for (const page of segment.pages) {
    await fs.copyFile(page.path, path.join(pagesDir, page.file));
  }

  if (segment.pages.length > 1) {
    const storagePath = path.join(destDir, "original.pdf");
    try {
      const built = await imagesToPdf(
        segment.pages.map((p) => p.path),
        storagePath,
      );
      if (built) {
        const fileSize = (await fs.stat(storagePath)).size;
        return {
          storagePath,
          mimeType: "application/pdf",
          fileSize,
          extension: ".pdf",
        };
      }
    } catch {
      // Fall through to first-page raster when PyMuPDF is unavailable/broken.
    }
  }

  const primary = segment.pages[0]!;
  const extension = path.extname(primary.file) || ".png";
  const storagePath = path.join(destDir, `original${extension}`);
  await fs.copyFile(primary.path, storagePath);
  const fileSize = (await fs.stat(storagePath)).size;
  return {
    storagePath,
    mimeType: guessMime(storagePath, "image/png"),
    fileSize,
    extension,
  };
}

function segmentRangeLabel(segment: PageSegment): string {
  return segment.startPage === segment.endPage
    ? `p${segment.startPage}`
    : `p${segment.startPage}-${segment.endPage}`;
}

/**
 * After bulk split, rewrite the parent doc so archive.commit files only segment-1
 * bytes. The unsplit multipage PDF is preserved as original-bulk{ext}.
 */
async function rewriteParentStorageToSegment(opts: {
  prisma: Awaited<ReturnType<typeof getPrisma>>;
  document: { id: string; storagePath: string; filename: string };
  segment: PageSegment;
}): Promise<{ extension: string; bulkOriginalPath: string }> {
  const dir = path.dirname(opts.document.storagePath);
  const prevExt =
    path.extname(opts.document.storagePath) || path.extname(opts.document.filename) || ".pdf";
  const bulkOriginalPath = path.join(dir, `original-bulk${prevExt}`);

  try {
    await fs.access(bulkOriginalPath);
  } catch {
    try {
      await fs.rename(opts.document.storagePath, bulkOriginalPath);
    } catch {
      await fs.copyFile(opts.document.storagePath, bulkOriginalPath);
    }
  }

  const materialized = await materializeSegmentOriginal(dir, opts.segment);
  const filename = `${path.parse(opts.document.filename).name}_${segmentRangeLabel(opts.segment)}${materialized.extension}`;

  await opts.prisma.document.update({
    where: { id: opts.document.id },
    data: {
      storagePath: materialized.storagePath,
      mimeType: materialized.mimeType,
      fileSize: materialized.fileSize,
      filename,
    },
  });

  return { extension: materialized.extension, bulkOriginalPath };
}

async function spawnChildDocument(opts: {
  prisma: Awaited<ReturnType<typeof getPrisma>>;
  profileId: string;
  parent: { id: string; filename: string };
  segment: PageSegment;
  pageOcrs: PageOcr[];
}): Promise<void> {
  const documentId = randomUUID();
  const dir = path.join(profileUploadsDir(opts.profileId), documentId);
  await fs.mkdir(dir, { recursive: true });
  const materialized = await materializeSegmentOriginal(dir, opts.segment);

  const filename = `${path.parse(opts.parent.filename).name}_${segmentRangeLabel(opts.segment)}${materialized.extension}`;

  await opts.prisma.document.create({
    data: {
      id: documentId,
      filename,
      mimeType: materialized.mimeType,
      storagePath: materialized.storagePath,
      fileSize: materialized.fileSize,
    },
  });

  const combined = combinePageOcrs(opts.pageOcrs);
  await persistExtraction({
    prisma: opts.prisma,
    documentId,
    jobId: null,
    raw: combined.raw,
    structured: {
      ...combined.structured,
      sourcePages: [opts.segment.startPage, opts.segment.endPage],
      parentDocumentId: opts.parent.id,
    },
    confidence: combined.qr ? 0.95 : 0.8,
    extension: materialized.extension,
  });

  await opts.prisma.auditLog.create({
    data: {
      action: "document.split_from_bulk",
      entity: "Document",
      entityId: documentId,
      metadata: JSON.stringify({
        parentDocumentId: opts.parent.id,
        pages: [opts.segment.startPage, opts.segment.endPage],
      }),
    },
  });
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
      data: {
        pausedReason: reason,
        progressPhase: "waiting_vision",
        progressDetail: null,
      },
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
        progressPhase: "rasterize",
        progressDetail: null,
      },
    });
    ingestionEvents.emit("queue", { profileId });

    const host = await resolveOllamaHost();
    const workDir = path.join(path.dirname(job.document.storagePath), "ocr-pages");
    await fs.rm(workDir, { recursive: true, force: true }).catch(() => undefined);

    const prepared = await prepareDocumentForOcr({
      storagePath: job.document.storagePath,
      workDir,
      mimeType: job.document.mimeType,
    });
    const warning = prepareWarning(prepared);

    // Blank-page split → phone-scanner per-page expansion
    let leafPages = expandSegmentsForPhoneScanner(segmentBulkPages(prepared.pages), {
      pageCount: prepared.manifest?.pageCount ?? prepared.pages.length,
      creator: prepared.creator,
    }).flatMap((s) => s.pages);

    if (leafPages.length === 0) {
      leafPages = prepared.pages.filter((p) => !p.blank);
    }
    if (leafPages.length === 0) throw new Error("No pages to OCR");

    // OCR every leaf page while holding the VISION lock (no interleaved reasoning)
    const pageOcrs: PageOcr[] = [];
    const totalPages = leafPages.length;
    for (let i = 0; i < leafPages.length; i++) {
      const page = leafPages[i]!;
      if (await isCancelRequested(prisma, jobId)) {
        await finalizeCancelledJob(prisma, jobId);
        return;
      }
      await setJobProgress(prisma, jobId, "ocr", `${i + 1}/${totalPages}`);
      ingestionEvents.emit("queue", { profileId });
      pageOcrs.push(await ocrPage({ host, page }));
    }

    if (await isCancelRequested(prisma, jobId)) {
      await finalizeCancelledJob(prisma, jobId);
      return;
    }

    // Re-merge "Seite 1 von N" continuations after OCR
    const finalSegments = mergeContinuationGroups(
      leafPages,
      pageOcrs.map((p) => p.structured),
    );

    const ocrByPage = new Map(pageOcrs.map((p) => [p.page.pageNumber, p]));
    const [firstSeg, ...restSegs] = finalSegments;
    if (!firstSeg) throw new Error("No segments after OCR");

    const firstOcrs = firstSeg.pages.map((p) => ocrByPage.get(p.pageNumber)!);
    const primary = combinePageOcrs(firstOcrs);
    if (warning) primary.structured.ingestWarning = warning;
    primary.structured.bulkSegments = finalSegments.length;
    primary.structured.sourcePages = [firstSeg.startPage, firstSeg.endPage];

    // Bulk split: parent must archive only segment-1 bytes, never the full stack PDF.
    let archiveExt =
      path.extname(job.document.filename) || path.extname(job.document.storagePath) || ".pdf";
    // Keep original bulk filename for child naming (parent filename becomes *_p1.png after rewrite).
    const bulkParentFilename = job.document.filename;
    if (restSegs.length > 0) {
      await setJobProgress(prisma, jobId, "split", `1/${finalSegments.length}`);
      ingestionEvents.emit("queue", { profileId });
      const rewritten = await rewriteParentStorageToSegment({
        prisma,
        document: job.document,
        segment: firstSeg,
      });
      archiveExt = rewritten.extension;
      primary.structured.bulkOriginalPreserved = path.basename(rewritten.bulkOriginalPath);
    }

    await persistExtraction({
      prisma,
      documentId: job.documentId,
      jobId: job.id,
      raw: primary.raw,
      structured: primary.structured,
      confidence: primary.qr ? 0.95 : prepared.kind === "raw" ? 0.5 : 0.8,
      extension: archiveExt,
    });

    for (let si = 0; si < restSegs.length; si++) {
      const segment = restSegs[si]!;
      if (await isCancelRequested(prisma, jobId)) {
        await finalizeCancelledJob(prisma, jobId);
        return;
      }
      await setJobProgress(prisma, jobId, "split", `${si + 2}/${finalSegments.length}`);
      ingestionEvents.emit("queue", { profileId });
      const segOcrs = segment.pages.map((p) => ocrByPage.get(p.pageNumber)!);
      await spawnChildDocument({
        prisma,
        profileId,
        parent: { id: job.document.id, filename: bulkParentFilename },
        segment,
        pageOcrs: segOcrs,
      });
    }

    if (restSegs.length > 0) {
      await prisma.auditLog.create({
        data: {
          action: "document.bulk_split",
          entity: "Document",
          entityId: job.documentId,
          metadata: JSON.stringify({
            segments: finalSegments.length,
            childCount: restSegs.length,
            creator: prepared.creator,
            parentStorageRewritten: true,
          }),
        },
      });
    }

    if (await isCancelRequested(prisma, jobId)) {
      await finalizeCancelledJob(prisma, jobId);
      return;
    }

    await prisma.ingestionJob.update({
      where: { id: jobId },
      data: {
        status: "COMPLETED",
        completedAt: new Date(),
        pausedReason: null,
        progressPhase: "await_confirm",
        progressDetail: null,
      },
    });
  } catch (err) {
    if (await isCancelRequested(prisma, jobId).catch(() => false)) {
      await finalizeCancelledJob(prisma, jobId).catch(() => undefined);
    } else {
      await prisma.ingestionJob
        .update({
          where: { id: jobId },
          data: {
            status: "FAILED",
            errorMessage: err instanceof Error ? err.message : String(err),
            completedAt: new Date(),
            pausedReason: null,
            progressPhase: "failed",
            progressDetail: null,
          },
        })
        .catch(() => undefined);
    }
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

/** Drive ensure/upload — separate from OCR so confirm→Drive is not blocked by vision. */
async function tickServerJobLane(): Promise<void> {
  if (serverJobRunning) return;
  serverJobRunning = true;
  try {
    const profileId = getActiveProfileId();
    if (!profileId) return;
    const prisma = await getPrisma(profileId);
    await recoverStaleServerJobs(prisma).catch(() => 0);
    await tickServerJobs();
  } finally {
    serverJobRunning = false;
  }
}

export function startIngestionWorker(): void {
  if (timer) return;
  timer = setInterval(() => {
    void tick();
  }, 1500);
  if (!serverJobTimer) {
    serverJobTimer = setInterval(() => {
      void tickServerJobLane();
    }, 1500);
  }
}

export function stopIngestionWorker(): void {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
  if (serverJobTimer) {
    clearInterval(serverJobTimer);
    serverJobTimer = null;
  }
}

export function storagePathForUpload(profileId: string, documentId: string, filename: string): string {
  const ext = path.extname(filename) || ".bin";
  return path.join(profileUploadsDir(profileId), documentId, `original${ext}`);
}
