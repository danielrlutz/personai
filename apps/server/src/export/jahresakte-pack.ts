import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import React from "react";
import { renderToBuffer } from "@react-pdf/renderer";
import type { PrismaClient } from "@prisma/client";
import { taxonomyFolderName } from "../archive/commit.js";
import { profileExportsDir } from "../config.js";
import { getActiveProfile } from "../profiles/registry.js";
import { ARCHIVE_TAXONOMY } from "../specialists/roster.js";
import {
  JahresakteIndexDocument,
  type JahresakteIndexData,
} from "./jahresakte-index.js";
import { buildZipBuffer, sanitizeZipPath } from "./zip.js";

/** Steuern≈Financial, Versicherung, Employment, Health — Swiss year-pack defaults. */
export const JAHRESAKTE_DEFAULT_CATEGORIES = [3, 4, 5, 6] as const;

export type JahresakteDocHit = {
  id: string;
  filename: string;
  archiveName: string | null;
  archiveCategory: number | null;
  documentType: string;
  mimeType: string;
  storagePath: string;
  uploadedAt: Date;
  confirmedAt: Date | null;
  deadline: Date | null;
  yearMatch: "archive_name" | "uploaded_at" | "deadline";
};

function yearFromArchiveName(name: string | null | undefined): number | null {
  if (!name) return null;
  const m = String(name).match(/^(\d{4})-/);
  if (!m) return null;
  const y = Number(m[1]);
  return Number.isFinite(y) && y >= 1990 && y <= 2100 ? y : null;
}

/** Prefer dated archiveName prefix; else uploadedAt / deadline year. */
export function documentMatchesYear(
  doc: {
    archiveName?: string | null;
    filename?: string | null;
    uploadedAt?: Date | string | null;
    deadline?: Date | string | null;
  },
  year: number,
): { match: boolean; via: JahresakteDocHit["yearMatch"] | null } {
  const fromName = yearFromArchiveName(doc.archiveName) ?? yearFromArchiveName(doc.filename);
  if (fromName != null) {
    return { match: fromName === year, via: fromName === year ? "archive_name" : null };
  }
  if (doc.deadline) {
    const d = doc.deadline instanceof Date ? doc.deadline : new Date(doc.deadline);
    if (!Number.isNaN(d.getTime()) && d.getFullYear() === year) {
      return { match: true, via: "deadline" };
    }
  }
  if (doc.uploadedAt) {
    const u = doc.uploadedAt instanceof Date ? doc.uploadedAt : new Date(doc.uploadedAt);
    if (!Number.isNaN(u.getTime()) && u.getFullYear() === year) {
      return { match: true, via: "uploaded_at" };
    }
  }
  return { match: false, via: null };
}

export function normalizeJahresakteCategories(raw?: number[] | null): number[] {
  const source =
    Array.isArray(raw) && raw.length > 0 ? raw : [...JAHRESAKTE_DEFAULT_CATEGORIES];
  const cats = [
    ...new Set(
      source
        .map((n) => Number(n))
        .filter((n) => Number.isInteger(n) && n >= 1 && n <= 10),
    ),
  ].sort((a, b) => a - b);
  return cats.length ? cats : [...JAHRESAKTE_DEFAULT_CATEGORIES];
}

export async function listJahresakteHits(
  prisma: PrismaClient,
  opts: { year: number; categories?: number[] },
): Promise<JahresakteDocHit[]> {
  const year = Number(opts.year);
  if (!Number.isInteger(year) || year < 1990 || year > 2100) {
    throw new Error("year must be an integer between 1990 and 2100");
  }
  const categories = normalizeJahresakteCategories(opts.categories);

  const docs = await prisma.document.findMany({
    where: {
      confirmedAt: { not: null },
      archiveCategory: { in: categories },
    },
    orderBy: [{ archiveName: "asc" }, { uploadedAt: "asc" }],
    take: 500,
  });

  const hits: JahresakteDocHit[] = [];
  for (const doc of docs) {
    const { match, via } = documentMatchesYear(doc, year);
    if (!match || !via) continue;
    hits.push({
      id: doc.id,
      filename: doc.filename,
      archiveName: doc.archiveName,
      archiveCategory: doc.archiveCategory,
      documentType: doc.documentType,
      mimeType: doc.mimeType,
      storagePath: doc.storagePath,
      uploadedAt: doc.uploadedAt,
      confirmedAt: doc.confirmedAt,
      deadline: doc.deadline,
      yearMatch: via,
    });
  }
  return hits;
}

function dateLabelForHit(hit: JahresakteDocHit): string {
  if (hit.archiveName) {
    const m = hit.archiveName.match(/^(\d{4}-\d{2}-\d{2})/);
    if (m) return m[1]!;
  }
  if (hit.deadline) return hit.deadline.toISOString().slice(0, 10);
  return hit.uploadedAt.toISOString().slice(0, 10);
}

function uniqueZipName(used: Set<string>, folder: string, baseName: string): string {
  let candidate = sanitizeZipPath(`${folder}/${baseName}`);
  if (!used.has(candidate)) {
    used.add(candidate);
    return candidate;
  }
  const ext = path.extname(baseName);
  const stem = ext ? baseName.slice(0, -ext.length) : baseName;
  let i = 2;
  while (used.has(candidate)) {
    candidate = sanitizeZipPath(`${folder}/${stem}_${i}${ext}`);
    i += 1;
  }
  used.add(candidate);
  return candidate;
}

export type JahresaktePackResult = {
  year: number;
  documentCount: number;
  zipPath: string;
  indexPdfPath: string;
  zipName: string;
  categories: number[];
};

/** Write INDEX.pdf + ZIP under profile exports. Does not touch Drive. */
export async function buildJahresaktePack(
  prisma: PrismaClient,
  opts: {
    profileId: string;
    year: number;
    documentIds: string[];
    categories?: number[];
  },
): Promise<JahresaktePackResult> {
  const year = Number(opts.year);
  const categories = normalizeJahresakteCategories(opts.categories);
  const ids = [...new Set(opts.documentIds.map(String))].filter(Boolean);
  if (ids.length === 0) throw new Error("Select at least one document");

  const docs = await prisma.document.findMany({
    where: {
      id: { in: ids },
      confirmedAt: { not: null },
    },
  });
  if (docs.length === 0) throw new Error("No confirmed documents found for pack");

  const byId = new Map(docs.map((d) => [d.id, d]));
  const ordered: JahresakteDocHit[] = [];
  for (const id of ids) {
    const doc = byId.get(id);
    if (!doc) continue;
    const { match, via } = documentMatchesYear(doc, year);
    if (!match || !via) continue;
    if (
      doc.archiveCategory != null &&
      categories.length &&
      !categories.includes(doc.archiveCategory)
    ) {
      continue;
    }
    ordered.push({
      id: doc.id,
      filename: doc.filename,
      archiveName: doc.archiveName,
      archiveCategory: doc.archiveCategory,
      documentType: doc.documentType,
      mimeType: doc.mimeType,
      storagePath: doc.storagePath,
      uploadedAt: doc.uploadedAt,
      confirmedAt: doc.confirmedAt,
      deadline: doc.deadline,
      yearMatch: via,
    });
  }
  if (ordered.length === 0) {
    throw new Error("No selected documents match this year / category filter");
  }

  const profile = getActiveProfile();
  const categoryLabels = [
    ...new Set(
      ordered.map((d) => {
        const cat = d.archiveCategory ?? 9;
        return `${String(cat).padStart(2, "0")}_${ARCHIVE_TAXONOMY[cat] ?? "Misc"}`;
      }),
    ),
  ].sort();

  const indexData: JahresakteIndexData = {
    profileName: profile?.name ?? "Profile",
    year,
    generatedAt: new Date().toISOString().slice(0, 10),
    categories: categoryLabels,
    items: ordered.map((d) => ({
      archiveName: d.archiveName || d.filename,
      categoryLabel: taxonomyFolderName(d.archiveCategory ?? 9),
      documentType: d.documentType,
      dateLabel: dateLabelForHit(d),
    })),
  };

  const pdfEl = React.createElement(JahresakteIndexDocument, { data: indexData });
  const pdfBuffer = await renderToBuffer(pdfEl as Parameters<typeof renderToBuffer>[0]);

  const usedNames = new Set<string>();
  const zipEntries: Array<{ name: string; data: Buffer }> = [
    { name: "INDEX.pdf", data: Buffer.from(pdfBuffer) },
  ];
  usedNames.add("INDEX.pdf");

  const missing: string[] = [];
  for (const hit of ordered) {
    const resolved = path.resolve(hit.storagePath);
    try {
      await fsp.access(resolved);
    } catch {
      missing.push(hit.archiveName || hit.filename);
      continue;
    }
    const bytes = await fsp.readFile(resolved);
    const folder = taxonomyFolderName(hit.archiveCategory ?? 9);
    const base = hit.archiveName || hit.filename || path.basename(resolved);
    const entryName = uniqueZipName(usedNames, folder, base);
    zipEntries.push({ name: entryName, data: bytes });
  }
  if (zipEntries.length <= 1) {
    throw new Error(
      missing.length
        ? `No readable files on disk (${missing.slice(0, 3).join(", ")}${missing.length > 3 ? "…" : ""})`
        : "No readable files on disk for this pack",
    );
  }

  const zipBuffer = buildZipBuffer(zipEntries);
  const exportsDir = profileExportsDir(opts.profileId);
  fs.mkdirSync(exportsDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const zipName = `Jahresakte-${year}-${stamp}.zip`;
  const indexName = `Jahresakte-${year}-${stamp}-INDEX.pdf`;
  const zipPath = path.join(exportsDir, zipName);
  const indexPdfPath = path.join(exportsDir, indexName);
  await fsp.writeFile(zipPath, zipBuffer);
  await fsp.writeFile(indexPdfPath, pdfBuffer);

  await prisma.auditLog.create({
    data: {
      action: "export.generate",
      entity: "Jahresakte",
      entityId: `jahresakte:${year}`,
      metadata: JSON.stringify({
        year,
        documentCount: ordered.length,
        packedFiles: zipEntries.length - 1,
        missing,
        zipPath,
        indexPdfPath,
        categories,
      }),
    },
  });

  return {
    year,
    documentCount: ordered.length,
    zipPath,
    indexPdfPath,
    zipName,
    categories,
  };
}
