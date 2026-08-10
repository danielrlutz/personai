import type { PendingConfirmation } from "@/lib/api-client";
import {
  draftFromArchivePayload,
  type ArchiveDraft,
} from "@/lib/archive-naming";

export function payloadRecord(payload: unknown): Record<string, unknown> {
  return payload && typeof payload === "object" ? (payload as Record<string, unknown>) : {};
}

export function draftFromConfirmation(c: PendingConfirmation): ArchiveDraft | null {
  if (c.action !== "archive.commit" && c.action !== "ledger.write") return null;
  return draftFromArchivePayload(c.payload);
}

export function documentIdFromConfirmation(c: PendingConfirmation): string | null {
  const p = payloadRecord(c.payload);
  if (typeof p.documentId === "string" && p.documentId.trim()) return p.documentId.trim();
  if (c.entity === "Document" && typeof c.entityId === "string" && c.entityId.trim()) {
    return c.entityId.trim();
  }
  return null;
}

export type PreviewState = {
  url: string;
  contentType: string;
  filename: string;
  documentId: string;
};
