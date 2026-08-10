/**
 * Durable profile-scoped server jobs (Drive upload / folder ensure).
 * Processed by the same worker tick as ingestion — keyed by profile, not browser tab.
 */
import type { PrismaClient, ServerJob } from "@prisma/client";
import { EventEmitter } from "node:events";
import { getPrisma, getActiveProfileId } from "../db/prisma-singleton.js";
import { uploadFileToDrive, resolveFolderForCategory, loadDriveConfig } from "../archive/drive.js";
import { guessMime } from "../archive/commit.js";

export const serverJobEvents = new EventEmitter();

export const SERVER_JOB_DRIVE_UPLOAD = "drive.upload";
export const SERVER_JOB_DRIVE_ENSURE = "drive.ensure_folders";

export type DriveUploadJobPayload = {
  localPath: string;
  name: string;
  mimeType?: string | null;
  archiveCategory: number;
  documentId?: string | null;
};

export type DriveEnsureJobPayload = {
  categories?: number[];
};

function parsePayload<T>(raw: string): T {
  try {
    return JSON.parse(raw || "{}") as T;
  } catch {
    return {} as T;
  }
}

export async function enqueueServerJob(
  prisma: PrismaClient,
  opts: {
    type: string;
    payload: unknown;
    documentId?: string | null;
  },
): Promise<ServerJob> {
  const job = await prisma.serverJob.create({
    data: {
      type: opts.type,
      status: "QUEUED",
      documentId: opts.documentId ?? null,
      payload: JSON.stringify(opts.payload ?? {}),
    },
  });
  const profileId = getActiveProfileId();
  if (profileId) serverJobEvents.emit("queue", { profileId, jobId: job.id });
  return job;
}

export async function getServerJob(
  prisma: PrismaClient,
  id: string,
): Promise<ServerJob | null> {
  return prisma.serverJob.findUnique({ where: { id } });
}

export function serializeServerJob(job: ServerJob) {
  return {
    id: job.id,
    type: job.type,
    status: job.status,
    documentId: job.documentId,
    payload: parsePayload(job.payload),
    result: job.result ? parsePayload(job.result) : null,
    errorMessage: job.errorMessage,
    attempts: job.attempts,
    startedAt: job.startedAt,
    completedAt: job.completedAt,
    createdAt: job.createdAt,
  };
}

async function processDriveUpload(
  prisma: PrismaClient,
  profileId: string,
  job: ServerJob,
): Promise<Record<string, unknown>> {
  const payload = parsePayload<DriveUploadJobPayload>(job.payload);
  if (!payload.localPath || !payload.name || payload.archiveCategory == null) {
    throw new Error("drive.upload payload missing localPath/name/archiveCategory");
  }
  const drive = await uploadFileToDrive({
    profileId,
    localPath: payload.localPath,
    name: payload.name,
    mimeType: guessMime(payload.localPath, payload.mimeType),
    archiveCategory: Number(payload.archiveCategory),
  });
  if (!drive) {
    return { skipped: true, reason: "Drive not enabled" };
  }
  if (payload.documentId) {
    await prisma.auditLog.create({
      data: {
        action: "archive.drive_upload",
        entity: "Document",
        entityId: String(payload.documentId),
        metadata: JSON.stringify({
          driveFileId: drive.fileId,
          driveFolderId: drive.folderId,
          name: drive.name,
          jobId: job.id,
        }),
      },
    });
  }
  return {
    fileId: drive.fileId,
    folderId: drive.folderId,
    webViewLink: drive.webViewLink,
    name: drive.name,
  };
}

async function processDriveEnsure(
  profileId: string,
  job: ServerJob,
): Promise<Record<string, unknown>> {
  const payload = parsePayload<DriveEnsureJobPayload>(job.payload);
  const cfg = loadDriveConfig(profileId);
  if (!cfg.enabled || !cfg.rootFolderId) {
    return { skipped: true, reason: "Drive not linked" };
  }
  const categories =
    Array.isArray(payload.categories) && payload.categories.length > 0
      ? payload.categories
      : [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
  const mapped: Record<number, string | null> = {};
  for (const cat of categories) {
    mapped[cat] = await resolveFolderForCategory(cfg, cat, { createIfMissing: false });
  }
  return { mapped };
}

async function processOneJob(profileId: string, jobId: string): Promise<void> {
  const prisma = await getPrisma(profileId);
  const job = await prisma.serverJob.findUnique({ where: { id: jobId } });
  if (!job || job.status !== "QUEUED") return;

  await prisma.serverJob.update({
    where: { id: jobId },
    data: {
      status: "PROCESSING",
      startedAt: new Date(),
      attempts: { increment: 1 },
      errorMessage: null,
    },
  });
  serverJobEvents.emit("queue", { profileId, jobId });

  try {
    let result: Record<string, unknown>;
    switch (job.type) {
      case SERVER_JOB_DRIVE_UPLOAD:
        result = await processDriveUpload(prisma, profileId, job);
        break;
      case SERVER_JOB_DRIVE_ENSURE:
        result = await processDriveEnsure(profileId, job);
        break;
      default:
        throw new Error(`Unknown server job type: ${job.type}`);
    }
    await prisma.serverJob.update({
      where: { id: jobId },
      data: {
        status: "COMPLETED",
        result: JSON.stringify(result),
        completedAt: new Date(),
      },
    });
  } catch (err) {
    await prisma.serverJob.update({
      where: { id: jobId },
      data: {
        status: "FAILED",
        errorMessage: err instanceof Error ? err.message : String(err),
        completedAt: new Date(),
      },
    });
  } finally {
    serverJobEvents.emit("queue", { profileId, jobId });
  }
}

/** Drain one queued ServerJob for the active profile (no VRAM lock needed). */
export async function tickServerJobs(): Promise<boolean> {
  const profileId = getActiveProfileId();
  if (!profileId) return false;
  const prisma = await getPrisma(profileId);
  const next = await prisma.serverJob.findFirst({
    where: { status: "QUEUED" },
    orderBy: { createdAt: "asc" },
  });
  if (!next) return false;
  await processOneJob(profileId, next.id);
  return true;
}

/** Re-queue stuck PROCESSING jobs after process restart (best-effort). */
export async function recoverStaleServerJobs(prisma: PrismaClient): Promise<number> {
  const staleBefore = new Date(Date.now() - 30 * 60 * 1000);
  const result = await prisma.serverJob.updateMany({
    where: {
      status: "PROCESSING",
      startedAt: { lt: staleBefore },
    },
    data: { status: "QUEUED", errorMessage: "Recovered after stale PROCESSING" },
  });
  return result.count;
}
