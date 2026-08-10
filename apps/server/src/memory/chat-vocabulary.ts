/**
 * Chat-facing vocabulary — ban shouty internal enums (BILL) in user-visible copy.
 * Prefer Drive corpus tokens (Invoice, Rechnung, …) when the archive index shows them.
 */

const INTERNAL_TO_DEFAULT: Record<string, string> = {
  BILL: "Invoice",
  RECEIPT: "Receipt",
  MEDICAL_RECORD: "Medical record",
  LEGAL: "Legal",
  CONTRACT: "Contract",
  OFFICIAL: "Official",
  OTHER: "Document",
};

/** Tokens commonly seen in Swiss Drive filenames that should win over BILL. */
const CORPUS_DOCTYPE_CANDIDATES = [
  "Invoice",
  "Rechnung",
  "QR-Rechnung",
  "Quittung",
  "Beleg",
  "Receipt",
  "Police",
  "Vertrag",
  "Arztbericht",
] as const;

export type DriveVocab = {
  /** Preferred label for invoice-like docs (e.g. Invoice / Rechnung). */
  invoiceLabel: string;
  /** All distinct doc-type-ish tokens harvested from archive names. */
  docTypeTokens: string[];
};

/** Parse archive index / filename lines for user vocabulary. */
export function extractDriveVocab(archiveText: string | null | undefined): DriveVocab {
  const text = archiveText ?? "";
  const found = new Set<string>();
  // Pattern: 2026-08-01_Invoice_Swisscom.pdf or …_Rechnung_…
  const re = /\b\d{4}-\d{2}-\d{2}_([A-Za-zÄÖÜäöüÉéÈèÊêÀà-]{2,32})_/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const token = m[1]!;
    if (/^[A-Z][A-Z0-9_]{1,31}$/.test(token) && INTERNAL_TO_DEFAULT[token]) {
      // skip raw enums in corpus when present
      continue;
    }
    found.add(token);
  }
  for (const candidate of CORPUS_DOCTYPE_CANDIDATES) {
    const pattern = candidate.replace(/-/g, "[-_]?");
    const reCand = new RegExp(`\\b${pattern}\\b`, "i");
    const hit = text.match(reCand);
    if (hit?.[0]) found.add(hit[0].replace(/_/g, "-"));
  }

  const tokens = [...found].sort((a, b) => a.localeCompare(b));
  let invoiceLabel = "Invoice";
  for (const prefer of ["Invoice", "Rechnung", "QR-Rechnung", "Quittung"]) {
    const hit = tokens.find((t) => t.toLowerCase() === prefer.toLowerCase());
    if (hit) {
      invoiceLabel = hit;
      break;
    }
  }
  return { invoiceLabel, docTypeTokens: tokens };
}

/** Map internal enum / raw token → chat-facing label. */
export function chatFacingDocType(
  raw: string | null | undefined,
  vocab?: DriveVocab | null,
): string {
  const key = String(raw ?? "")
    .trim()
    .replace(/[^\wÄÖÜäöü-]/g, "");
  if (!key) return vocab?.invoiceLabel ?? "Document";
  const upper = key.toUpperCase().replace(/-/g, "_");
  if (upper === "BILL") return vocab?.invoiceLabel ?? "Invoice";
  if (INTERNAL_TO_DEFAULT[upper]) return INTERNAL_TO_DEFAULT[upper]!;
  // Already human (Invoice, Rechnung, …)
  if (/[a-z]/.test(key) || /[äöüéèêà]/i.test(key)) return key;
  // ALLCAPS unknown — title-case lightly
  return key.charAt(0) + key.slice(1).toLowerCase();
}

/** Strip / rewrite shouty enums in free-form chat or UI copy. */
export function banRawEnumsInChatCopy(
  text: string,
  vocab?: DriveVocab | null,
): string {
  const invoice = vocab?.invoiceLabel ?? "Invoice";
  return text
    .replace(/\bBILL\b/g, invoice)
    .replace(/\bMEDICAL_RECORD\b/g, "Medical record")
    .replace(/\bRECEIPT\b/g, "Receipt")
    .replace(/\bOFFICIAL\b/g, "Official")
    .replace(/\bCONTRACT\b/g, "Contract");
}

/** Compact prompt hint for specialists. */
export function formatVocabForPrompt(vocab: DriveVocab): string {
  const tokens =
    vocab.docTypeTokens.length > 0
      ? vocab.docTypeTokens.slice(0, 12).join(", ")
      : "(none harvested yet — default to Invoice, never BILL)";
  return `User archive vocabulary (chat-facing — NEVER say BILL or other raw enums):
- Invoice-like docs: say "${vocab.invoiceLabel}"
- Seen doc-type tokens: ${tokens}
Internal storage may still use enums; user-facing replies and confirm summaries must use the vocabulary above.`;
}
