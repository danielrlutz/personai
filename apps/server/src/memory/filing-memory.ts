import type { PrismaClient } from "@prisma/client";
import { createConfirmation } from "../confirm/confirm-service.js";
import { ARCHIVE_TAXONOMY } from "../specialists/roster.js";

const ENTITY_FACT_PREFIX = "entity.";
const UNKNOWN_ENTITIES = new Set(["unknown", "unk", "n/a", "na", "none", "-"]);

/** Slug for MemoryFact keys: entity.swisscom */
export function entityFactKey(entity: string): string | null {
  const slug = entity
    .toLowerCase()
    .replace(/[_\s]+/g, " ")
    .replace(/[^a-z0-9äöüéèêà.\s-]+/gi, "")
    .trim()
    .replace(/\s+/g, ".")
    .replace(/\.+/g, ".")
    .replace(/^\.+|\.+$/g, "")
    .slice(0, 60);
  if (!slug || UNKNOWN_ENTITIES.has(slug) || slug.length < 2) return null;
  return `${ENTITY_FACT_PREFIX}${slug}`;
}

/** Human display name from entity / archive basename. */
export function normalizeEntityLabel(raw: string): string {
  return raw
    .replace(/_/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80);
}

/**
 * Parse archive basename `{date}_{DocType}_{Entity}{ext}` → Entity (spaces).
 * Falls back to empty when the name is not canonical.
 */
export function entityFromArchiveName(archiveName: string): string {
  const base = archiveName.replace(/^.*[/\\]/, "").replace(/\.[^.]+$/, "");
  const m = base.match(/^\d{4}-\d{2}-\d{2}_[^_]+_(.+)$/);
  if (!m?.[1]) return "";
  return normalizeEntityLabel(m[1]);
}

/** Prefer payload.entity / creditorName, else parse archiveName. */
export function resolveFilingEntity(payload: Record<string, unknown>): string {
  const direct = [payload.entity, payload.creditorName, payload.vendor, payload.provider]
    .map((v) => (typeof v === "string" ? normalizeEntityLabel(v) : ""))
    .find((s) => s.length >= 2 && !UNKNOWN_ENTITIES.has(s.toLowerCase()));
  if (direct) return direct;
  const name = typeof payload.archiveName === "string" ? payload.archiveName : "";
  return entityFromArchiveName(name);
}

/** Value stored on MemoryFact — parseable + readable: `cat 4 Financial`. */
export function formatEntityCategoryValue(archiveCategory: number): string {
  const cat = Number.isFinite(archiveCategory) ? Math.trunc(archiveCategory) : 9;
  const label = ARCHIVE_TAXONOMY[cat as keyof typeof ARCHIVE_TAXONOMY] ?? "Misc";
  return `cat ${cat} ${label}`;
}

/** Extract taxonomy number from `cat 4 Financial` / `4` / `4|Financial`. */
export function parseEntityCategoryValue(value: string): number | null {
  const s = value.trim();
  let m = s.match(/^cat\s*(\d{1,2})\b/i);
  if (!m) m = s.match(/^(\d{1,2})\s*[|:]/);
  if (!m) m = s.match(/^(\d{1,2})$/);
  if (!m) return null;
  const n = Number(m[1]);
  if (!Number.isFinite(n) || n < 1 || n > 10) return null;
  return n;
}

export function isLearnableFilingCategory(archiveCategory: number): boolean {
  return Number.isFinite(archiveCategory) && archiveCategory >= 1 && archiveCategory <= 10;
}

/**
 * After a confirmed archive write, propose entity→category MemoryFact via
 * Needs your confirmation (`memory.fact`). No silent preference writes.
 */
export async function queueFilingMemoryProposal(
  prisma: PrismaClient,
  opts: {
    entity: string;
    archiveCategory: number;
    documentId?: string | null;
    archiveName?: string | null;
  },
): Promise<{ queued: boolean; confirmation?: unknown; reason?: string }> {
  const entity = normalizeEntityLabel(opts.entity);
  const key = entityFactKey(entity);
  if (!key) {
    return { queued: false, reason: "entity_unusable" };
  }
  if (!isLearnableFilingCategory(opts.archiveCategory)) {
    return { queued: false, reason: "category_invalid" };
  }

  const value = formatEntityCategoryValue(opts.archiveCategory);
  const existing = await prisma.memoryFact.findUnique({ where: { key } });
  if (existing && parseEntityCategoryValue(existing.value) === opts.archiveCategory) {
    return { queued: false, reason: "already_learned" };
  }

  const label = ARCHIVE_TAXONOMY[opts.archiveCategory as keyof typeof ARCHIVE_TAXONOMY] ?? "Misc";
  const summary = existing
    ? `Update filing memory: ${entity} → ${opts.archiveCategory} ${label}`
    : `Remember filing: ${entity} → ${opts.archiveCategory} ${label}`;

  const confirmation = await createConfirmation(prisma, {
    action: "memory.fact",
    summary,
    entity: "MemoryFact",
    dedupeKey: `memory.fact:${key}`,
    payload: {
      key,
      value,
      source: "filing-memory",
      reason: existing
        ? `Confirmed archive remapped ${entity} to folder ${opts.archiveCategory}`
        : `Confirmed archive filed ${entity} under folder ${opts.archiveCategory}`,
      documentId: opts.documentId ?? null,
      archiveName: opts.archiveName ?? null,
      archiveCategory: opts.archiveCategory,
      entityLabel: entity,
    },
  });

  return { queued: true, confirmation };
}

/** Lookup learned archive category for an entity (OCR / Staff reuse). */
export async function lookupEntityArchiveCategory(
  prisma: PrismaClient,
  entity: string,
): Promise<number | null> {
  const key = entityFactKey(normalizeEntityLabel(entity));
  if (!key) return null;
  const row = await prisma.memoryFact.findUnique({ where: { key } });
  if (!row) return null;
  return parseEntityCategoryValue(row.value);
}
