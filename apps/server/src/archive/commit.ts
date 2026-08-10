import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { getActiveProfileId } from "../db/prisma-singleton.js";
import { profileArchiveDir } from "../config.js";
import { ARCHIVE_TAXONOMY } from "../specialists/roster.js";
import { loadDriveConfig, uploadFileToDrive, type DriveUploadResult } from "./drive.js";

export type ArchiveCommitResult = {
  localPath: string;
  archiveName: string;
  archiveCategory: number;
  folderLabel: string;
  drive: DriveUploadResult | null;
  driveError: string | null;
  /** True when Drive is enabled but upload was deferred to a ServerJob. */
  driveDeferred: boolean;
};

export function taxonomyFolderName(archiveCategory: number): string {
  const label =
    ARCHIVE_TAXONOMY[archiveCategory as keyof typeof ARCHIVE_TAXONOMY] ?? "Misc";
  return `${String(archiveCategory).padStart(2, "0")}_${label}`;
}

export function guessMime(filePath: string, fallback?: string | null): string {
  const ext = path.extname(filePath).toLowerCase();
  switch (ext) {
    case ".pdf":
      return "application/pdf";
    case ".png":
      return "image/png";
    case ".jpg":
    case ".jpeg":
      return "image/jpeg";
    case ".webp":
      return "image/webp";
    case ".heic":
    case ".heif":
      return "image/heic";
    default:
      return fallback || "application/octet-stream";
  }
}

/**
 * Keep archive filename extension aligned with the real source bytes.
 * Prevents PNG (or JPEG) content being filed/uploaded as a misleading `.pdf`.
 */
export function reconcileArchiveExtension(
  archiveName: string,
  sourcePath: string,
): string {
  const safeBase = path.basename(archiveName || "document").replace(/[<>:"|?*\\/]/g, "_");
  const sourceExt = path.extname(sourcePath).toLowerCase();
  if (!sourceExt) return safeBase || "document";
  const parsed = path.parse(safeBase || "document");
  const nameExt = parsed.ext.toLowerCase();
  if (nameExt === sourceExt) return `${parsed.name || "document"}${sourceExt}`;
  return `${parsed.name || "document"}${sourceExt}`;
}

/**
 * Copy document into local taxonomy archive with canonical name,
 * then optionally upload to Google Drive when configured.
 *
 * Prefer deferDrive=true from confirm/apply paths so Drive work continues
 * as a ServerJob after the HTTP response (navigate-safe).
 */
export async function commitDocumentToArchive(opts: {
  profileId?: string | null;
  sourcePath: string;
  archiveName: string;
  archiveCategory: number;
  mimeType?: string | null;
  /** Skip inline Drive upload; caller enqueues ServerJob. Default false. */
  deferDrive?: boolean;
}): Promise<ArchiveCommitResult> {
  const profileId = opts.profileId || getActiveProfileId();
  if (!profileId) throw new Error("No active profile for archive commit");

  const safeName = reconcileArchiveExtension(opts.archiveName, opts.sourcePath);
  const folderLabel = taxonomyFolderName(opts.archiveCategory);
  const destDir = path.join(profileArchiveDir(profileId), folderLabel);
  fs.mkdirSync(destDir, { recursive: true });

  let destPath = path.join(destDir, safeName);
  if (fs.existsSync(destPath)) {
    const parsed = path.parse(safeName);
    destPath = path.join(destDir, `${parsed.name}_${Date.now()}${parsed.ext}`);
  }

  await fsp.copyFile(opts.sourcePath, destPath);

  const mimeType = guessMime(destPath, opts.mimeType);
  const driveEnabled = loadDriveConfig(profileId).enabled;

  if (opts.deferDrive && driveEnabled) {
    return {
      localPath: destPath,
      archiveName: path.basename(destPath),
      archiveCategory: opts.archiveCategory,
      folderLabel,
      drive: null,
      driveError: null,
      driveDeferred: true,
    };
  }

  let drive: DriveUploadResult | null = null;
  let driveError: string | null = null;
  if (driveEnabled) {
    try {
      drive = await uploadFileToDrive({
        profileId,
        localPath: destPath,
        name: path.basename(destPath),
        mimeType,
        archiveCategory: opts.archiveCategory,
      });
    } catch (err) {
      // Local archive succeeded; Drive is best-effort when misconfigured.
      driveError = err instanceof Error ? err.message : String(err);
    }
  }

  return {
    localPath: destPath,
    archiveName: path.basename(destPath),
    archiveCategory: opts.archiveCategory,
    folderLabel,
    drive,
    driveError,
    driveDeferred: false,
  };
}
