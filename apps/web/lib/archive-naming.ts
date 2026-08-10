/** Client-side archive naming helpers — keep extension aligned with stored bytes. */

export type ArchiveDraft = {
  date: string;
  docType: string;
  entity: string;
  archiveCategory: number;
  /** Includes leading dot, e.g. `.pdf` / `.png`. */
  extension: string;
};

/** Prisma enum → Drive/archive token (never show BILL). */
const ENUM_TO_TOKEN: Record<string, string> = {
  BILL: "Invoice",
  INVOICE: "Invoice",
  RECHNUNG: "Invoice",
  RECEIPT: "Quittance",
  QUITTANCE: "Quittance",
  QUITTUNG: "Quittance",
  MEDICAL_RECORD: "Medical",
  MEDICAL: "Medical",
  LEGAL: "Legal",
  CONTRACT: "Contract",
  OFFICIAL: "Official",
  OTHER: "Other",
  MISC: "Other",
};

/** Normalize DocType field for archive names / confirm defaults. */
export function coerceArchiveDocType(value: unknown): string {
  const raw = String(value ?? "").trim();
  if (!raw) return "Other";
  const key = raw.toUpperCase().replace(/[-\s]+/g, "_").replace(/[^\w]/g, "");
  if (ENUM_TO_TOKEN[key]) return ENUM_TO_TOKEN[key]!;
  // Already human (Invoice, Rechnung) — keep; soften ALLCAPS unknowns
  if (raw === raw.toUpperCase() && raw.length > 1 && !/[a-z]/.test(raw)) {
    return raw.charAt(0) + raw.slice(1).toLowerCase();
  }
  return raw.replace(/[^\wÄÖÜäöüéèêà-]+/g, "") || "Other";
}

export function sanitizeArchiveExtension(value: unknown, fallback = ".pdf"): string {
  let ext = String(value ?? fallback).trim() || fallback;
  if (!ext.startsWith(".")) ext = `.${ext}`;
  ext = ext.replace(/[^\w.]/g, "");
  if (ext === "." || !ext) return fallback;
  return ext.slice(0, 16).toLowerCase();
}

export function extensionFromFilename(name: unknown, fallback = ".pdf"): string {
  const s = String(name ?? "");
  const m = s.match(/(\.[A-Za-z0-9]{1,16})$/);
  return sanitizeArchiveExtension(m?.[1] ?? fallback, fallback);
}

export function buildArchiveName(d: ArchiveDraft): string {
  const entity =
    d.entity
      .trim()
      .replace(/[^\wÄÖÜäöüéèêà.\s-]+/g, "")
      .replace(/\s+/g, "_")
      .slice(0, 48) || "Unknown";
  const docType = coerceArchiveDocType(d.docType);
  const date = /^\d{4}-\d{2}-\d{2}$/.test(d.date)
    ? d.date
    : new Date().toISOString().slice(0, 10);
  const ext = sanitizeArchiveExtension(d.extension);
  return `${date}_${docType}_${entity}${ext}`;
}

export function draftFromArchivePayload(payload: unknown): ArchiveDraft {
  const p =
    payload && typeof payload === "object" ? (payload as Record<string, unknown>) : {};
  const name = String(p.archiveName ?? "");
  const m = name.match(/^(\d{4}-\d{2}-\d{2})_([^_]+)_(.+?)(\.[^.]+)?$/);
  const fromPayloadExt =
    typeof p.sourceExtension === "string"
      ? p.sourceExtension
      : typeof p.mimeType === "string" && p.mimeType.includes("png")
        ? ".png"
        : typeof p.mimeType === "string" && p.mimeType.includes("jpeg")
          ? ".jpg"
          : null;
  const rawType =
    m?.[2] ??
    (typeof p.displayType === "string" ? p.displayType : null) ??
    String(p.documentType ?? "OTHER");
  return {
    date: m?.[1] ?? new Date().toISOString().slice(0, 10),
    docType: coerceArchiveDocType(rawType),
    entity: (m?.[3] ?? String(p.entity ?? p.creditorName ?? "Unknown")).replace(/_/g, " "),
    archiveCategory: Number(p.archiveCategory ?? 9) || 9,
    extension: sanitizeArchiveExtension(
      m?.[4] ?? fromPayloadExt ?? extensionFromFilename(name, ".pdf"),
    ),
  };
}
