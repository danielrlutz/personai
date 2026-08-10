import { buildJahresaktePack } from "./jahresakte-pack.js";
import { loadDriveConfig } from "../archive/drive.js";
import { getActiveProfileId } from "../db/prisma-singleton.js";
import {
  enqueueServerJob,
  serializeServerJob,
  SERVER_JOB_DRIVE_UPLOAD,
} from "../jobs/server-jobs.js";

/** Confirm apply for action `jahresakte.export` — local ZIP/PDF index, optional Drive job. */
export async function applyJahresakteExport(prisma: unknown, payload: Record<string, unknown>) {
  const profileId = getActiveProfileId();
  if (!profileId) throw new Error("No active profile");
  const year = Number(payload.year);
  const documentIds = Array.isArray(payload.documentIds)
    ? payload.documentIds.map(String)
    : [];
  const categories = Array.isArray(payload.categories)
    ? payload.categories.map(Number)
    : undefined;
  const uploadToDrive = Boolean(payload.uploadToDrive);

  const pack = await buildJahresaktePack(prisma as never, {
    profileId,
    year,
    documentIds,
    categories,
  });

  let driveJob = null;
  if (uploadToDrive) {
    const drive = loadDriveConfig(profileId);
    if (drive.enabled) {
      const job = await enqueueServerJob(prisma as never, {
        type: SERVER_JOB_DRIVE_UPLOAD,
        payload: {
          localPath: pack.zipPath,
          name: pack.zipName,
          mimeType: "application/zip",
          archiveCategory: 4,
        },
      });
      driveJob = serializeServerJob(job);
    }
  }

  return { pack, driveJob };
}
