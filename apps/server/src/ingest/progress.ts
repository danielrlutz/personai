import type { PrismaClient } from "@prisma/client";
import { CANCEL_REQUESTED } from "./cancel-job.js";

/** Canonical ingest-lane phases surfaced on Home / Archive queue. */
export type IngestPhase =
  | "queued"
  | "waiting_vision"
  | "rasterize"
  | "ocr"
  | "split"
  | "await_confirm"
  | "cancelling"
  | "failed"
  | "done";

export const INGEST_PHASE_ORDER: IngestPhase[] = [
  "rasterize",
  "ocr",
  "split",
  "await_confirm",
];

type JobLike = {
  status: string;
  pausedReason?: string | null;
  progressPhase?: string | null;
  progressDetail?: string | null;
  documentId: string;
  document?: {
    confirmedAt?: Date | null;
  } | null;
};

/** Persist worker phase + optional detail; best-effort (never throws to caller). */
export async function setJobProgress(
  prisma: PrismaClient,
  jobId: string,
  phase: IngestPhase,
  detail?: string | null,
): Promise<void> {
  await prisma.ingestionJob
    .update({
      where: { id: jobId },
      data: {
        progressPhase: phase,
        progressDetail: detail ?? null,
      },
    })
    .catch(() => undefined);
}

export function deriveIngestPhase(
  job: JobLike,
  pendingConfirmDocIds: Set<string>,
): { phase: IngestPhase; detail: string | null } {
  if (job.pausedReason === CANCEL_REQUESTED) {
    return { phase: "cancelling", detail: job.progressDetail ?? null };
  }

  const status = (job.status ?? "").toUpperCase();
  if (status === "FAILED") {
    return { phase: "failed", detail: null };
  }

  if (status === "QUEUED") {
    if (job.pausedReason?.startsWith("waiting_for_vram")) {
      return { phase: "waiting_vision", detail: null };
    }
    return { phase: "queued", detail: null };
  }

  if (status === "PROCESSING") {
    const stored = normalizePhase(job.progressPhase);
    if (stored && stored !== "queued" && stored !== "await_confirm" && stored !== "done") {
      return { phase: stored, detail: job.progressDetail ?? null };
    }
    if (job.pausedReason?.startsWith("waiting_for_vram")) {
      return { phase: "waiting_vision", detail: null };
    }
    return { phase: "ocr", detail: job.progressDetail ?? null };
  }

  if (status === "COMPLETED") {
    if (pendingConfirmDocIds.has(job.documentId)) {
      return { phase: "await_confirm", detail: null };
    }
    return { phase: "done", detail: null };
  }

  return { phase: "queued", detail: job.progressDetail ?? null };
}

function normalizePhase(raw: string | null | undefined): IngestPhase | null {
  if (!raw) return null;
  const allowed: IngestPhase[] = [
    "queued",
    "waiting_vision",
    "rasterize",
    "ocr",
    "split",
    "await_confirm",
    "cancelling",
    "failed",
    "done",
  ];
  return allowed.includes(raw as IngestPhase) ? (raw as IngestPhase) : null;
}

/** Attach derived phase fields for API consumers (Home lane glass). */
export function withDerivedPhase<T extends JobLike>(
  job: T,
  pendingConfirmDocIds: Set<string>,
): T & { phase: IngestPhase; phaseDetail: string | null; awaitingConfirm: boolean } {
  const { phase, detail } = deriveIngestPhase(job, pendingConfirmDocIds);
  return {
    ...job,
    phase,
    phaseDetail: detail,
    awaitingConfirm: phase === "await_confirm",
  };
}

export async function loadPendingConfirmDocIds(
  prisma: PrismaClient,
  documentIds: string[],
): Promise<Set<string>> {
  if (documentIds.length === 0) return new Set();
  const rows = await prisma.pendingConfirmation.findMany({
    where: {
      status: "pending",
      entity: "Document",
      entityId: { in: documentIds },
      action: { in: ["archive.commit", "ledger.write"] },
    },
    select: { entityId: true },
  });
  return new Set(rows.map((r) => r.entityId).filter((id): id is string => Boolean(id)));
}
