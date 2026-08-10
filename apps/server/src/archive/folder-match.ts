/**
 * Match Drive folder names to archive taxonomy categories regardless of
 * numbering style (01_, 1., 01 -) or EN/DE/FR label variants.
 */
import { ARCHIVE_TAXONOMY } from "../specialists/roster.js";

export type DriveFolderCandidate = {
  id: string;
  name: string;
  /** Optional file count for duplicate preference (higher wins). */
  fileCount?: number;
};

export type FolderMatchResult = {
  folderId: string;
  folderName: string;
  category: number;
  source: "exact" | "regex" | "synonym" | "reconcile";
  /** Other candidates that also matched (duplicates); not deleted. */
  duplicates: Array<{ id: string; name: string; fileCount?: number }>;
};

/** Canonical English labels + common DE/FR synonyms (normalized keys). */
const CATEGORY_SYNONYMS: Record<number, readonly string[]> = {
  1: [
    "official",
    "official documents",
    "official document",
    "behoerden",
    "behoerde",
    "amtlich",
    "amtliche dokumente",
    "documents officiels",
    "document officiel",
    "verwaltung",
  ],
  2: ["housing", "wohnen", "wohnung", "logement", "habitation", "mietvertrag", "miete"],
  3: [
    "insurance",
    "versicherung",
    "versicherungen",
    "assurance",
    "assurances",
    "krankenversicherung",
  ],
  4: [
    "financial",
    "finance",
    "finanzen",
    "finances",
    "banking",
    "bank",
    "steuern",
    "tax",
    "taxes",
  ],
  5: [
    "employment",
    "arbeit",
    "job",
    "jobs",
    "emploi",
    "arbeitgeber",
    "lohn",
    "payroll",
    "hr",
  ],
  6: ["health", "gesundheit", "sante", "medical", "medizin", "arzt", "healthcare"],
  7: ["education", "bildung", "schule", "formation", "universitat", "university"],
  8: ["legal", "recht", "juridique", "gericht", "lawsuit", "contracts", "vertraege", "vertrag"],
  9: ["misc", "miscellaneous", "sonstiges", "divers", "other", "andere", "various"],
  10: ["vehicles", "vehicle", "fahrzeuge", "fahrzeug", "auto", "autos", "voitures", "car", "cars"],
};

/** Archive root folder aliases (normalized). */
export const ARCHIVE_ROOT_ALIASES = [
  "personai archive",
  "personai_archive",
  "archived files",
  "archived file",
  "archive",
  "archiv",
  "archives",
] as const;

export function asciiFold(input: string): string {
  // Expand German umlauts before NFKD so Behörden → behoerden (not behorden).
  return input
    .replace(/ä/g, "ae")
    .replace(/Ä/g, "Ae")
    .replace(/ö/g, "oe")
    .replace(/Ö/g, "Oe")
    .replace(/ü/g, "ue")
    .replace(/Ü/g, "Ue")
    .replace(/ß/g, "ss")
    .replace(/æ/g, "ae")
    .replace(/œ/g, "oe")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "");
}

/**
 * Strip leading taxonomy numbering / punctuation and normalize for comparison.
 * Examples: "01_Official" → "official", "1. Official Documents" → "official documents"
 */
export function normalizeFolderKey(name: string): string {
  let s = asciiFold(String(name ?? "")).toLowerCase().trim();
  // Leading numbers + separators: 01_, 1., 01 -, 01–, (1), 1)
  s = s.replace(/^[\(\[]?\d{1,2}[\)\]]?[\s._\-–—:)\\/]*/u, "");
  s = s.replace(/[^\p{L}\p{N}\s]/gu, " ");
  s = s.replace(/\s+/g, " ").trim();
  return s;
}

export function taxonomyCanonicalKey(category: number): string {
  const label = ARCHIVE_TAXONOMY[category as keyof typeof ARCHIVE_TAXONOMY] ?? "Misc";
  return normalizeFolderKey(label);
}

export function synonymKeysForCategory(category: number): Set<string> {
  const keys = new Set<string>();
  keys.add(taxonomyCanonicalKey(category));
  for (const syn of CATEGORY_SYNONYMS[category] ?? []) {
    keys.add(normalizeFolderKey(syn));
  }
  return keys;
}

/** PersonAI-style name we used to create when no match existed. */
export function personAiStyleFolderName(category: number): string {
  const label = ARCHIVE_TAXONOMY[category as keyof typeof ARCHIVE_TAXONOMY] ?? "Misc";
  return `${String(category).padStart(2, "0")}_${label}`;
}

export function isPersonAiStyleName(name: string, category?: number): boolean {
  const m = String(name).match(/^0?(\d{1,2})[_-]/);
  if (!m) return false;
  if (category != null && Number(m[1]) !== category) return false;
  return true;
}

export function isArchiveRootName(name: string): boolean {
  const key = normalizeFolderKey(name);
  if (!key) return false;
  if (ARCHIVE_ROOT_ALIASES.includes(key as (typeof ARCHIVE_ROOT_ALIASES)[number])) return true;
  // Soft match: starts with personai + archive
  if (key.includes("personai") && key.includes("archive")) return true;
  if (key === "archived files" || key.startsWith("archived file")) return true;
  return false;
}

function scoreCandidate(
  folder: DriveFolderCandidate,
  category: number,
): { score: number; source: FolderMatchResult["source"] } | null {
  const key = normalizeFolderKey(folder.name);
  if (!key) return null;
  const synonyms = synonymKeysForCategory(category);
  const canonical = taxonomyCanonicalKey(category);

  if (key === canonical) return { score: 100, source: "exact" };
  if (synonyms.has(key)) return { score: 90, source: "synonym" };

  // Containment: "official documents" ↔ "official" (unique-ish)
  for (const syn of synonyms) {
    if (syn.length >= 4 && (key === syn || key.includes(syn) || syn.includes(key))) {
      // Prefer closer length
      const lenPenalty = Math.abs(key.length - syn.length);
      return { score: 70 - Math.min(lenPenalty, 20), source: "regex" };
    }
  }
  return null;
}

/**
 * Prefer legacy / fuller folders over empty PersonAI `0N_*` duplicates.
 * Never deletes — caller only records the winner as the mapping.
 */
export function preferFolderAmongDuplicates(
  category: number,
  candidates: DriveFolderCandidate[],
): DriveFolderCandidate {
  if (candidates.length === 1) return candidates[0]!;
  const ranked = [...candidates].sort((a, b) => {
    const countA = a.fileCount ?? 0;
    const countB = b.fileCount ?? 0;
    if (countB !== countA) return countB - countA;
    const aPersonAi = isPersonAiStyleName(a.name, category) ? 1 : 0;
    const bPersonAi = isPersonAiStyleName(b.name, category) ? 1 : 0;
    if (aPersonAi !== bPersonAi) return aPersonAi - bPersonAi; // prefer non-PersonAI
    return a.name.localeCompare(b.name);
  });
  return ranked[0]!;
}

/**
 * Regex / synonym matcher. Returns null when no match or when matches are
 * ambiguous across *different* categories (caller should LLM). Same-category
 * duplicates are reconciled via preferFolderAmongDuplicates.
 */
export function matchFolderForCategory(
  category: number,
  folders: DriveFolderCandidate[],
): FolderMatchResult | null {
  const hits: Array<{
    folder: DriveFolderCandidate;
    score: number;
    source: FolderMatchResult["source"];
  }> = [];

  for (const folder of folders) {
    const scored = scoreCandidate(folder, category);
    if (scored) hits.push({ folder, score: scored.score, source: scored.source });
  }

  if (hits.length === 0) return null;

  // Keep all solid hits (exact / synonym / strong containment) so
  // 01_Official + "1. Official Documents" reconcile instead of exact-only winning.
  hits.sort((a, b) => b.score - a.score);
  const top = hits.filter((h) => h.score >= 60).map((h) => h.folder);
  const winner = preferFolderAmongDuplicates(category, top);
  const winnerHit = hits.find((h) => h.folder.id === winner.id)!;
  const duplicates = top
    .filter((f) => f.id !== winner.id)
    .map((f) => ({ id: f.id, name: f.name, fileCount: f.fileCount }));

  return {
    folderId: winner.id,
    folderName: winner.name,
    category,
    source: duplicates.length > 0 ? "reconcile" : winnerHit.source,
    duplicates,
  };
}

/**
 * Detect whether a folder list is ambiguous for a category (partial overlaps
 * that regex cannot decide) — used to trigger LLM fallback.
 */
export function isAmbiguousForCategory(
  category: number,
  folders: DriveFolderCandidate[],
): boolean {
  const match = matchFolderForCategory(category, folders);
  if (match) return false;
  const canonical = taxonomyCanonicalKey(category);
  // Soft partials with no clear winner
  const soft = folders.filter((f) => {
    const key = normalizeFolderKey(f.name);
    return key.includes(canonical.slice(0, 4)) || canonical.includes(key.slice(0, 4));
  });
  return soft.length >= 2;
}

export function buildFolderMatchLlmPrompt(opts: {
  category: number;
  label: string;
  folders: Array<{ id: string; name: string }>;
}): string {
  return [
    "You map a document archive category to an existing Google Drive folder.",
    "Reply with JSON only, no markdown: {\"folderId\": \"<id or null>\", \"reason\": \"short\"}",
    "Pick the folder that best matches the category. Prefer legacy human names over PersonAI 01_Label duplicates.",
    "If none match, folderId must be null (do not invent ids).",
    `Category id: ${opts.category}`,
    `Category label: ${opts.label}`,
    `Folders: ${JSON.stringify(opts.folders)}`,
  ].join("\n");
}

export function parseFolderMatchLlmResponse(
  raw: string,
  allowedIds: Set<string>,
): string | null {
  const text = String(raw ?? "").trim();
  const jsonSlice = text.match(/\{[\s\S]*\}/)?.[0];
  if (!jsonSlice) return null;
  try {
    const parsed = JSON.parse(jsonSlice) as { folderId?: unknown };
    if (parsed.folderId == null || parsed.folderId === "null") return null;
    const id = String(parsed.folderId);
    return allowedIds.has(id) ? id : null;
  } catch {
    return null;
  }
}
