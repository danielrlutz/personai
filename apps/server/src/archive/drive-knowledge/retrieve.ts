/**
 * Hybrid keyword + vector retrieval for Drive knowledge injection into agents.
 */
import { cosineSimilarity, embedTexts, resolveEmbedModel } from "./embed.js";
import {
  getFilesByIds,
  getKnowledgeStats,
  keywordSearch,
  loadChunksWithEmbeddings,
  readTerminology,
} from "./store.js";
import { formatNamingMuscle } from "./terminology.js";

export type RetrievedChunk = {
  driveFileId: string;
  name: string;
  folderLabel: string;
  archiveCategory: number | null;
  webViewLink: string | null;
  text: string;
  score: number;
  source: "hybrid" | "keyword" | "vector";
};

const DEFAULT_TOP_K = 6;
const DEFAULT_CHAR_BUDGET = 1800;

function normalizeScores(
  items: Array<{ key: string; score: number }>,
): Map<string, number> {
  const map = new Map<string, number>();
  if (items.length === 0) return map;
  const max = Math.max(...items.map((i) => i.score), 1e-9);
  for (const i of items) map.set(i.key, i.score / max);
  return map;
}

export async function retrieveDriveKnowledge(opts: {
  profileId: string;
  query: string;
  topK?: number;
}): Promise<RetrievedChunk[]> {
  const profileId = opts.profileId;
  const query = opts.query.trim();
  if (!query || query.length < 2) return [];

  const stats = getKnowledgeStats(profileId);
  if (stats.fileCount === 0) return [];

  const topK = opts.topK ?? DEFAULT_TOP_K;
  const kw = keywordSearch(profileId, query, topK * 4);
  const kwNorm = normalizeScores(
    kw.map((k) => ({ key: String(k.chunkId), score: k.score })),
  );

  let vecHits: Array<{ chunkId: number; driveFileId: string; text: string; score: number }> =
    [];
  const { host, model } = await resolveEmbedModel();
  if (model && stats.withEmbedding > 0) {
    try {
      const [qEmb] = await embedTexts({ host, model, texts: [query.slice(0, 2000)] });
      if (qEmb) {
        const corpus = loadChunksWithEmbeddings(profileId);
        const scored = corpus
          .map((c) => ({
            chunkId: c.chunkId,
            driveFileId: c.driveFileId,
            text: c.text,
            score: cosineSimilarity(qEmb, c.embedding),
          }))
          .filter((c) => c.score > 0.15)
          .sort((a, b) => b.score - a.score)
          .slice(0, topK * 4);
        vecHits = scored;
      }
    } catch {
      // keyword-only
    }
  }
  const vecNorm = normalizeScores(
    vecHits.map((v) => ({ key: String(v.chunkId), score: v.score })),
  );

  const merged = new Map<
    number,
    { chunkId: number; driveFileId: string; text: string; score: number; source: RetrievedChunk["source"] }
  >();
  for (const k of kw) {
    const score = (kwNorm.get(String(k.chunkId)) ?? 0) * 0.45;
    merged.set(k.chunkId, {
      chunkId: k.chunkId,
      driveFileId: k.driveFileId,
      text: k.text,
      score,
      source: "keyword",
    });
  }
  for (const v of vecHits) {
    const add = (vecNorm.get(String(v.chunkId)) ?? 0) * 0.55;
    const prev = merged.get(v.chunkId);
    if (prev) {
      prev.score += add;
      prev.source = "hybrid";
    } else {
      merged.set(v.chunkId, {
        chunkId: v.chunkId,
        driveFileId: v.driveFileId,
        text: v.text,
        score: add,
        source: "vector",
      });
    }
  }

  const ranked = [...merged.values()].sort((a, b) => b.score - a.score).slice(0, topK);
  const files = getFilesByIds(
    profileId,
    ranked.map((r) => r.driveFileId),
  );

  return ranked.map((r) => {
    const f = files.get(r.driveFileId);
    return {
      driveFileId: r.driveFileId,
      name: f?.name ?? r.driveFileId,
      folderLabel: f?.folderLabel ?? "",
      archiveCategory: f?.archiveCategory ?? null,
      webViewLink: f?.webViewLink ?? null,
      text: r.text,
      score: r.score,
      source: r.source,
    };
  });
}

/** Char-budgeted block for specialist / Staff / brief system prompts. */
export function formatKnowledgePromptBlock(
  hits: RetrievedChunk[],
  opts?: { charBudget?: number; namingMuscle?: string | null },
): string {
  const budget = opts?.charBudget ?? DEFAULT_CHAR_BUDGET;
  if (hits.length === 0 && !opts?.namingMuscle?.trim()) return "";

  const header = [
    "Drive knowledge (private local index — not Google Gemini API):",
    "Cite driveFileId when referring to a document so the UI can offer View file.",
    "Confirm-before-write still applies for archive/ledger changes.",
  ];

  const lines: string[] = [...header];
  if (opts?.namingMuscle?.trim()) {
    lines.push(opts.namingMuscle.trim());
  }

  let used = lines.join("\n").length;
  for (let i = 0; i < hits.length; i++) {
    const h = hits[i]!;
    const snippet = h.text.replace(/\s+/g, " ").trim().slice(0, 280);
    const block = [
      `[${i + 1}] id=${h.driveFileId} name=${h.name}`,
      h.folderLabel ? `folder=${h.folderLabel}` : null,
      h.archiveCategory != null ? `cat=${h.archiveCategory}` : null,
      `snippet: ${snippet}`,
    ]
      .filter(Boolean)
      .join(" | ");
    if (used + block.length + 1 > budget) break;
    lines.push(block);
    used += block.length + 1;
  }

  return lines.join("\n").slice(0, budget);
}

export async function buildKnowledgeInjection(opts: {
  profileId: string | null | undefined;
  query: string;
  charBudget?: number;
  topK?: number;
}): Promise<string> {
  if (!opts.profileId) return "";
  try {
    const stats = getKnowledgeStats(opts.profileId);
    if (stats.fileCount === 0) return "";
    const hits = await retrieveDriveKnowledge({
      profileId: opts.profileId,
      query: opts.query,
      topK: opts.topK,
    });
    const namingMuscle = formatNamingMuscle(readTerminology(opts.profileId), 500);
    return formatKnowledgePromptBlock(hits, {
      charBudget: opts.charBudget,
      namingMuscle: namingMuscle || null,
    });
  } catch {
    return "";
  }
}
