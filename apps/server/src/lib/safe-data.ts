/**
 * Boundary coercion for OCR/LLM/user input before Prisma writes.
 * Never pass Invalid Date (or NaN amounts / unknown enums) into create/update.
 */

const INVALID_DATE_TOKENS = new Set([
  "",
  "invalid",
  "invalid date",
  "null",
  "undefined",
  "none",
  "n/a",
  "na",
  "unknown",
  "-",
  "--",
  "—",
]);

/** Valid Date → keep; invalid/empty → null. Never returns Invalid Date. */
export function safeDate(value: unknown): Date | null {
  if (value == null) return null;
  if (value instanceof Date) {
    return Number.isFinite(value.getTime()) ? value : null;
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) return null;
    const d = new Date(value);
    return Number.isFinite(d.getTime()) ? d : null;
  }
  const s = String(value).trim();
  if (!s || INVALID_DATE_TOKENS.has(s.toLowerCase())) return null;
  // Require at least one digit — rejects "--", "asap", etc.
  if (!/\d/.test(s)) return null;
  const d = new Date(s);
  if (!Number.isFinite(d.getTime())) return null;
  const year = d.getUTCFullYear();
  if (year < 1900 || year > 2100) return null;
  return d;
}

/** Like safeDate but falls back to now when missing/invalid. */
export function safeDateOrNow(value: unknown): Date {
  return safeDate(value) ?? new Date();
}

/**
 * For Prisma optional DateTime fields from request bodies:
 * - undefined → omit (caller should not set the field)
 * - null / "" / invalid → null
 * - valid → Date
 */
export function optionalDateInput(value: unknown): Date | null | undefined {
  if (value === undefined) return undefined;
  if (value === null || value === "") return null;
  return safeDate(value);
}

/** YYYY-MM-DD for archive naming; invalid/empty → today (UTC). */
export function archiveDatePrefix(value: unknown): string {
  const d = safeDate(value);
  if (d) return d.toISOString().slice(0, 10);
  const s = String(value ?? "").trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s) && safeDate(s)) return s;
  return new Date().toISOString().slice(0, 10);
}

export function safeFiniteNumber(value: unknown): number | null {
  if (value == null || value === "") return null;
  const n = typeof value === "number" ? value : Number(String(value).trim());
  return Number.isFinite(n) ? n : null;
}

export function safeFiniteNumberOr(
  value: unknown,
  fallback: number,
): number {
  return safeFiniteNumber(value) ?? fallback;
}

export function safeEnum<T extends string>(
  value: unknown,
  allowed: readonly T[],
  fallback: T,
): T {
  const s = String(value ?? "").trim();
  return (allowed as readonly string[]).includes(s) ? (s as T) : fallback;
}

/** Strip path/control chars; collapse underscores; bound length. */
export function sanitizeArchiveEntity(value: unknown, fallback = "Unknown"): string {
  const raw = String(value ?? "")
    .replace(/[^\wÄÖÜäöüéèêà.-]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_|_$/g, "");
  const entity = raw.slice(0, 48);
  return entity || fallback;
}

export function sanitizeExtension(value: unknown, fallback = ".pdf"): string {
  let ext = String(value ?? fallback).trim() || fallback;
  if (!ext.startsWith(".")) ext = `.${ext}`;
  ext = ext.replace(/[^\w.]/g, "");
  if (ext === "." || !ext) return fallback;
  return ext.slice(0, 16);
}

/** Human-friendly Prisma / DB errors for API responses (no stack dumps). */
export function publicErrorMessage(err: unknown): string {
  if (!(err instanceof Error)) return String(err);
  const msg = err.message ?? String(err);
  if (msg.includes("Invalid value for argument") && msg.includes("Date")) {
    return "Invalid date value — use YYYY-MM-DD or leave empty.";
  }
  if (msg.includes("Invalid `prisma.") || msg.includes("PrismaClient")) {
    const short = msg.split("\n").find((l) => l.trim() && !l.includes("invocation")) ?? msg;
    return short.replace(/\s+/g, " ").trim().slice(0, 280);
  }
  return msg;
}
