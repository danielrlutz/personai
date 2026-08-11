/**
 * Privacy-first user correction log — per-profile JSONL under data/profiles/{id}/.
 * Captures before→after edits so OCR, naming, and LLM prompts can compound intent.
 * Durable MemoryFact / staging writes stay confirm-gated (no silent cloud training).
 */
import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import type { PrismaClient } from "@prisma/client";
import { profileDir } from "../config.js";
import { createConfirmation } from "../confirm/confirm-service.js";
import {
  entityFromArchiveName,
  normalizeEntityLabel,
  queueFilingMemoryProposal,
} from "./filing-memory.js";
import { coerceArchiveTypeToken, normalizeDocumentType } from "../archive/doc-type-tokens.js";
import type { StagingDocId } from "./staging.js";
import { appendStagingBullet } from "./staging.js";

export const CORRECTIONS_FILENAME = "corrections.jsonl";
export const CORRECTION_PROMOTE_THRESHOLD = 2;
export const CORRECTIONS_INJECT_BUDGET_DEFAULT = 700;

export type CorrectionKind =
  | "naming.patch"
  | "confirm.reject"
  | "reinspect.flag"
  | "drive.prefer_folder"
  | "staging.edit"
  | "team.remember";

export type UserCorrection = {
  id: string;
  at: string;
  kind: CorrectionKind;
  /** Stable fingerprint for repeat detection (kind + salient after). */
  signature: string;
  /** Opaque context hash (confirmation / doc / entity) — not PII dump. */
  contextHash: string;
  before: Record<string, unknown>;
  after: Record<string, unknown>;
  confirmationId?: string | null;
  documentId?: string | null;
  action?: string | null;
  summary?: string | null;
  /** Soft learning only until confirm promotes to MemoryFact / staging. */
  promoted?: boolean;
};

export function correctionsPath(profileId: string): string {
  return path.join(profileDir(profileId), CORRECTIONS_FILENAME);
}

export function hashContext(parts: Array<string | number | null | undefined>): string {
  const raw = parts
    .map((p) => (p == null ? "" : String(p).trim().toLowerCase()))
    .join("|");
  return createHash("sha256").update(raw).digest("hex").slice(0, 16);
}

export function correctionSignature(
  kind: CorrectionKind,
  after: Record<string, unknown>,
): string {
  const salient = (() => {
    switch (kind) {
      case "naming.patch":
        // Entity→folder (+ vocab token) — ignore per-file dates/names for repeat detection.
        return [after.entity, after.archiveCategory, after.docTypeToken].join("→");
      case "confirm.reject":
        return [after.action, after.reason ?? "reject"].join("→");
      case "reinspect.flag":
        return [after.documentId, after.reason ?? "incomplete"].join("→");
      case "drive.prefer_folder":
        return [after.category, after.folderId].join("→");
      case "staging.edit":
        return [after.docId, after.contentHash].join("→");
      case "team.remember":
        return [after.key, after.value].join("→");
      default:
        return JSON.stringify(after);
    }
  })();
  return hashContext([kind, salient]);
}

function ensureParentDir(filePath: string): void {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

/** Append one structured correction event (best-effort; never throws to callers). */
export async function appendCorrection(
  profileId: string,
  partial: Omit<UserCorrection, "id" | "at" | "signature"> & {
    signature?: string;
    id?: string;
    at?: string;
  },
): Promise<UserCorrection> {
  const event: UserCorrection = {
    id: partial.id ?? randomUUID(),
    at: partial.at ?? new Date().toISOString(),
    kind: partial.kind,
    signature: partial.signature ?? correctionSignature(partial.kind, partial.after),
    contextHash: partial.contextHash,
    before: partial.before ?? {},
    after: partial.after ?? {},
    confirmationId: partial.confirmationId ?? null,
    documentId: partial.documentId ?? null,
    action: partial.action ?? null,
    summary: partial.summary ?? null,
    promoted: partial.promoted ?? false,
  };
  const file = correctionsPath(profileId);
  ensureParentDir(file);
  await fsp.appendFile(file, `${JSON.stringify(event)}\n`, "utf-8");
  return event;
}

export async function listCorrections(
  profileId: string,
  opts?: { limit?: number; kind?: CorrectionKind },
): Promise<UserCorrection[]> {
  const file = correctionsPath(profileId);
  if (!fs.existsSync(file)) return [];
  const raw = await fsp.readFile(file, "utf-8");
  const lines = raw.split(/\r?\n/).filter((l) => l.trim());
  const out: UserCorrection[] = [];
  for (const line of lines) {
    try {
      const row = JSON.parse(line) as UserCorrection;
      if (!row?.id || !row?.kind) continue;
      if (opts?.kind && row.kind !== opts.kind) continue;
      out.push(row);
    } catch {
      // skip corrupt lines
    }
  }
  const limit = Math.max(1, Math.min(opts?.limit ?? 50, 200));
  return out.slice(-limit).reverse();
}

export async function countSignature(
  profileId: string,
  signature: string,
): Promise<number> {
  const all = await listCorrections(profileId, { limit: 200 });
  return all.filter((c) => c.signature === signature).length;
}

/** Parse entity + category/docType from naming before/after snapshots. */
export function namingFieldsFromPayload(payload: Record<string, unknown>): {
  entity: string;
  archiveCategory: number | null;
  archiveName: string;
  docTypeToken: string | null;
  date: string | null;
} {
  const archiveName = typeof payload.archiveName === "string" ? payload.archiveName : "";
  const entityDirect = [payload.entity, payload.creditorName, payload.vendor]
    .map((v) => (typeof v === "string" ? normalizeEntityLabel(v) : ""))
    .find((s) => s.length >= 2);
  const entity = entityDirect || entityFromArchiveName(archiveName) || "";
  const catRaw = payload.archiveCategory;
  const archiveCategory =
    catRaw != null && !Number.isNaN(Number(catRaw)) ? Number(catRaw) : null;
  let docTypeToken: string | null = null;
  const base = archiveName.replace(/^.*[/\\]/, "").replace(/\.[^.]+$/, "");
  const m = base.match(/^\d{4}-\d{2}-\d{2}_([^_]+)_/);
  if (m?.[1]) docTypeToken = coerceArchiveTypeToken(m[1]);
  const date = base.match(/^(\d{4}-\d{2}-\d{2})_/)?.[1] ?? null;
  return { entity, archiveCategory, archiveName, docTypeToken, date };
}

export async function recordNamingPatch(opts: {
  profileId: string;
  confirmationId: string;
  documentId?: string | null;
  action?: string | null;
  beforePayload: Record<string, unknown>;
  afterPayload: Record<string, unknown>;
  prisma?: PrismaClient;
}): Promise<UserCorrection | null> {
  const before = namingFieldsFromPayload(opts.beforePayload);
  const after = namingFieldsFromPayload(opts.afterPayload);
  const changed =
    before.archiveName !== after.archiveName ||
    before.archiveCategory !== after.archiveCategory ||
    before.entity !== after.entity ||
    before.docTypeToken !== after.docTypeToken ||
    before.date !== after.date;
  if (!changed) return null;

  const event = await appendCorrection(opts.profileId, {
    kind: "naming.patch",
    contextHash: hashContext([
      opts.confirmationId,
      after.entity,
      after.archiveCategory,
      after.docTypeToken,
    ]),
    before: { ...before },
    after: { ...after },
    confirmationId: opts.confirmationId,
    documentId: opts.documentId ?? null,
    action: opts.action ?? null,
    summary: after.archiveName
      ? `Naming: ${after.archiveName} (folder ${after.archiveCategory ?? "?"})`
      : `Category → ${after.archiveCategory}`,
  });

  if (opts.prisma) {
    await maybePromoteNamingPreference(opts.prisma, opts.profileId, event);
  }
  return event;
}

export async function recordConfirmReject(opts: {
  profileId: string;
  confirmationId: string;
  action: string;
  summary?: string | null;
  documentId?: string | null;
  payload?: Record<string, unknown>;
}): Promise<UserCorrection> {
  const naming = namingFieldsFromPayload(opts.payload ?? {});
  return appendCorrection(opts.profileId, {
    kind: "confirm.reject",
    contextHash: hashContext([opts.confirmationId, opts.action, naming.entity]),
    before: { action: opts.action, summary: opts.summary ?? null, ...naming },
    after: { action: opts.action, decision: "reject", reason: "user_declined" },
    confirmationId: opts.confirmationId,
    documentId: opts.documentId ?? null,
    action: opts.action,
    summary: opts.summary ? `Declined: ${opts.summary}` : `Declined ${opts.action}`,
  });
}

export async function recordReinspectFlag(opts: {
  profileId: string;
  confirmationId: string;
  documentId: string;
  summary?: string | null;
  payload?: Record<string, unknown>;
}): Promise<UserCorrection> {
  const naming = namingFieldsFromPayload(opts.payload ?? {});
  return appendCorrection(opts.profileId, {
    kind: "reinspect.flag",
    contextHash: hashContext([opts.documentId, naming.entity, naming.docTypeToken]),
    before: { status: "pending", ...naming },
    after: {
      status: "flagged",
      reason: "incomplete_or_wrong",
      documentId: opts.documentId,
      entity: naming.entity,
      docTypeToken: naming.docTypeToken,
    },
    confirmationId: opts.confirmationId,
    documentId: opts.documentId,
    summary: opts.summary
      ? `Flagged for closer inspection: ${opts.summary}`
      : "Flagged for closer inspection",
  });
}

export async function recordDrivePrefer(opts: {
  profileId: string;
  category: number;
  folderId: string;
  folderName?: string | null;
}): Promise<UserCorrection> {
  return appendCorrection(opts.profileId, {
    kind: "drive.prefer_folder",
    contextHash: hashContext([opts.category, opts.folderId]),
    before: {},
    after: {
      category: opts.category,
      folderId: opts.folderId,
      folderName: opts.folderName ?? null,
    },
    summary: opts.folderName
      ? `Prefer folder ${opts.category}: ${opts.folderName}`
      : `Prefer folder for category ${opts.category}`,
  });
}

export async function recordStagingEdit(opts: {
  profileId: string;
  docId: StagingDocId;
  beforeContent: string;
  afterContent: string;
}): Promise<UserCorrection | null> {
  const beforeHash = hashContext([opts.beforeContent.slice(0, 4000)]);
  const afterHash = hashContext([opts.afterContent.slice(0, 4000)]);
  if (beforeHash === afterHash) return null;
  return appendCorrection(opts.profileId, {
    kind: "staging.edit",
    contextHash: hashContext([opts.docId, afterHash]),
    before: { docId: opts.docId, contentHash: beforeHash, chars: opts.beforeContent.length },
    after: { docId: opts.docId, contentHash: afterHash, chars: opts.afterContent.length },
    summary: `Edited personality vault ${opts.docId}.md`,
  });
}

export async function recordTeamRemember(opts: {
  profileId: string;
  key: string;
  value: string;
  source?: string | null;
  specialistId?: string | null;
}): Promise<UserCorrection> {
  return appendCorrection(opts.profileId, {
    kind: "team.remember",
    contextHash: hashContext([opts.key, opts.value.slice(0, 120)]),
    before: {},
    after: {
      key: opts.key,
      value: opts.value.slice(0, 500),
      source: opts.source ?? "team-chat",
      specialistId: opts.specialistId ?? null,
    },
    summary: `Remember: ${opts.key}`,
  });
}

/**
 * After the same naming correction repeats, auto-stage memory.fact (still confirm-gated).
 * Also refreshes soft archive.naming.muscle-style token hints from correction vocabulary.
 */
export async function maybePromoteNamingPreference(
  prisma: PrismaClient,
  profileId: string,
  event: UserCorrection,
): Promise<{ promoted: boolean; reason?: string }> {
  if (event.kind !== "naming.patch") return { promoted: false, reason: "not_naming" };
  const entity = String(event.after.entity ?? "");
  const archiveCategory = Number(event.after.archiveCategory);
  if (!entity || !Number.isFinite(archiveCategory)) {
    return { promoted: false, reason: "incomplete" };
  }
  const count = await countSignature(profileId, event.signature);
  if (count < CORRECTION_PROMOTE_THRESHOLD) {
    return { promoted: false, reason: "below_threshold" };
  }
  const queued = await queueFilingMemoryProposal(prisma, {
    entity,
    archiveCategory,
    documentId: event.documentId,
    archiveName: typeof event.after.archiveName === "string" ? event.after.archiveName : null,
  });
  await maybeRefreshCorrectionVocabFact(prisma, profileId);
  return {
    promoted: Boolean(queued.queued),
    reason: queued.queued ? "memory_fact_queued" : queued.reason,
  };
}

const CORRECTION_VOCAB_KEY = "archive.correction.vocab";

/** Harvest Invoice/Rechnung-style tokens from recent naming corrections into a MemoryFact. */
export async function maybeRefreshCorrectionVocabFact(
  prisma: PrismaClient,
  profileId: string,
): Promise<void> {
  const recent = await listCorrections(profileId, { limit: 80, kind: "naming.patch" });
  const tokens = new Map<string, number>();
  for (const c of recent) {
    const tok = String(c.after.docTypeToken ?? "").trim();
    if (!tok || tok.length < 2) continue;
    // Never store shouty enums
    if (/^[A-Z][A-Z0-9_]{1,31}$/.test(tok) && tok === tok.toUpperCase() && tok.includes("_")) {
      continue;
    }
    if (tok.toUpperCase() === "BILL") continue;
    tokens.set(tok, (tokens.get(tok) ?? 0) + 1);
  }
  if (tokens.size === 0) return;
  const ranked = [...tokens.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, 12)
    .map(([t, n]) => `${t}×${n}`)
    .join(", ");
  await prisma.memoryFact.upsert({
    where: { key: CORRECTION_VOCAB_KEY },
    create: {
      key: CORRECTION_VOCAB_KEY,
      value: ranked.slice(0, 900),
      source: "correction-learning",
    },
    update: {
      value: ranked.slice(0, 900),
      source: "correction-learning",
    },
  });
}

/** Soft category preference from corrections (before MemoryFact confirm). */
export async function lookupCorrectionArchiveCategory(
  profileId: string,
  entity: string,
): Promise<number | null> {
  const label = normalizeEntityLabel(entity);
  if (!label) return null;
  const recent = await listCorrections(profileId, { limit: 100, kind: "naming.patch" });
  const votes = new Map<number, number>();
  for (const c of recent) {
    const e = normalizeEntityLabel(String(c.after.entity ?? ""));
    if (!e || e.toLowerCase() !== label.toLowerCase()) continue;
    const cat = Number(c.after.archiveCategory);
    if (!Number.isFinite(cat) || cat < 1 || cat > 10) continue;
    votes.set(cat, (votes.get(cat) ?? 0) + 1);
  }
  let best: number | null = null;
  let bestN = 0;
  for (const [cat, n] of votes) {
    if (n > bestN) {
      best = cat;
      bestN = n;
    }
  }
  return bestN > 0 ? best : null;
}

/** Preferred human DocType token from correction history for an internal type. */
export async function lookupCorrectionDocTypeToken(
  profileId: string,
  documentType: string | null | undefined,
): Promise<string | null> {
  const dt = normalizeDocumentType(documentType);
  const recent = await listCorrections(profileId, { limit: 80, kind: "naming.patch" });
  const votes = new Map<string, number>();
  for (const c of recent) {
    const tok = String(c.after.docTypeToken ?? "").trim();
    if (!tok) continue;
    if (normalizeDocumentType(tok) !== dt) continue;
    votes.set(tok, (votes.get(tok) ?? 0) + 1);
  }
  let best: string | null = null;
  let bestN = 0;
  for (const [tok, n] of votes) {
    if (n > bestN) {
      best = tok;
      bestN = n;
    }
  }
  return bestN > 0 ? best : null;
}

/**
 * If the user often flags incomplete stacks, widen neighbor OCR next time.
 * Default radius 1; returns 2 when ≥2 reinspect flags share similar entity/type context.
 */
export async function preferredReinspectNeighborRadius(
  profileId: string,
  opts?: { entity?: string | null; docTypeToken?: string | null },
): Promise<number> {
  const flags = await listCorrections(profileId, { limit: 40, kind: "reinspect.flag" });
  if (flags.length === 0) return 1;
  const entity = normalizeEntityLabel(opts?.entity ?? "");
  const docType = (opts?.docTypeToken ?? "").trim().toLowerCase();
  let similar = 0;
  for (const f of flags) {
    const fe = normalizeEntityLabel(String(f.after.entity ?? ""));
    const ft = String(f.after.docTypeToken ?? "")
      .trim()
      .toLowerCase();
    if (entity && fe && fe.toLowerCase() === entity.toLowerCase()) {
      similar += 1;
      continue;
    }
    if (docType && ft && ft === docType) {
      similar += 1;
    }
  }
  if (similar >= 2 || flags.length >= 3) return 2;
  return 1;
}

/** Compact prompt block — char-budgeted; never dumps full vault. */
export async function buildCorrectionsInjection(
  profileId: string,
  charBudget = CORRECTIONS_INJECT_BUDGET_DEFAULT,
): Promise<string> {
  const recent = await listCorrections(profileId, { limit: 24 });
  if (recent.length === 0) return "";
  const lines: string[] = [
    "User corrections / preferences (local log — privacy-first; confirm before durable memory writes; never invent beyond this):",
  ];
  let used = lines[0]!.length;
  for (const c of recent) {
    const line = formatCorrectionLine(c);
    if (!line) continue;
    if (used + line.length + 1 > charBudget) break;
    lines.push(line);
    used += line.length + 1;
  }
  if (lines.length <= 1) return "";
  return lines.join("\n");
}

export function formatCorrectionLine(c: UserCorrection): string {
  switch (c.kind) {
    case "naming.patch": {
      const ent = String(c.after.entity || "doc");
      const cat = c.after.archiveCategory ?? "?";
      const tok = c.after.docTypeToken ? ` ${c.after.docTypeToken}` : "";
      return `- Naming: ${ent}${tok} → folder ${cat}`;
    }
    case "confirm.reject":
      return `- Declined: ${c.action ?? "confirm"}`;
    case "reinspect.flag":
      return `- Flagged incomplete (prefer wider neighbor merge)`;
    case "drive.prefer_folder": {
      const name = c.after.folderName ? ` (${c.after.folderName})` : "";
      return `- Drive folder prefer: cat ${c.after.category}${name}`;
    }
    case "staging.edit":
      return `- Edited vault ${c.after.docId}.md`;
    case "team.remember":
      return `- Remember: ${c.after.key}=${String(c.after.value ?? "").slice(0, 80)}`;
    default:
      return c.summary ? `- ${c.summary.slice(0, 120)}` : "";
  }
}

/**
 * Confirm-gated: propose appending a short bullet to preferences.md / ADHD.md.
 * Applied only after user confirms (memory.staging_append).
 */
export async function queueStagingBulletProposal(
  prisma: PrismaClient,
  opts: {
    docId: "preferences" | "ADHD";
    bullet: string;
    reason?: string;
    sourceCorrectionId?: string | null;
  },
): Promise<{ queued: boolean; confirmation?: unknown; reason?: string }> {
  const bullet = opts.bullet.replace(/\s+/g, " ").trim().replace(/^[-*]\s*/, "");
  if (!bullet || bullet.length < 3) return { queued: false, reason: "empty" };
  const clipped = bullet.slice(0, 240);
  const dedupeKey = `memory.staging_append:${opts.docId}:${hashContext([clipped])}`;
  const confirmation = await createConfirmation(prisma, {
    action: "memory.staging_append",
    summary: `Remember in ${opts.docId}.md: ${clipped}`,
    entity: "StagingDoc",
    dedupeKey,
    payload: {
      docId: opts.docId,
      bullet: clipped,
      source: "correction-remember",
      reason: opts.reason ?? "User asked to remember a correction",
      sourceCorrectionId: opts.sourceCorrectionId ?? null,
    },
  });
  return { queued: true, confirmation };
}

/** Apply confirmed staging bullet append (called from apply-confirmation). */
export async function applyStagingAppend(
  profileId: string,
  payload: Record<string, unknown>,
): Promise<{ docId: string; appended: boolean }> {
  const docId = String(payload.docId ?? "").trim();
  const bullet = String(payload.bullet ?? "").trim();
  if ((docId !== "preferences" && docId !== "ADHD") || !bullet) {
    throw new Error("memory.staging_append requires docId preferences|ADHD and bullet");
  }
  await appendStagingBullet(profileId, docId, bullet);
  return { docId, appended: true };
}

export type CorrectionsStatus = {
  totalRecent: number;
  byKind: Record<string, number>;
  recent: Array<{
    id: string;
    at: string;
    kind: CorrectionKind;
    summary: string | null;
    signature: string;
  }>;
  learningNote: string;
};

export async function correctionsStatus(profileId: string): Promise<CorrectionsStatus> {
  const recent = await listCorrections(profileId, { limit: 30 });
  const byKind: Record<string, number> = {};
  for (const c of recent) {
    byKind[c.kind] = (byKind[c.kind] ?? 0) + 1;
  }
  return {
    totalRecent: recent.length,
    byKind,
    recent: recent.slice(0, 12).map((c) => ({
      id: c.id,
      at: c.at,
      kind: c.kind,
      summary: c.summary ?? formatCorrectionLine(c).replace(/^- /, ""),
      signature: c.signature,
    })),
    learningNote:
      "PersonAI learns locally from your edits. Durable memory still needs confirmation — nothing is sent to train cloud models.",
  };
}
