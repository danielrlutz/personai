/**
 * Manual Drive folder combine (merge sources into a destination).
 * Safety: default is MOVE / skip; never overwrite; never delete unless
 * the execute payload sets an explicit per-file or empty-folder flag.
 */
import { getPrisma } from "../db/prisma-singleton.js";
import {
  cacheDriveFolderMapping,
  readDrivePrefs,
} from "./drive-oauth-store.js";
import {
  driveStatus,
  listArchiveRootChildFolders,
  listDriveFolderChildrenDetailed,
  loadDriveConfig,
  moveDriveFileBetweenFolders,
  renameDriveFile,
  trashDriveFile,
  type DriveChildItem,
  type DriveFolderListItem,
} from "./drive.js";
import {
  nextAutoRename,
  nextKeptAsideName,
  resolveDecision as resolveDecisionFlag,
  type CombineConflictAction,
  type CombineFileDecision,
} from "./folder-combine-logic.js";

export {
  nextAutoRename,
  nextKeptAsideName,
  splitFileName,
  type CombineConflictAction,
  type CombineFileDecision,
} from "./folder-combine-logic.js";

export type CombineFileSnapshot = {
  fileId: string;
  name: string;
  mimeType: string;
  size: number | null;
  modifiedTime: string | null;
  folderId: string;
  folderName: string;
  isFolder: boolean;
};

export type CombineConflict = {
  incoming: CombineFileSnapshot;
  existing: CombineFileSnapshot;
};

export type CombinePlannedMove = {
  fileId: string;
  name: string;
  mimeType: string;
  size: number | null;
  modifiedTime: string | null;
  fromFolderId: string;
  fromFolderName: string;
  isFolder: boolean;
  conflict: CombineConflict | null;
};

export type CombineDryRunReport = {
  rootFolderId: string;
  destination: DriveFolderListItem;
  sources: DriveFolderListItem[];
  moves: CombinePlannedMove[];
  conflictCount: number;
  moveCount: number;
  emptySourcesAfter: DriveFolderListItem[];
  neverSilentDeletes: true;
  note: string;
  dryRunAt: string;
};

export type DriveCombineJobPayload = {
  destinationFolderId: string;
  destinationFolderName: string;
  sourceFolderIds: string[];
  sourceFolderNames: string[];
  dryRunAt: string;
  decisions: Record<string, CombineFileDecision>;
  removeEmptySourceFolders: boolean;
  iUnderstandRemoveEmptySourceFolders: boolean;
};

export type CombineExecuteRequest = {
  destinationFolderId: string;
  sourceFolderIds: string[];
  /** Required — client must have reviewed a dry-run. */
  dryRunAt: string;
  decisions?: Record<string, CombineFileDecision>;
  removeEmptySourceFolders?: boolean;
  iUnderstandRemoveEmptySourceFolders?: boolean;
};

export type CombineExecutePrepared = {
  payload: DriveCombineJobPayload;
  preview: CombineDryRunReport;
  message: string;
};

export type CombineJobResult = {
  moved: number;
  skipped: number;
  renamed: number;
  trashed: number;
  emptyFoldersRemoved: number;
  errors: string[];
  destinationFolderId: string;
  sourceFolderIds: string[];
};

export function resolveDecision(
  conflict: CombineConflict | null,
  decision: CombineFileDecision | undefined,
): CombineConflictAction {
  return resolveDecisionFlag(Boolean(conflict), decision);
}

function assertDriveLinked(profileId: string): void {
  const status = driveStatus(profileId);
  if (!status.enabled && !status.linked) {
    throw new Error(status.message || "Google Drive is not linked.");
  }
}

function toSnapshot(
  item: DriveChildItem,
  folderId: string,
  folderName: string,
): CombineFileSnapshot {
  return {
    fileId: item.id,
    name: item.name,
    mimeType: item.mimeType,
    size: item.size,
    modifiedTime: item.modifiedTime,
    folderId,
    folderName,
    isFolder: item.isFolder,
  };
}

function requireRootFolders(
  folders: DriveFolderListItem[],
  destinationFolderId: string,
  sourceFolderIds: string[],
): { destination: DriveFolderListItem; sources: DriveFolderListItem[] } {
  const byId = new Map(folders.map((f) => [f.id, f]));
  const destination = byId.get(destinationFolderId);
  if (!destination) {
    throw new Error(
      "Destination must be a direct child of the archive root (from the scanned folder map).",
    );
  }
  const uniqueSources = [...new Set(sourceFolderIds.map((id) => String(id).trim()).filter(Boolean))];
  if (uniqueSources.length < 1) {
    throw new Error("Select at least one source folder to merge into the destination.");
  }
  if (uniqueSources.includes(destinationFolderId)) {
    throw new Error("Destination cannot also be a source folder.");
  }
  const sources: DriveFolderListItem[] = [];
  for (const id of uniqueSources) {
    const folder = byId.get(id);
    if (!folder) {
      throw new Error(`Source folder ${id} is not under the archive root.`);
    }
    sources.push(folder);
  }
  return { destination, sources };
}

export async function listCombineFolders(profileId: string): Promise<{
  rootFolderId: string | null;
  folders: DriveFolderListItem[];
  note: string;
}> {
  assertDriveLinked(profileId);
  const listed = await listArchiveRootChildFolders(profileId);
  return {
    rootFolderId: listed.rootFolderId,
    folders: listed.folders,
    note: "Pick a destination, then one or more source folders to merge into it. Nothing is moved until you confirm after the dry-run.",
  };
}

export async function dryRunCombineFolders(
  profileId: string,
  opts: { destinationFolderId: string; sourceFolderIds: string[] },
): Promise<CombineDryRunReport> {
  assertDriveLinked(profileId);
  const cfg = loadDriveConfig(profileId);
  if (!cfg.rootFolderId) throw new Error("Archive root folder is not set.");

  const listed = await listArchiveRootChildFolders(profileId);
  const { destination, sources } = requireRootFolders(
    listed.folders,
    opts.destinationFolderId,
    opts.sourceFolderIds,
  );

  const destChildren = await listDriveFolderChildrenDetailed(cfg, destination.id);
  const destByName = new Map(destChildren.map((c) => [c.name.toLowerCase(), c]));

  const moves: CombinePlannedMove[] = [];
  for (const source of sources) {
    const children = await listDriveFolderChildrenDetailed(cfg, source.id);
    for (const child of children) {
      const existing = destByName.get(child.name.toLowerCase()) ?? null;
      const incoming = toSnapshot(child, source.id, source.name);
      moves.push({
        fileId: child.id,
        name: child.name,
        mimeType: child.mimeType,
        size: child.size,
        modifiedTime: child.modifiedTime,
        fromFolderId: source.id,
        fromFolderName: source.name,
        isFolder: child.isFolder,
        conflict: existing
          ? {
              incoming,
              existing: toSnapshot(existing, destination.id, destination.name),
            }
          : null,
      });
    }
  }

  const conflictCount = moves.filter((m) => m.conflict).length;
  const dryRunAt = new Date().toISOString();

  return {
    rootFolderId: cfg.rootFolderId,
    destination,
    sources,
    moves,
    conflictCount,
    moveCount: moves.length,
    emptySourcesAfter: sources,
    neverSilentDeletes: true,
    note:
      conflictCount > 0
        ? `${moves.length} item(s) would move; ${conflictCount} name conflict(s). Choose Keep destination / Keep incoming / Keep both / Skip per conflict. Nothing is deleted unless you tick an explicit trash confirm.`
        : `${moves.length} item(s) would move into “${destination.name}” with no name conflicts. Source folders are not deleted unless you opt in after review.`,
    dryRunAt,
  };
}

/** Rewrite categories whose cache pointed at a merged-away source. */
export function retargetCachedFoldersToDestination(
  profileId: string,
  destinationFolderId: string,
  destinationName: string,
  sourceFolderIds: string[],
): number {
  const prefs = readDrivePrefs(profileId);
  if (!prefs?.folderIds) return 0;
  const sources = new Set(sourceFolderIds);
  let updated = 0;
  for (const [catStr, folderId] of Object.entries(prefs.folderIds)) {
    if (!folderId || !sources.has(folderId)) continue;
    const category = Number(catStr);
    if (!Number.isInteger(category) || category < 1 || category > 10) continue;
    const prevMeta = prefs.folderMatchMeta?.[category];
    cacheDriveFolderMapping(profileId, category, destinationFolderId, {
      source: "prefer",
      matchedName: destinationName,
      duplicates: (prevMeta?.duplicates ?? []).filter((d) => !sources.has(d.id)),
    });
    updated += 1;
  }
  return updated;
}

/** Validate execute body + return a durable job payload (routes enqueue ServerJob). */
export async function prepareCombineFoldersExecute(
  profileId: string,
  body: CombineExecuteRequest,
): Promise<CombineExecutePrepared> {
  assertDriveLinked(profileId);
  if (!body.dryRunAt || typeof body.dryRunAt !== "string") {
    throw new Error("Review the dry-run preview before confirming combine (dryRunAt required).");
  }
  const dryRunAgeMs = Date.now() - Date.parse(body.dryRunAt);
  if (!Number.isFinite(dryRunAgeMs) || dryRunAgeMs < 0 || dryRunAgeMs > 60 * 60 * 1000) {
    throw new Error("Dry-run expired or invalid. Run Combine preview again, then confirm.");
  }

  const preview = await dryRunCombineFolders(profileId, {
    destinationFolderId: body.destinationFolderId,
    sourceFolderIds: body.sourceFolderIds,
  });

  if (body.removeEmptySourceFolders && !body.iUnderstandRemoveEmptySourceFolders) {
    throw new Error(
      "To remove empty source folders, tick “I understand this removes the folder from Drive”.",
    );
  }

  // Fail closed: every conflict needs an explicit decision (default keep_both is OK).
  for (const move of preview.moves) {
    if (!move.conflict) continue;
    resolveDecision(move.conflict, body.decisions?.[move.fileId]);
  }

  const payload: DriveCombineJobPayload = {
    destinationFolderId: preview.destination.id,
    destinationFolderName: preview.destination.name,
    sourceFolderIds: preview.sources.map((s) => s.id),
    sourceFolderNames: preview.sources.map((s) => s.name),
    dryRunAt: body.dryRunAt,
    decisions: body.decisions ?? {},
    removeEmptySourceFolders: Boolean(body.removeEmptySourceFolders),
    iUnderstandRemoveEmptySourceFolders: Boolean(body.iUnderstandRemoveEmptySourceFolders),
  };

  return {
    payload,
    preview,
    message:
      "Combine queued. Progress is tracked as a server job. Nothing was deleted unless you set explicit trash flags.",
  };
}

export async function processCombineFoldersJob(
  profileId: string,
  payload: DriveCombineJobPayload,
): Promise<CombineJobResult> {
  const cfg = loadDriveConfig(profileId);
  if (!cfg.enabled || cfg.mode === "none") {
    throw new Error("Google Drive is not linked.");
  }

  const preview = await dryRunCombineFolders(profileId, {
    destinationFolderId: payload.destinationFolderId,
    sourceFolderIds: payload.sourceFolderIds,
  });

  const result: CombineJobResult = {
    moved: 0,
    skipped: 0,
    renamed: 0,
    trashed: 0,
    emptyFoldersRemoved: 0,
    errors: [],
    destinationFolderId: payload.destinationFolderId,
    sourceFolderIds: payload.sourceFolderIds,
  };

  const destChildren = await listDriveFolderChildrenDetailed(cfg, payload.destinationFolderId);
  const takenNames = new Set(destChildren.map((c) => c.name));

  for (const move of preview.moves) {
    try {
      if (!move.conflict) {
        await moveDriveFileBetweenFolders(cfg, {
          fileId: move.fileId,
          fromFolderId: move.fromFolderId,
          toFolderId: payload.destinationFolderId,
        });
        takenNames.add(move.name);
        result.moved += 1;
        continue;
      }

      const decision = payload.decisions?.[move.fileId];
      const action = resolveDecision(move.conflict, decision);

      if (action === "skip" || action === "keep_destination") {
        result.skipped += 1;
        continue;
      }

      if (action === "keep_both") {
        const newName = nextAutoRename(move.name, takenNames, move.isFolder);
        await moveDriveFileBetweenFolders(cfg, {
          fileId: move.fileId,
          fromFolderId: move.fromFolderId,
          toFolderId: payload.destinationFolderId,
          newName: newName !== move.name ? newName : undefined,
        });
        takenNames.add(newName);
        if (newName !== move.name) result.renamed += 1;
        result.moved += 1;
        continue;
      }

      // keep_incoming
      const existing = move.conflict.existing;
      if (decision?.trashOther) {
        await trashDriveFile(cfg, existing.fileId);
        result.trashed += 1;
        takenNames.delete(existing.name);
      } else {
        const aside = nextKeptAsideName(existing.name, takenNames, existing.isFolder);
        await renameDriveFile(cfg, existing.fileId, aside);
        takenNames.delete(existing.name);
        takenNames.add(aside);
        result.renamed += 1;
      }

      await moveDriveFileBetweenFolders(cfg, {
        fileId: move.fileId,
        fromFolderId: move.fromFolderId,
        toFolderId: payload.destinationFolderId,
      });
      takenNames.add(move.name);
      result.moved += 1;
    } catch (err) {
      result.errors.push(
        `${move.name}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  if (
    payload.removeEmptySourceFolders &&
    payload.iUnderstandRemoveEmptySourceFolders
  ) {
    for (const sourceId of payload.sourceFolderIds) {
      try {
        const left = await listDriveFolderChildrenDetailed(cfg, sourceId);
        if (left.length > 0) continue;
        await trashDriveFile(cfg, sourceId);
        result.emptyFoldersRemoved += 1;
      } catch (err) {
        result.errors.push(
          `empty folder ${sourceId}: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }
  }

  const prefsUpdated = retargetCachedFoldersToDestination(
    profileId,
    payload.destinationFolderId,
    payload.destinationFolderName,
    payload.sourceFolderIds,
  );

  const prisma = await getPrisma(profileId);
  await prisma.auditLog.create({
    data: {
      action: "archive.drive_combine",
      entity: "DriveFolder",
      entityId: payload.destinationFolderId,
      metadata: JSON.stringify({
        ...result,
        prefsUpdated,
        sourceFolderNames: payload.sourceFolderNames,
        destinationFolderName: payload.destinationFolderName,
      }),
    },
  });

  return result;
}
