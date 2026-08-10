/**
 * Near-duplicate radar for archive confirms.
 * Query already-filed local documents by Entity / DocType / ±date window.
 * Advisory only — never auto-skips filing.
 */
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import type { PrismaClient } from "@prisma/client";
import { profileArchiveDir } from "../config.js";
import { taxonomyFolderName } from "./commit.js";

export const NEAR_DUP_DEFAULT_WINDOW_DAYS = 7;
export const NEAR_DUP_MIN_SCORE = 55;

export type NearDuplicateQuery = {
  date: string;
  docType: string;
  entity: string;
  archiveCategory?: number | null;
  excludeDocumentId?: string | null;
  windowDays?: number;
};

export type NearDuplicateHit = {
  documentId: string | null;
  archiveName: string;
  archiveCategory: number | null;
  confirmedAt: string | null;
  date: string | null;
  docType: string | null;
  entity: string | null;
  score: number;
  reasons: string[];
  source: "db" | "fs";
  dayDelta: number | null;
};

export type ParsedArchiveName = {
  date: string | null;
  docType: string | null;
  entity: string | null;
  extension: string | null;
  stem: string;
};

const ARCHIVE_NAME_RE = /^(\d{4}-\d{2}-\d{2})_([^_]+)_(.+?)(\.[^.]+)?$/i;

export function normalizeEntityKey(value: unknown): string {
  return String(value ?? "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "")
    .slice(0, 64);
}

export function normalizeDocTypeKey(value: unknown): string {
  return String(value ?? "")
    .trim()
    .toUpperCase()
    .replace(/[^\w]/g, "")
    .slice(0, 48);
}

export function parseArchiveName(name: unknown): ParsedArchiveName {
  const base = path.basename(String(name ?? "").trim());
  const m = base.match(ARCHIVE_NAME_RE);
  if (!m) {
    const ext = path.extname(base) || null;
    return {
      date: null,
      docType: null,
      entity: null,
      extension: ext,
      stem: ext ? base.slice(0, -ext.length) : base,
    };
  }
  return {
    date: m[1] ?? null,
    docType: m[2] ? normalizeDocTypeKey(m[2]) : null,
    entity: (m[3] ?? "").replace(/_/g, " ").trim() || null,
    extension: m[4]?.toLowerCase() ?? null,
    stem: `${m[1]}_${m[2]}_${m[3]}`,
  };
}

export function dayDelta(a: string | null | undefined, b: string | null | undefined): number | null {
  if (!a || !b) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(a) || !/^\d{4}-\d{2}-\d{2}$/.test(b)) return null;
  const ta = Date.parse(`${a}T00:00:00Z`);
  const tb = Date.parse(`${b}T00:00:00Z`);
  if (!Number.isFinite(ta) || !Number.isFinite(tb)) return null;
  return Math.round((ta - tb) / 86_400_000);
}

function entitiesRelated(a: string, b: string): boolean {
  if (!a || !b) return false;
  if (a === b) return true;
  const shorter = a.length <= b.length ? a : b;
  const longer = a.length <= b.length ? b : a;
  if (shorter.length >= 3 && longer.includes(shorter)) return true;
  return false;
}

export function scoreNearDuplicate(
  proposed: NearDuplicateQuery,
  candidate: {
    archiveName: string;
    archiveCategory?: number | null;
    documentId?: string | null;
    confirmedAt?: Date | string | null;
    source?: "db" | "fs";
  },
): NearDuplicateHit | null {
  const windowDays = Math.max(0, proposed.windowDays ?? NEAR_DUP_DEFAULT_WINDOW_DAYS);
  const pDate = proposed.date;
  const pDoc = normalizeDocTypeKey(proposed.docType);
  const pEnt = normalizeEntityKey(proposed.entity);
  if (!pEnt && !pDoc) return null;

  const parsed = parseArchiveName(candidate.archiveName);
  const cDoc = parsed.docType ? normalizeDocTypeKey(parsed.docType) : "";
  const cEnt = normalizeEntityKey(parsed.entity);
  const delta = dayDelta(parsed.date, pDate);
  const withinWindow = delta != null && Math.abs(delta) <= windowDays;
  const sameDate = delta === 0;
  const sameDoc = Boolean(pDoc && cDoc && pDoc === cDoc);
  const sameEntity = Boolean(pEnt && cEnt && pEnt === cEnt);
  const relatedEntity = Boolean(pEnt && cEnt && entitiesRelated(pEnt, cEnt));

  const reasons: string[] = [];
  let score = 0;

  const proposedStem = `${pDate}_${pDoc}_${String(proposed.entity ?? "")
    .trim()
    .replace(/\s+/g, "_")}`.toLowerCase();
  if (parsed.stem.toLowerCase() === proposedStem) {
    score = 100;
    reasons.push("Exact archive name");
  } else if (sameEntity && sameDoc && sameDate) {
    score = 96;
    reasons.push("Same entity, DocType, and date");
  } else if (sameEntity && sameDoc && withinWindow) {
    score = Math.max(70, 90 - Math.abs(delta!) * 2);
    reasons.push(`Same entity + DocType · ${Math.abs(delta!)}d apart`);
  } else if (sameEntity && withinWindow) {
    score = Math.max(58, 72 - Math.abs(delta ?? 0) * 2);
    reasons.push(
      sameDate
        ? "Same entity and date (DocType differs)"
        : `Same entity · ${Math.abs(delta!)}d apart (DocType differs)`,
    );
  } else if (relatedEntity && sameDoc && withinWindow) {
    score = Math.max(NEAR_DUP_MIN_SCORE, 68 - Math.abs(delta ?? 0) * 2);
    reasons.push("Similar entity + same DocType in date window");
  } else if (
    proposed.archiveCategory != null &&
    candidate.archiveCategory != null &&
    Number(proposed.archiveCategory) === Number(candidate.archiveCategory) &&
    sameEntity &&
    withinWindow
  ) {
    score = 60;
    reasons.push("Same folder + entity in date window");
  }

  if (score < NEAR_DUP_MIN_SCORE || reasons.length === 0) return null;

  return {
    documentId: candidate.documentId ?? null,
    archiveName: path.basename(candidate.archiveName),
    archiveCategory:
      candidate.archiveCategory != null && !Number.isNaN(Number(candidate.archiveCategory))
        ? Number(candidate.archiveCategory)
        : null,
    confirmedAt: candidate.confirmedAt
      ? new Date(candidate.confirmedAt).toISOString()
      : null,
    date: parsed.date,
    docType: parsed.docType,
    entity: parsed.entity,
    score,
    reasons,
    source: candidate.source ?? "db",
    dayDelta: delta,
  };
}

async function listLocalArchiveFilenames(
  profileId: string,
  category?: number | null,
): Promise<Array<{ archiveName: string; archiveCategory: number | null }>> {
  const rootDir = profileArchiveDir(profileId);
  if (!fs.existsSync(rootDir)) return [];

  const categories =
    category != null && !Number.isNaN(Number(category))
      ? [Number(category)]
      : [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];

  const out: Array<{ archiveName: string; archiveCategory: number | null }> = [];
  for (const cat of categories) {
    const dir = path.join(rootDir, taxonomyFolderName(cat));
    if (!fs.existsSync(dir)) continue;
    let entries: string[] = [];
    try {
      entries = await fsp.readdir(dir);
    } catch {
      continue;
    }
    for (const name of entries) {
      if (name.startsWith(".")) continue;
      const full = path.join(dir, name);
      try {
        const st = await fsp.stat(full);
        if (!st.isFile()) continue;
      } catch {
        continue;
      }
      out.push({ archiveName: name, archiveCategory: cat });
    }
  }
  return out;
}

function dedupeHits(hits: NearDuplicateHit[]): NearDuplicateHit[] {
  const byKey = new Map<string, NearDuplicateHit>();
  for (const hit of hits) {
    const key = hit.documentId
      ? `id:${hit.documentId}`
      : `name:${hit.archiveName.toLowerCase()}:${hit.archiveCategory ?? "?"}`;
    const prev = byKey.get(key);
    if (!prev || hit.score > prev.score) byKey.set(key, hit);
  }
  return [...byKey.values()].sort(
    (a, b) => b.score - a.score || a.archiveName.localeCompare(b.archiveName),
  );
}

export async function findNearDuplicates(
  prisma: PrismaClient,
  profileId: string,
  query: NearDuplicateQuery,
): Promise<NearDuplicateHit[]> {
  const date = String(query.date ?? "").trim();
  const docType = normalizeDocTypeKey(query.docType);
  const entity = String(query.entity ?? "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || (!entity && !docType)) {
    return [];
  }

  const windowDays = Math.max(0, query.windowDays ?? NEAR_DUP_DEFAULT_WINDOW_DAYS);
  const proposed: NearDuplicateQuery = {
    date,
    docType: docType || "OTHER",
    entity: entity || "Unknown",
    archiveCategory: query.archiveCategory,
    excludeDocumentId: query.excludeDocumentId,
    windowDays,
  };

  const excludeId = query.excludeDocumentId?.trim() || null;
  const docs = await prisma.document.findMany({
    where: {
      confirmedAt: { not: null },
      ...(excludeId ? { id: { not: excludeId } } : {}),
      OR: [{ archiveName: { not: null } }, { filename: { not: null } }],
    },
    select: {
      id: true,
      archiveName: true,
      filename: true,
      archiveCategory: true,
      confirmedAt: true,
    },
    take: 400,
    orderBy: { confirmedAt: "desc" },
  });

  const hits: NearDuplicateHit[] = [];
  const knownNames = new Set<string>();

  for (const doc of docs) {
    const archiveName = doc.archiveName || doc.filename;
    if (!archiveName) continue;
    knownNames.add(path.basename(archiveName).toLowerCase());
    const hit = scoreNearDuplicate(proposed, {
      archiveName,
      archiveCategory: doc.archiveCategory,
      documentId: doc.id,
      confirmedAt: doc.confirmedAt,
      source: "db",
    });
    if (hit) hits.push(hit);
  }

  const files = await listLocalArchiveFilenames(profileId, query.archiveCategory);
  for (const file of files) {
    const key = file.archiveName.toLowerCase();
    if (knownNames.has(key)) continue;
    const hit = scoreNearDuplicate(proposed, {
      archiveName: file.archiveName,
      archiveCategory: file.archiveCategory,
      documentId: null,
      confirmedAt: null,
      source: "fs",
    });
    if (hit) hits.push(hit);
  }

  return dedupeHits(hits).slice(0, 8);
}
