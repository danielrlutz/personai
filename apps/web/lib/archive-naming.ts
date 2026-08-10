/** Client-side archive naming helpers — keep extension aligned with stored bytes. */

export type ArchiveDraft = {
  date: string;
  docType: string;
  entity: string;
  archiveCategory: number;
  /** Includes leading dot, e.g. `.pdf` / `.png`. */
  extension: string;
};

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
  const docType = d.docType.trim().replace(/[^\w]/g, "") || "OTHER";
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
  return {
    date: m?.[1] ?? new Date().toISOString().slice(0, 10),
    docType: m?.[2] ?? String(p.documentType ?? "OTHER"),
    entity: (m?.[3] ?? String(p.entity ?? p.creditorName ?? "Unknown")).replace(/_/g, " "),
    archiveCategory: Number(p.archiveCategory ?? 9) || 9,
    extension: sanitizeArchiveExtension(
      m?.[4] ?? fromPayloadExt ?? extensionFromFilename(name, ".pdf"),
    ),
  };
}
