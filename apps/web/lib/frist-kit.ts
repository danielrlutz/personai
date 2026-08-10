import type { PendingConfirmation } from "@/lib/api-client";

function payloadRecord(payload: unknown): Record<string, unknown> {
  return payload && typeof payload === "object" ? (payload as Record<string, unknown>) : {};
}

/** YYYY-MM-DD Frist from archive/ledger confirm payload, if present. */
export function fristDeadlineFromConfirmation(c: PendingConfirmation): string | null {
  if (c.action === "legal.frist_kit") return null;
  if (c.action !== "archive.commit" && c.action !== "ledger.write") return null;
  const p = payloadRecord(c.payload);
  const raw = p.deadline ?? p.dueDate;
  if (typeof raw !== "string" || !raw.trim()) return null;
  const day = raw.trim().slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(day) ? day : null;
}

export function fristKitProposeBody(c: PendingConfirmation, opts?: { archiveName?: string }) {
  const p = payloadRecord(c.payload);
  const deadline = fristDeadlineFromConfirmation(c);
  if (!deadline) return null;
  const documentId =
    typeof p.documentId === "string" && p.documentId.trim()
      ? p.documentId.trim()
      : c.entity === "Document" && typeof c.entityId === "string"
        ? c.entityId.trim()
        : undefined;
  const archiveName =
    opts?.archiveName ||
    (typeof p.archiveName === "string" ? p.archiveName : undefined);
  const entity =
    typeof p.entity === "string"
      ? p.entity
      : typeof p.creditorName === "string"
        ? p.creditorName
        : typeof p.vendor === "string"
          ? p.vendor
          : undefined;
  return {
    deadline,
    documentId,
    archiveName,
    entity,
    title:
      typeof p.title === "string" && p.title.trim()
        ? p.title.trim()
        : archiveName
          ? `Deadline (Frist): ${archiveName}`
          : undefined,
  };
}

export function teamHrefFromConfirmResult(result: unknown): string | null {
  if (!result || typeof result !== "object") return null;
  const r = result as { teamHref?: unknown; result?: { teamHref?: unknown } };
  if (typeof r.teamHref === "string" && r.teamHref.startsWith("/team/")) return r.teamHref;
  if (typeof r.result?.teamHref === "string" && r.result.teamHref.startsWith("/team/")) {
    return r.result.teamHref;
  }
  return null;
}
