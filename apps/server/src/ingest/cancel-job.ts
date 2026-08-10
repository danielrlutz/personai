import fs from "node:fs/promises";
import path from "node:path";
import type { PrismaClient } from "@prisma/client";

/** Set on IngestionJob.pausedReason while OCR is in flight. */
export const CANCEL_REQUESTED = "cancel_requested";

export type CancelJobResult = {
  ok: true;
  mode: "removed" | "cancelling";
  jobId: string;
  documentId: string;
  documentDeleted: boolean;
};

function isArchivedDocument(doc: {
  confirmedAt: Date | null;
  archiveName?: string | null;
}): boolean {
  return Boolean(doc.confirmedAt);
}

async function expirePendingForDocument(
  prisma: PrismaClient,
  documentId: string,
): Promise<void> {
  await prisma.pendingConfirmation.updateMany({
    where: {
      status: "pending",
      entity: "Document",
      entityId: documentId,
    },
    data: { status: "expired", resolvedAt: new Date() },
  });
}

async function removeLocalUploadDir(storagePath: string): Promise<void> {
  const dir = path.dirname(storagePath);
  try {
    await fs.rm(dir, { recursive: true, force: true });
  } catch {
    // best-effort cleanup
  }
}

/**
 * Delete an ingest job. Unconfirmed upload docs are removed; archived/confirmed
 * Drive/local archive files are never deleted — only the queue row goes away.
 */
export async function cancelIngestJob(
  prisma: PrismaClient,
  jobId: string,
): Promise<CancelJobResult> {
  const job = await prisma.ingestionJob.findUnique({
    where: { id: jobId },
    include: { document: true },
  });
  if (!job) {
    const err = new Error("Job not found");
    (err as Error & { statusCode?: number }).statusCode = 404;
    throw err;
  }

  const documentId = job.documentId;

  if (job.status === "PROCESSING") {
    await prisma.ingestionJob.update({
      where: { id: jobId },
      data: {
        pausedReason: CANCEL_REQUESTED,
        errorMessage: "Cancelled by user",
        progressPhase: "cancelling",
        progressDetail: null,
      },
    });
    return {
      ok: true,
      mode: "cancelling",
      jobId,
      documentId,
      documentDeleted: false,
    };
  }

  const archived = isArchivedDocument(job.document);
  await expirePendingForDocument(prisma, documentId);

  if (archived) {
    await prisma.ingestionJob.delete({ where: { id: jobId } });
    return {
      ok: true,
      mode: "removed",
      jobId,
      documentId,
      documentDeleted: false,
    };
  }

  const storagePath = job.document.storagePath;
  await prisma.ingestionJob.delete({ where: { id: jobId } });
  // Cascade deletes jobs/extractions; document may remain if FK elsewhere — delete explicitly.
  try {
    await prisma.document.delete({ where: { id: documentId } });
  } catch {
    // Linked ledger rows may block delete; still removed from queue.
  }
  await removeLocalUploadDir(storagePath);

  return {
    ok: true,
    mode: "removed",
    jobId,
    documentId,
    documentDeleted: true,
  };
}

/** Worker-side: finish a cancel that was requested mid-PROCESSING. */
export async function finalizeCancelledJob(
  prisma: PrismaClient,
  jobId: string,
): Promise<void> {
  const job = await prisma.ingestionJob.findUnique({
    where: { id: jobId },
    include: { document: true },
  });
  if (!job) return;

  const archived = isArchivedDocument(job.document);
  await expirePendingForDocument(prisma, job.documentId);

  if (archived) {
    await prisma.ingestionJob
      .update({
        where: { id: jobId },
        data: {
          status: "FAILED",
          errorMessage: "Cancelled by user",
          completedAt: new Date(),
          pausedReason: null,
        },
      })
      .catch(() => undefined);
    return;
  }

  const storagePath = job.document.storagePath;
  await prisma.ingestionJob.delete({ where: { id: jobId } }).catch(() => undefined);
  try {
    await prisma.document.delete({ where: { id: job.documentId } });
  } catch {
    // ignore FK conflicts
  }
  await removeLocalUploadDir(storagePath);
}

export async function isCancelRequested(
  prisma: PrismaClient,
  jobId: string,
): Promise<boolean> {
  const job = await prisma.ingestionJob.findUnique({
    where: { id: jobId },
    select: { pausedReason: true, errorMessage: true },
  });
  if (!job) return true;
  return (
    job.pausedReason === CANCEL_REQUESTED ||
    job.errorMessage === "Cancelled by user"
  );
}
