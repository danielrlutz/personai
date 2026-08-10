/**
 * Map internal Prisma DocumentType enums ↔ human Drive/archive tokens.
 * Never leak shouty enums (BILL, MEDICAL_RECORD) into archiveName or UI defaults.
 *
 * Drive convention observed: `{date}_Invoice_{entity}.pdf` (not BILL).
 */

export const PRISMA_DOC_TYPES = [
  "BILL",
  "MEDICAL_RECORD",
  "LEGAL",
  "CONTRACT",
  "RECEIPT",
  "OFFICIAL",
  "OTHER",
] as const;

export type PrismaDocType = (typeof PRISMA_DOC_TYPES)[number];

/** Preferred archive / confirm tokens aligned with Drive vocabulary. */
export const ARCHIVE_TYPE_TOKENS: Record<PrismaDocType, string> = {
  BILL: "Invoice",
  RECEIPT: "Quittance",
  MEDICAL_RECORD: "Medical",
  LEGAL: "Legal",
  CONTRACT: "Contract",
  OFFICIAL: "Official",
  OTHER: "Other",
};

/** Synonyms (normalized upper snake / plain) → Prisma enum. */
const TYPE_SYNONYMS: Record<string, PrismaDocType> = {
  BILL: "BILL",
  INVOICE: "BILL",
  RECHNUNG: "BILL",
  QR_RECHNUNG: "BILL",
  QRRECHNUNG: "BILL",
  FAKTURA: "BILL",
  RECEIPT: "RECEIPT",
  QUITTANCE: "RECEIPT",
  QUITTUNG: "RECEIPT",
  RECEIPT_SLIP: "RECEIPT",
  MEDICAL_RECORD: "MEDICAL_RECORD",
  MEDICAL: "MEDICAL_RECORD",
  HEALTH: "MEDICAL_RECORD",
  ARZTZEUGNIS: "MEDICAL_RECORD",
  BEFUND: "MEDICAL_RECORD",
  LEGAL: "LEGAL",
  COURT: "LEGAL",
  GERICHT: "LEGAL",
  CONTRACT: "CONTRACT",
  VERTRAG: "CONTRACT",
  OFFICIAL: "OFFICIAL",
  BEHOERDE: "OFFICIAL",
  BEHORDE: "OFFICIAL",
  OTHER: "OTHER",
  MISC: "OTHER",
  UNKNOWN: "OTHER",
};

function foldKey(value: unknown): string {
  return String(value ?? "")
    .trim()
    .replace(/ä/gi, "ae")
    .replace(/ö/gi, "oe")
    .replace(/ü/gi, "ue")
    .replace(/ß/g, "ss")
    .replace(/[-\s]+/g, "_")
    .replace(/[^\w]/g, "")
    .toUpperCase();
}

/** Normalize OCR / UI / legacy archive tokens to Prisma DocumentType. */
export function normalizeDocumentType(value: unknown): PrismaDocType {
  const key = foldKey(value);
  if (!key) return "OTHER";
  if ((PRISMA_DOC_TYPES as readonly string[]).includes(key)) {
    return key as PrismaDocType;
  }
  if (TYPE_SYNONYMS[key]) return TYPE_SYNONYMS[key]!;
  // Title-case Drive tokens
  const lower = String(value ?? "").trim().toLowerCase();
  if (lower === "invoice" || lower === "rechnung") return "BILL";
  if (lower === "quittance" || lower === "quittung" || lower === "receipt") return "RECEIPT";
  return "OTHER";
}

/** Token used in archiveName and confirm DocType field (never BILL). */
export function archiveTypeToken(documentType: unknown): string {
  const dt = normalizeDocumentType(documentType);
  return ARCHIVE_TYPE_TOKENS[dt];
}

/** True when a string looks like a leaked shouty Prisma enum. */
export function isShoutyDocTypeEnum(value: unknown): boolean {
  const s = String(value ?? "").trim();
  return (PRISMA_DOC_TYPES as readonly string[]).includes(s);
}

/**
 * Normalize a user/OCR/legacy archive token for naming.
 * BILL → Invoice; already-human tokens (Invoice, Rechnung) kept as Drive form.
 */
export function coerceArchiveTypeToken(value: unknown): string {
  const raw = String(value ?? "").trim();
  if (!raw) return ARCHIVE_TYPE_TOKENS.OTHER;
  // Prefer canonical Drive tokens for known enums / synonyms
  const dt = normalizeDocumentType(raw);
  if (isShoutyDocTypeEnum(raw) || foldKey(raw) in TYPE_SYNONYMS) {
    return ARCHIVE_TYPE_TOKENS[dt];
  }
  // Allow custom human tokens (e.g. Rechnung) — title-case, strip junk
  const cleaned = raw.replace(/[^\wÄÖÜäöüéèêà-]+/g, "");
  if (!cleaned) return ARCHIVE_TYPE_TOKENS[dt];
  if (cleaned === cleaned.toUpperCase() && cleaned.length > 1) {
    // Shouty unknown → Title case
    return cleaned.charAt(0) + cleaned.slice(1).toLowerCase();
  }
  return cleaned;
}
