import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { profileMemoryDir } from "../config.js";

/** OpenClaw-style personality vault filenames under profile `memory/`. */
export const STAGING_DOC_IDS = ["USER", "SOUL", "preferences", "people", "ADHD"] as const;
export type StagingDocId = (typeof STAGING_DOC_IDS)[number];

export type StagingDocMeta = {
  id: StagingDocId;
  filename: string;
  title: string;
  description: string;
  injectBudget: number;
  maxChars: number;
};

/** Catalog — keep SOUL distinct from the Soul News home widget. */
export const STAGING_DOCS: readonly StagingDocMeta[] = [
  {
    id: "USER",
    filename: "USER.md",
    title: "About you",
    description: "Identity, location, household, work context.",
    injectBudget: 1200,
    maxChars: 24_000,
  },
  {
    id: "SOUL",
    filename: "SOUL.md",
    title: "Soul / tone",
    description: "How Staff should sound and what matters to you.",
    injectBudget: 800,
    maxChars: 16_000,
  },
  {
    id: "preferences",
    filename: "preferences.md",
    title: "Preferences",
    description: "Budgets, hotels, travel, tools, standing likes/dislikes.",
    injectBudget: 1000,
    maxChars: 20_000,
  },
  {
    id: "people",
    filename: "people.md",
    title: "People",
    description: "Family, colleagues, and recurring contacts (keep sparse).",
    injectBudget: 800,
    maxChars: 16_000,
  },
  {
    id: "ADHD",
    filename: "ADHD.md",
    title: "ADHD / focus",
    description: "Attention, routines, and how you want tasks framed.",
    injectBudget: 600,
    maxChars: 12_000,
  },
] as const;

export const STAGING_TOTAL_INJECT_BUDGET = 3500;

const TEMPLATES: Record<StagingDocId, string> = {
  USER: `# USER

Who you are — name, location (e.g. Example City), household, work context.

Edit freely. PersonAI injects a truncated slice into Staff and specialist chats.
`,
  SOUL: `# SOUL

Tone and values — how the Jarvis-style team should sound with you.

## Agency (non-negotiable)
- Confirm-before-write: archive, ledger, mark-paid, medical export, career PDF, forge ship, premium spend.
- Specialists propose; you approve in **Needs your confirmation**.
- Never invent Fristen, amounts, or biography beyond what is written here / in prefs / archive.

## Team SOUL (optional notes)
- Staff — calm triage, proactive prefs
- CFO — money clarity, your invoice vocabulary
- Legal — Fristen without drama
- Others — keep short if you customize

Not the Soul News widget.
`,
  preferences: `# Preferences

Standing prefs Staff should use **proactively** when present (do not wait to be asked):

- Hotel / travel budget (e.g. ≤ CHF 180)
- Preferred area: Example City
- Invoice language: say **Invoice** (or Rechnung) — never raw enum BILL in chat
- Tools, banks, communication style
- Hard nos

Example: hotel budget ≤ CHF 180 · prefer Example City area · archive says Invoice not BILL
`,
  people: `# People

Sparse notes on recurring people (name → relation / context). Avoid secrets you would not want in a prompt.
`,
  ADHD: `# ADHD / focus

How you want work framed: chunk size, reminders, dopamine traps, preferred structure.
`,
};

export function isStagingDocId(raw: string): raw is StagingDocId {
  return (STAGING_DOC_IDS as readonly string[]).includes(raw);
}

export function stagingMeta(id: StagingDocId): StagingDocMeta {
  return STAGING_DOCS.find((d) => d.id === id)!;
}

export function ensureStagingDir(profileId: string): string {
  const dir = profileMemoryDir(profileId);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function docPath(profileId: string, id: StagingDocId): string {
  return path.join(ensureStagingDir(profileId), stagingMeta(id).filename);
}

function normalizeStagingText(content: string): string {
  return content.replace(/\r\n/g, "\n").replace(/\s+/g, " ").trim();
}

/** True when content is more than the shipped scaffold / empty headings. */
export function stagingHasSubstance(content: string, id?: StagingDocId): boolean {
  const normalized = normalizeStagingText(content);
  if (normalized.length < 24) return false;
  if (id && normalizeStagingText(TEMPLATES[id]) === normalized) return false;
  for (const tid of STAGING_DOC_IDS) {
    if (normalizeStagingText(TEMPLATES[tid]) === normalized) return false;
  }
  const lines = content
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith("#") && !l.startsWith("<!--"));
  const body = lines.join(" ").replace(/\s+/g, " ").trim();
  return body.length >= 12;
}

export type StagingDoc = {
  id: StagingDocId;
  filename: string;
  title: string;
  description: string;
  content: string;
  exists: boolean;
  charCount: number;
  injectBudget: number;
  maxChars: number;
  hasSubstance: boolean;
  updatedAt: string | null;
};

export async function readStagingDoc(profileId: string, id: StagingDocId): Promise<StagingDoc> {
  const meta = stagingMeta(id);
  const file = docPath(profileId, id);
  let content = "";
  let exists = false;
  let updatedAt: string | null = null;
  try {
    const stat = await fsp.stat(file);
    content = await fsp.readFile(file, "utf-8");
    exists = true;
    updatedAt = stat.mtime.toISOString();
  } catch {
    content = TEMPLATES[id];
  }
  return {
    id,
    filename: meta.filename,
    title: meta.title,
    description: meta.description,
    content,
    exists,
    charCount: content.length,
    injectBudget: meta.injectBudget,
    maxChars: meta.maxChars,
    hasSubstance: exists && stagingHasSubstance(content, id),
    updatedAt,
  };
}

export async function listStagingDocs(profileId: string): Promise<StagingDoc[]> {
  const out: StagingDoc[] = [];
  for (const id of STAGING_DOC_IDS) {
    out.push(await readStagingDoc(profileId, id));
  }
  return out;
}

export async function writeStagingDoc(
  profileId: string,
  id: StagingDocId,
  content: string,
): Promise<StagingDoc> {
  const meta = stagingMeta(id);
  const trimmed = content.replace(/\r\n/g, "\n");
  if (trimmed.length > meta.maxChars) {
    const err = new Error(`${meta.filename} exceeds ${meta.maxChars} characters`);
    (err as { statusCode?: number }).statusCode = 400;
    throw err;
  }
  const file = docPath(profileId, id);
  await fsp.writeFile(file, trimmed, "utf-8");
  return readStagingDoc(profileId, id);
}

/**
 * Append a short bullet to preferences.md / ADHD.md (confirm-gated callers only).
 * Dedupes exact bullet lines; creates the file from template when missing.
 */
export async function appendStagingBullet(
  profileId: string,
  id: "preferences" | "ADHD",
  bullet: string,
): Promise<StagingDoc> {
  const cleaned = bullet.replace(/\s+/g, " ").trim().replace(/^[-*]\s*/, "");
  if (!cleaned) {
    const err = new Error("bullet is required");
    (err as { statusCode?: number }).statusCode = 400;
    throw err;
  }
  const line = `- ${cleaned.slice(0, 240)}`;
  const existing = await readStagingDoc(profileId, id);
  const base = existing.exists ? existing.content.replace(/\r\n/g, "\n") : TEMPLATES[id];
  if (base.split(/\n/).some((l) => l.trim() === line)) {
    return existing.exists ? existing : writeStagingDoc(profileId, id, base);
  }
  const next = `${base.replace(/\s*$/, "")}\n\n## Learned from corrections\n${line}\n`;
  return writeStagingDoc(profileId, id, next);
}

export type StagingPromptSlice = {
  id: StagingDocId;
  filename: string;
  injected: string;
  truncated: boolean;
  charCount: number;
};

/**
 * Load substantive staging docs for prompt injection, respecting per-file and total budgets.
 * Privacy-first: empty / template-only / unsaved files are omitted.
 */
export async function loadStagingForPrompt(profileId: string): Promise<{
  slices: StagingPromptSlice[];
  block: string;
  totalInjected: number;
}> {
  const docs = await listStagingDocs(profileId);
  const slices: StagingPromptSlice[] = [];
  let remaining = STAGING_TOTAL_INJECT_BUDGET;

  for (const doc of docs) {
    if (!doc.hasSubstance || remaining <= 0) continue;
    const budget = Math.min(doc.injectBudget, remaining);
    const injected = doc.content.trim().slice(0, budget);
    const truncated = doc.content.trim().length > budget;
    slices.push({
      id: doc.id,
      filename: doc.filename,
      injected,
      truncated,
      charCount: injected.length,
    });
    remaining -= injected.length;
  }

  if (slices.length === 0) {
    return { slices, block: "", totalInjected: 0 };
  }

  const parts = [
    `Personality vault (local markdown under memory/ — use proactively when relevant; never invent beyond this). When prefs list hotels (your area), budgets, or Invoice language, apply them without being asked. Confirm-before-write still applies.`,
    ...slices.map(
      (s) => `### ${s.filename}${s.truncated ? " (truncated)" : ""}\n${s.injected}`,
    ),
  ];
  return {
    slices,
    block: parts.join("\n\n"),
    totalInjected: slices.reduce((n, s) => n + s.charCount, 0),
  };
}

/** Compact prefs-oriented slice for triage / brief. */
export async function loadStagingPrefsHint(profileId: string, maxChars = 900): Promise<string> {
  const preferIds: StagingDocId[] = ["preferences", "USER", "ADHD"];
  const chunks: string[] = [];
  let left = maxChars;
  for (const id of preferIds) {
    if (left <= 0) break;
    const doc = await readStagingDoc(profileId, id);
    if (!doc.hasSubstance) continue;
    const take = Math.min(left, Math.floor(maxChars / preferIds.length) + 80);
    const slice = doc.content.trim().slice(0, take);
    chunks.push(`[${doc.filename}]\n${slice}`);
    left -= slice.length;
  }
  return chunks.join("\n\n").slice(0, maxChars);
}
