/**
 * Local archive documents specialists may cite in Team chat.
 * Citations use [@doc:ID|label] so the web UI can open View file preview.
 */
import type { PrismaClient } from "@prisma/client";

export type CitableDoc = {
  id: string;
  name: string;
  category: number | null;
  documentType: string;
};

export type ParsedDocCitation = {
  id: string;
  label: string;
};

const CITE_RE = /\[@doc:([^|\]]+)\|([^\]]+)\]/g;

export async function listCitableDocuments(
  prisma: PrismaClient,
  limit = 30,
): Promise<CitableDoc[]> {
  const take = Math.max(1, Math.min(limit, 60));
  const confirmed = await prisma.document.findMany({
    where: { confirmedAt: { not: null } },
    orderBy: { confirmedAt: "desc" },
    take,
    select: {
      id: true,
      archiveName: true,
      filename: true,
      archiveCategory: true,
      documentType: true,
    },
  });

  const mapped = confirmed.map(toCitable);
  if (mapped.length >= Math.min(12, take)) return mapped;

  const seen = new Set(mapped.map((d) => d.id));
  const staged = await prisma.document.findMany({
    where: { confirmedAt: null },
    orderBy: { uploadedAt: "desc" },
    take: take - mapped.length,
    select: {
      id: true,
      archiveName: true,
      filename: true,
      archiveCategory: true,
      documentType: true,
    },
  });
  for (const row of staged) {
    if (seen.has(row.id)) continue;
    mapped.push(toCitable(row));
    seen.add(row.id);
  }
  return mapped;
}

function toCitable(row: {
  id: string;
  archiveName: string | null;
  filename: string;
  archiveCategory: number | null;
  documentType: string;
}): CitableDoc {
  return {
    id: row.id,
    name: (row.archiveName || row.filename).trim() || row.id,
    category: row.archiveCategory,
    documentType: row.documentType,
  };
}

/** Compact block injected into Team system context. */
export function formatCitableDocsBlock(docs: CitableDoc[]): string {
  if (docs.length === 0) {
    return [
      "Citable local archive documents: (none yet).",
      "Do not invent document ids or filenames. If the user asks about filed papers, say the local archive list is empty.",
    ].join("\n");
  }
  const lines = docs.map((d) => {
    const cat = d.category != null ? ` cat=${d.category}` : "";
    return `- id=${d.id} name=${d.name}${cat} type=${d.documentType}`;
  });
  return [
    "Citable local archive documents (ids are real — use them when citing):",
    "Citation marker (required when you reference one of these): [@doc:ID|short-label]",
    "Example: [@doc:clxxxxxxxx|2026-03-01_BILL_Swisscom.pdf]",
    ...lines,
  ].join("\n");
}

export function citationModeInstructions(citeFromArchive: boolean): string {
  if (citeFromArchive) {
    return [
      "CITE-FROM-ARCHIVE MODE (STRICT):",
      "- Ground claims about the user's papers ONLY in the citable local archive list above (and archive.index summary).",
      "- Every document reference MUST include [@doc:ID|short-label] with a real id from that list.",
      "- Never invent filenames, Fristen, amounts, or document ids.",
      "- If nothing listed matches the ask, say you lack a matching filed document and ask what to upload or refresh.",
    ].join("\n");
  }
  return [
    "When you reference a filed local archive document from the citable list, include [@doc:ID|short-label] with the real id.",
    "Do not invent document ids. Soft archive.index summary alone is not enough to claim a specific file exists.",
  ].join("\n");
}

export function parseDocCitations(text: string): ParsedDocCitation[] {
  const out: ParsedDocCitation[] = [];
  const seen = new Set<string>();
  CITE_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = CITE_RE.exec(text)) !== null) {
    const id = m[1]?.trim();
    const label = m[2]?.trim();
    if (!id || !label || seen.has(id)) continue;
    seen.add(id);
    out.push({ id, label });
  }
  return out;
}

/** Match exact archive filenames mentioned in prose (fallback when model omits markers). */
export function matchMentionedCitables(
  text: string,
  docs: CitableDoc[],
): ParsedDocCitation[] {
  if (!text.trim() || docs.length === 0) return [];
  const hay = text.toLowerCase();
  const sorted = [...docs].sort((a, b) => b.name.length - a.name.length);
  const out: ParsedDocCitation[] = [];
  const seen = new Set<string>();
  for (const d of sorted) {
    const name = d.name.trim();
    if (name.length < 8) continue;
    if (!hay.includes(name.toLowerCase())) continue;
    if (seen.has(d.id)) continue;
    seen.add(d.id);
    out.push({ id: d.id, label: name });
  }
  return out;
}

export function collectReplyCitations(
  text: string,
  docs: CitableDoc[],
): ParsedDocCitation[] {
  const explicit = parseDocCitations(text);
  const seen = new Set(explicit.map((c) => c.id));
  const mentioned = matchMentionedCitables(text, docs).filter((c) => !seen.has(c.id));
  return [...explicit, ...mentioned];
}
