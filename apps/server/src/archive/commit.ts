import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { getActiveProfileId } from "../db/prisma-singleton.js";
import { profileArchiveDir } from "../config.js";
import { ARCHIVE_TAXONOMY } from "../specialists/roster.js";
import { uploadFileToDrive, type DriveUploadResult } from "./drive.js";

export type ArchiveCommitResult = {
  localPath: string;
  archiveName: string;
  archiveCategory: number;
  folderLabel: string;
  drive: DriveUploadResult | null;
  driveError: string | null;
};

export function taxonomyFolderName(archiveCategory: number): string {
  const label =
    ARCHIVE_TAXONOMY[archiveCategory as keyof typeof ARCHIVE_TAXONOMY] ?? "Misc";
  return `${String(archiveCategory).padStart(2, "0")}_${label}`;
}

function guessMime(filePath: string, fallback?: string | null): string {
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
    default:
      return fallback || "application/octet-stream";
  }
}

/**
 * Copy document into local taxonomy archive with canonical name,
 * then optionally upload to Google Drive when configured.
 */
export async function commitDocumentToArchive(opts: {
  profileId?: string | null;
  sourcePath: string;
  archiveName: string;
  archiveCategory: number;
  mimeType?: string | null;
}): Promise<ArchiveCommitResult> {
  const profileId = opts.profileId || getActiveProfileId();
  if (!profileId) throw new Error("No active profile for archive commit");

  const safeName = path.basename(opts.archiveName).replace(/[<>:"|?*\\/]/g, "_");
  const folderLabel = taxonomyFolderName(opts.archiveCategory);
  const destDir = path.join(profileArchiveDir(profileId), folderLabel);
  fs.mkdirSync(destDir, { recursive: true });

  let destPath = path.join(destDir, safeName);
  if (fs.existsSync(destPath)) {
    const parsed = path.parse(safeName);
    destPath = path.join(destDir, `${parsed.name}_${Date.now()}${parsed.ext}`);
  }

  await fsp.copyFile(opts.sourcePath, destPath);

  let drive: DriveUploadResult | null = null;
  let driveError: string | null = null;
  try {
    drive = await uploadFileToDrive({
      localPath: destPath,
      name: path.basename(destPath),
      mimeType: guessMime(destPath, opts.mimeType),
      archiveCategory: opts.archiveCategory,
    });
  } catch (err) {
    // Local archive succeeded; Drive is best-effort when misconfigured.
    driveError = err instanceof Error ? err.message : String(err);
  }

  return {
    localPath: destPath,
    archiveName: path.basename(destPath),
    archiveCategory: opts.archiveCategory,
    folderLabel,
    drive,
    driveError,
  };
}
