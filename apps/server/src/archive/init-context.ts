/**
 * After Google Drive is linked: list taxonomy folders + recent file names,
 * then ask the best available reasoning model for a compact archive index
 * stored as MemoryFact keys (archive.index / archive.taxonomy / archive.refreshedAt).
 */
import type { PrismaClient } from "@prisma/client";
import { config } from "../config.js";
import { chatCompletion, humanizeOllamaError, resolveOllamaHost } from "../ollama/client.js";
import { vramLock } from "../ollama/vram-lock.js";
import { driveStatus, listDriveArchiveFiles } from "./drive.js";

export const ARCHIVE_INDEX_KEY = "archive.index";
export const ARCHIVE_TAXONOMY_KEY = "archive.taxonomy";
export const ARCHIVE_REFRESHED_KEY = "archive.refreshedAt";

export type ArchiveInitResult = {
  ok: boolean;
  linked: boolean;
  folderCount: number;
  fileCount: number;
  model: string | null;
  facts: { key: string; value: string }[];
  message: string;
};

async function upsertFact(
  prisma: PrismaClient,
  key: string,
  value: string,
): Promise<{ key: string; value: string }> {
  await prisma.memoryFact.upsert({
    where: { key },
    create: {
      key,
      value,
      source: "archive-init",
      specialistId: "secretary",
    },
    update: {
      value,
      source: "archive-init",
      specialistId: "secretary",
    },
  });
  return { key, value };
}

function compactListing(files: Array<{ name: string; folderLabel: string }>): string {
  const byFolder = new Map<string, string[]>();
  for (const f of files) {
    const list = byFolder.get(f.folderLabel) ?? [];
    if (list.length < 10) list.push(f.name);
    byFolder.set(f.folderLabel, list);
  }
  const lines: string[] = [];
  for (const [folder, names] of byFolder) {
    lines.push(`${folder}: ${names.join("; ") || "(empty)"}`);
  }
  return lines.join("\n").slice(0, 6000);
}

export async function refreshArchiveContext(
  prisma: PrismaClient,
  profileId?: string | null,
): Promise<ArchiveInitResult> {
  const status = driveStatus(profileId);
  if (!status.linked && !status.enabled) {
    return {
      ok: false,
      linked: false,
      folderCount: 0,
      fileCount: 0,
      model: null,
      facts: [],
      message:
        "Google Drive is not linked. Link Drive in Settings first, then refresh archive context.",
    };
  }

  const listing = await listDriveArchiveFiles({ profileId, perFolder: 15 });
  const taxonomyLines = listing.folders
    .map((f) => `${f.label} (${f.fileCount} recent listed)`)
    .join("\n");
  const fileLines = compactListing(listing.files);
  const refreshedAt = new Date().toISOString();

  const taxonomyFact = await upsertFact(
    prisma,
    ARCHIVE_TAXONOMY_KEY,
    taxonomyLines || "(no taxonomy folders resolved yet)",
  );

  let summary =
    `Drive archive snapshot ${refreshedAt}. Folders:\n${taxonomyLines}\n\nRecent files:\n${fileLines || "(none listed)"}`.slice(
      0,
      1800,
    );
  let model: string | null = null;
  let host = "";

  const release = await vramLock.acquire("REASONING");
  try {
    host = await resolveOllamaHost();
    model = config.reasoningModel;
    const prompt = `You are indexing a Swiss personal document archive for PersonAI.
Given taxonomy folders and recent file names, write a compact archive context (max 900 characters) the user's specialists can use.
Include: what kinds of documents exist, notable entities/creditors/authorities if obvious from names, and gaps (empty folders).
Plain language. No invented contents of files. German or English matching the filenames.

TAXONOMY:
${taxonomyLines || "(none)"}

RECENT FILES:
${fileLines || "(none)"}`;

    const raw = await chatCompletion({
      host,
      model,
      messages: [
        { role: "system", content: "Return only the compact archive context text." },
        { role: "user", content: prompt },
      ],
      timeoutMs: 120_000,
    });
    const cleaned = raw.replace(/\s+/g, " ").trim();
    if (cleaned.length > 40) {
      summary = cleaned.slice(0, 1800);
    }
  } catch (err) {
    // Fall back to deterministic listing — still useful without Ollama.
    summary = `${summary}\n\n(Note: model summary unavailable: ${humanizeOllamaError(err, host || undefined, model ?? undefined)})`.slice(
      0,
      1800,
    );
  } finally {
    await release();
  }

  const indexFact = await upsertFact(prisma, ARCHIVE_INDEX_KEY, summary);
  const refreshedFact = await upsertFact(prisma, ARCHIVE_REFRESHED_KEY, refreshedAt);

  return {
    ok: true,
    linked: listing.linked || status.linked || status.enabled,
    folderCount: listing.folders.length,
    fileCount: listing.files.length,
    model,
    facts: [indexFact, taxonomyFact, refreshedFact],
    message:
      listing.files.length === 0
        ? "Archive context refreshed. Folders are ready; no recent files were listed yet."
        : `Archive context refreshed from ${listing.files.length} recent file names across ${listing.folders.length} folders.`,
  };
}

export async function getArchiveContextMeta(prisma: PrismaClient): Promise<{
  ready: boolean;
  refreshedAt: string | null;
  indexPreview: string | null;
}> {
  const rows = await prisma.memoryFact.findMany({
    where: { key: { in: [ARCHIVE_INDEX_KEY, ARCHIVE_REFRESHED_KEY] } },
  });
  const map = new Map(rows.map((r) => [r.key, r.value]));
  const index = map.get(ARCHIVE_INDEX_KEY) ?? null;
  const refreshedAt = map.get(ARCHIVE_REFRESHED_KEY) ?? null;
  return {
    ready: Boolean(index?.trim()),
    refreshedAt,
    indexPreview: index ? index.slice(0, 240) : null,
  };
}
