/**
 * Drive taxonomy health: detect duplicate category folders under the archive
 * root (e.g. 01_Official vs 1. Official Documents) and suggest a winner.
 * Never deletes Drive folders — only coaches + caches a preferred mapping.
 */
import { ARCHIVE_TAXONOMY } from "../specialists/roster.js";
import {
  isPersonAiStyleName,
  matchFolderForCategory,
  type DriveFolderCandidate,
} from "./folder-match.js";
import type { DriveFolderMatchMeta } from "./drive-oauth-store.js";

export type TaxonomyHealthFolder = {
  id: string;
  name: string;
  fileCount: number;
  isPersonAiStyle: boolean;
};

export type TaxonomyHealthIssue = {
  category: number;
  label: string;
  suggested: TaxonomyHealthFolder;
  duplicates: TaxonomyHealthFolder[];
  reason: string;
  cachedFolderId: string | null;
  cachedMatchesSuggested: boolean;
};

export type TaxonomyHealthMapping = {
  category: number;
  label: string;
  folderId: string | null;
  folderName: string | null;
  source: DriveFolderMatchMeta["source"] | null;
  hasDuplicates: boolean;
};

export type TaxonomyHealthReport = {
  rootFolderId: string | null;
  scannedAt: string;
  childFolderCount: number;
  issues: TaxonomyHealthIssue[];
  mappings: TaxonomyHealthMapping[];
  /** Always true — product promise. */
  neverDeletesFolders: true;
  note: string;
};

function toHealthFolder(category: number, f: DriveFolderCandidate): TaxonomyHealthFolder {
  return {
    id: f.id,
    name: f.name,
    fileCount: f.fileCount ?? 0,
    isPersonAiStyle: isPersonAiStyleName(f.name, category),
  };
}

export function suggestWinnerReason(
  category: number,
  suggested: TaxonomyHealthFolder,
  duplicates: TaxonomyHealthFolder[],
): string {
  const others = duplicates;
  const maxOther = others.reduce((m, d) => Math.max(m, d.fileCount), 0);
  if (suggested.fileCount > maxOther) {
    return `More files (${suggested.fileCount} vs ${maxOther}).`;
  }
  if (!suggested.isPersonAiStyle && others.some((d) => d.isPersonAiStyle)) {
    return "Legacy / human name preferred over empty PersonAI 0N_* style.";
  }
  if (suggested.fileCount === maxOther && others.some((d) => d.fileCount === maxOther)) {
    return "Tied file count — preferred non-PersonAI or lexicographic name.";
  }
  return `Preferred match for category ${category}.`;
}

/**
 * Pure scan over a listed child folder set + optional cached mappings.
 * Does not call Drive and does not persist.
 */
export function buildTaxonomyHealthReport(opts: {
  rootFolderId: string | null;
  children: DriveFolderCandidate[];
  cachedFolderIds?: Record<number, string>;
  folderMatchMeta?: Record<number, DriveFolderMatchMeta>;
  scannedAt?: string;
}): TaxonomyHealthReport {
  const cachedFolderIds = opts.cachedFolderIds ?? {};
  const meta = opts.folderMatchMeta ?? {};
  const nameById = new Map(opts.children.map((c) => [c.id, c.name]));
  const issues: TaxonomyHealthIssue[] = [];
  const mappings: TaxonomyHealthMapping[] = [];

  for (let category = 1; category <= 10; category++) {
    const label = ARCHIVE_TAXONOMY[category as keyof typeof ARCHIVE_TAXONOMY] ?? "Misc";
    const match = matchFolderForCategory(category, opts.children);
    const cachedFolderId = cachedFolderIds[category] ?? null;
    const hasDuplicates = Boolean(match && match.duplicates.length > 0);

    if (match && match.duplicates.length > 0) {
      const suggested = toHealthFolder(category, {
        id: match.folderId,
        name: match.folderName,
        fileCount: opts.children.find((c) => c.id === match.folderId)?.fileCount,
      });
      const duplicates = match.duplicates.map((d) =>
        toHealthFolder(category, {
          id: d.id,
          name: d.name,
          fileCount: d.fileCount ?? opts.children.find((c) => c.id === d.id)?.fileCount,
        }),
      );
      issues.push({
        category,
        label,
        suggested,
        duplicates,
        reason: suggestWinnerReason(category, suggested, duplicates),
        cachedFolderId,
        cachedMatchesSuggested: cachedFolderId === suggested.id,
      });
    }

    const folderId = cachedFolderId ?? match?.folderId ?? null;
    mappings.push({
      category,
      label,
      folderId,
      folderName: folderId
        ? (nameById.get(folderId) ?? meta[category]?.matchedName ?? match?.folderName ?? null)
        : null,
      source: (meta[category]?.source as TaxonomyHealthMapping["source"]) ?? (match?.source ?? null),
      hasDuplicates,
    });
  }

  const issueCount = issues.length;
  const note =
    issueCount === 0
      ? "No duplicate taxonomy folders detected under the archive root."
      : `${issueCount} categor${issueCount === 1 ? "y has" : "ies have"} duplicate folders. Prefer one forever in PersonAI; merge or remove empties yourself in Google Drive — PersonAI never deletes Drive folders.`;

  return {
    rootFolderId: opts.rootFolderId,
    scannedAt: opts.scannedAt ?? new Date().toISOString(),
    childFolderCount: opts.children.length,
    issues,
    mappings,
    neverDeletesFolders: true,
    note,
  };
}
