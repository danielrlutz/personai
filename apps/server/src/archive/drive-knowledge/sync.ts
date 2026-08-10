/**
 * Incremental Drive → local knowledge index sync (ServerJob durable).
 */
import crypto from "node:crypto";
import type { PrismaClient } from "@prisma/client";
import { walkDriveArchiveTree, type DriveTreeFile } from "../drive.js";
import { embedTexts, resolveEmbedModel } from "./embed.js";
import {
  deleteMissingFiles,
  getFileHash,
  getKnowledgeStats,
  listFolderLabels,
  replaceTerminology,
  setSyncMeta,
  upsertKnowledgeFile,
} from "./store.js";
import {
  accumulateTerminology,
  folderAliasesFromLabels,
  formatNamingMuscle,
  tokenizeFilename,
} from "./terminology.js";

export const SERVER_JOB_DRIVE_KNOWLEDGE_REINDEX = "drive.knowledge_reindex";

export type KnowledgeReindexPayload = {
  /** Resume offset into sorted file list. */
  offset?: number;
  batchSize?: number;
  pruneMissing?: boolean;
};

export type KnowledgeReindexResult = {
  processed: number;
  upserted: number;
  skipped: number;
  removed: number;
  offset: number;
  total: number;
  more: boolean;
  embedModel: string | null;
  keywordOnly: boolean;
  message: string;
};

const DEFAULT_BATCH = 30;
const CHUNK_CHARS = 900;

function hashContent(parts: string[]): string {
  return crypto.createHash("sha256").update(parts.join("\0")).digest("hex").slice(0, 40);
}

function chunkText(text: string, size = CHUNK_CHARS): string[] {
  const clean = text.replace(/\s+/g, " ").trim();
  if (!clean) return [];
  const out: string[] = [];
  for (let i = 0; i < clean.length; i += size) {
    out.push(clean.slice(i, i + size));
    if (out.length >= 8) break;
  }
  return out;
}

function metaChunk(file: DriveTreeFile, ocrSnippet: string | null): string {
  const parsed = tokenizeFilename(file.name);
  return [
    `File: ${file.name}`,
    `Folder: ${file.folderPath || file.folderLabel}`,
    file.archiveCategory != null ? `Taxonomy: ${file.archiveCategory}` : null,
    parsed.docTypeCanonical ? `DocType: ${parsed.docTypeCanonical}` : null,
    parsed.entity ? `Entity: ${parsed.entity}` : null,
    parsed.date ? `Date: ${parsed.date}` : null,
    ocrSnippet ? `OCR: ${ocrSnippet.slice(0, 400)}` : null,
  ]
    .filter(Boolean)
    .join("\n");
}

async function lookupLocalOcr(
  prisma: PrismaClient,
  fileName: string,
): Promise<string | null> {
  try {
    const doc = await prisma.document.findFirst({
      where: {
        OR: [{ archiveName: fileName }, { filename: fileName }],
      },
      orderBy: { uploadedAt: "desc" },
      include: {
        extractions: { orderBy: { createdAt: "desc" }, take: 1 },
      },
    });
    const ext = doc?.extractions?.[0];
    if (!ext) return null;
    const structured = ext.structured?.trim();
    if (structured && structured.length > 20) return structured.slice(0, 6000);
    const raw = ext.rawJson?.trim();
    if (raw && raw.length > 20) return raw.slice(0, 6000);
    return null;
  } catch {
    return null;
  }
}

export async function runKnowledgeReindexBatch(opts: {
  prisma: PrismaClient;
  profileId: string;
  payload?: KnowledgeReindexPayload;
}): Promise<KnowledgeReindexResult> {
  const offset = Math.max(0, opts.payload?.offset ?? 0);
  const batchSize = Math.min(80, Math.max(5, opts.payload?.batchSize ?? DEFAULT_BATCH));
  const pruneMissing = opts.payload?.pruneMissing !== false;

  setSyncMeta(opts.profileId, {
    status: offset === 0 ? "scanning" : "indexing",
    at: new Date().toISOString(),
  });

  const walk = await walkDriveArchiveTree({ profileId: opts.profileId });
  const files = walk.files;
  const total = files.length;
  const slice = files.slice(offset, offset + batchSize);

  const { host, model: embedModel } = await resolveEmbedModel();
  setSyncMeta(opts.profileId, { embedModel });

  let upserted = 0;
  let skipped = 0;

  for (const file of slice) {
    const ocr = await lookupLocalOcr(opts.prisma, file.name);
    const meta = metaChunk(file, ocr);
    const bodyChunks = ocr ? chunkText(ocr) : [];
    const texts = [meta, ...bodyChunks];
    const contentHash = hashContent([
      file.name,
      file.folderPath,
      file.modifiedTime ?? "",
      String(file.archiveCategory ?? ""),
      ocr ?? "",
      embedModel ?? "keyword",
    ]);

    const prev = getFileHash(opts.profileId, file.id);
    if (prev === contentHash) {
      skipped += 1;
      continue;
    }

    let embeddings: Array<Float32Array | null> = texts.map(() => null);
    if (embedModel) {
      try {
        const vectors = await embedTexts({ host, model: embedModel, texts });
        embeddings = vectors;
      } catch {
        embeddings = texts.map(() => null);
      }
    }

    upsertKnowledgeFile(
      opts.profileId,
      {
        driveFileId: file.id,
        name: file.name,
        folderPath: file.folderPath,
        folderLabel: file.folderLabel,
        archiveCategory: file.archiveCategory,
        mimeType: file.mimeType,
        modifiedTime: file.modifiedTime,
        webViewLink: file.webViewLink,
        contentText: ocr,
        contentHash,
      },
      texts.map((text, i) => ({ text, embedding: embeddings[i] ?? null })),
    );
    upserted += 1;
  }

  const nextOffset = offset + slice.length;
  const more = nextOffset < total;
  let removed = 0;

  if (!more) {
    if (pruneMissing) {
      removed = deleteMissingFiles(opts.profileId, new Set(files.map((f) => f.id)));
    }
    const terms = accumulateTerminology(
      files.map((f) => ({ name: f.name, folderLabel: f.folderLabel })),
    );
    replaceTerminology(opts.profileId, terms);

    // Persist naming muscle + folder aliases for agents / folder-match.
    const muscle = formatNamingMuscle(terms);
    const aliases = folderAliasesFromLabels(listFolderLabels(opts.profileId));
    await opts.prisma.memoryFact.upsert({
      where: { key: "archive.naming.muscle" },
      create: {
        key: "archive.naming.muscle",
        value: muscle,
        source: "drive-knowledge",
        specialistId: "secretary",
      },
      update: {
        value: muscle,
        source: "drive-knowledge",
        specialistId: "secretary",
      },
    });
    await opts.prisma.memoryFact.upsert({
      where: { key: "archive.folder.aliases" },
      create: {
        key: "archive.folder.aliases",
        value: JSON.stringify(aliases),
        source: "drive-knowledge",
        specialistId: "secretary",
      },
      update: {
        value: JSON.stringify(aliases),
        source: "drive-knowledge",
        specialistId: "secretary",
      },
    });
    const stats = getKnowledgeStats(opts.profileId);
    await opts.prisma.memoryFact.upsert({
      where: { key: "archive.knowledge.stats" },
      create: {
        key: "archive.knowledge.stats",
        value: JSON.stringify(stats),
        source: "drive-knowledge",
        specialistId: "secretary",
      },
      update: {
        value: JSON.stringify(stats),
        source: "drive-knowledge",
        specialistId: "secretary",
      },
    });
    setSyncMeta(opts.profileId, {
      status: "ready",
      at: new Date().toISOString(),
      embedModel,
    });
  } else {
    setSyncMeta(opts.profileId, {
      status: `indexing:${nextOffset}/${total}`,
      at: new Date().toISOString(),
      embedModel,
    });
  }

  return {
    processed: slice.length,
    upserted,
    skipped,
    removed,
    offset: nextOffset,
    total,
    more,
    embedModel,
    keywordOnly: !embedModel,
    message: more
      ? `Indexed ${nextOffset}/${total} Drive files…`
      : `Drive knowledge ready: ${total} files` +
        (embedModel ? ` (embeddings: ${embedModel})` : " (keyword-only — pull an Ollama embed model for vectors)"),
  };
}
