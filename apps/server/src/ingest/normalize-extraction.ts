import { normalizeDocumentType } from "../archive/doc-type-tokens.js";
import { safeDate } from "../lib/safe-data.js";

/** Words that must never become the archive entity. */
const ENTITY_BANLIST = new Set([
  "unknown",
  "other",
  "bill",
  "invoice",
  "rechnung",
  "quittance",
  "quittung",
  "receipt",
  "document",
  "dokument",
  "misc",
  "n/a",
  "na",
  "null",
  "none",
  "test",
]);

/** Coerce CH/EU date strings (DD.MM.YYYY) to ISO before safeDate. */
export function coerceOcrDateString(value: unknown): string | null {
  if (value == null) return null;
  if (value instanceof Date) {
    return Number.isFinite(value.getTime()) ? value.toISOString().slice(0, 10) : null;
  }
  let s = String(value).trim();
  if (!s) return null;

  const eu = s.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{4})$/);
  if (eu) {
    const dd = eu[1]!.padStart(2, "0");
    const mm = eu[2]!.padStart(2, "0");
    const yyyy = eu[3]!;
    s = `${yyyy}-${mm}-${dd}`;
  }

  const d = safeDate(s);
  return d ? d.toISOString().slice(0, 10) : null;
}

export function pickArchiveEntity(structured: Record<string, unknown>): string {
  const candidates = [
    structured.creditorName,
    structured.vendor,
    structured.provider,
  ];
  for (const c of candidates) {
    const s = String(c ?? "").trim();
    if (!s) continue;
    const key = s.toLowerCase().replace(/[_\s]+/g, " ");
    if (ENTITY_BANLIST.has(key)) continue;
    if (/^(bill|invoice|rechnung|other)$/i.test(s)) continue;
    return s;
  }
  return "Unknown";
}

/**
 * Post-process vision JSON: map Invoice/Rechnung synonyms, coerce dates via safeDate,
 * drop banlisted entities. Mutates a shallow copy.
 */
export function normalizeStructuredExtraction(
  structured: Record<string, unknown>,
): Record<string, unknown> {
  const next = { ...structured };

  next.documentType = normalizeDocumentType(next.documentType);

  const date = coerceOcrDateString(next.date);
  next.date = date;
  const due = coerceOcrDateString(next.dueDate);
  next.dueDate = due;

  const entity = pickArchiveEntity(next);
  // Mirror cleaned entity into the best-available field for downstream naming.
  if (entity !== "Unknown") {
    if (!next.creditorName || ENTITY_BANLIST.has(String(next.creditorName).toLowerCase())) {
      next.creditorName = entity;
    }
    if (!next.vendor || ENTITY_BANLIST.has(String(next.vendor).toLowerCase())) {
      next.vendor = entity;
    }
  } else {
    // Avoid leaking "Invoice" / "Rechnung" into vendor when OCR confused type with entity.
    for (const key of ["creditorName", "vendor", "provider"] as const) {
      const v = String(next[key] ?? "").trim();
      if (v && ENTITY_BANLIST.has(v.toLowerCase())) next[key] = null;
    }
  }

  return next;
}
