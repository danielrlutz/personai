/**
 * DriveCorpus / ArchiveIndex — local retrieval over the configured Google Drive root.
 */
export {
  getKnowledgeStats,
  driveKnowledgeDbPath,
  listFolderLabels,
  readTerminology,
  type KnowledgeStats,
} from "./store.js";
export {
  retrieveDriveKnowledge,
  formatKnowledgePromptBlock,
  buildKnowledgeInjection,
  type RetrievedChunk,
} from "./retrieve.js";
export {
  SERVER_JOB_DRIVE_KNOWLEDGE_REINDEX,
  runKnowledgeReindexBatch,
  type KnowledgeReindexPayload,
  type KnowledgeReindexResult,
} from "./sync.js";
export {
  accumulateTerminology,
  formatNamingMuscle,
  folderAliasesFromLabels,
  tokenizeFilename,
  detectFolderNumberingStyle,
} from "./terminology.js";
export { pickEmbedModel, EMBED_MODEL_CANDIDATES } from "./embed.js";

import type { PrismaClient } from "@prisma/client";
import { enqueueServerJob } from "../../jobs/server-jobs.js";
import {
  getKnowledgeStats,
  listFolderLabels,
} from "./store.js";
import { folderAliasesFromLabels } from "./terminology.js";
import { SERVER_JOB_DRIVE_KNOWLEDGE_REINDEX } from "./sync.js";

/** Enqueue durable full reindex (batches continue via ServerJob). */
export async function enqueueDriveKnowledgeReindexForProfile(
  prisma: PrismaClient,
  profileId: string,
): Promise<{ jobId: string; stats: ReturnType<typeof getKnowledgeStats> }> {
  const job = await enqueueServerJob(prisma, {
    type: SERVER_JOB_DRIVE_KNOWLEDGE_REINDEX,
    payload: { offset: 0, pruneMissing: true },
  });
  return { jobId: job.id, stats: getKnowledgeStats(profileId) };
}

/** Folder-match aliases learned from the local index (indexed names, not regex-only). */
export function loadIndexedFolderAliases(profileId: string): Record<number, string[]> {
  try {
    return folderAliasesFromLabels(listFolderLabels(profileId));
  } catch {
    return {};
  }
}

export type KnowledgeStatusDto = {
  ready: boolean;
  fileCount: number;
  chunkCount: number;
  withEmbedding: number;
  embedModel: string | null;
  lastSyncAt: string | null;
  lastSyncStatus: string | null;
  keywordOnly: boolean;
};

export function getDriveKnowledgeStatus(profileId: string | null | undefined): KnowledgeStatusDto {
  if (!profileId) {
    return {
      ready: false,
      fileCount: 0,
      chunkCount: 0,
      withEmbedding: 0,
      embedModel: null,
      lastSyncAt: null,
      lastSyncStatus: null,
      keywordOnly: true,
    };
  }
  const s = getKnowledgeStats(profileId);
  return {
    ready: s.fileCount > 0 && (s.lastSyncStatus === "ready" || s.chunkCount > 0),
    fileCount: s.fileCount,
    chunkCount: s.chunkCount,
    withEmbedding: s.withEmbedding,
    embedModel: s.embedModel,
    lastSyncAt: s.lastSyncAt,
    lastSyncStatus: s.lastSyncStatus,
    keywordOnly: !s.embedModel || s.withEmbedding === 0,
  };
}
