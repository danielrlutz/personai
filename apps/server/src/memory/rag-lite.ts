import type { PrismaClient } from "@prisma/client";
import { listStagingDocs, type StagingDocId } from "./staging.js";

export type MemorySnippet = {
  source: "fact" | "staging";
  ref: string;
  label: string;
  text: string;
  score: number;
};

const STOP = new Set([
  "a", "an", "the", "and", "or", "to", "of", "in", "on", "for", "is", "are", "was", "with",
  "my", "me", "i", "ich", "und", "der", "die", "das", "ein", "eine", "mit", "für", "von",
  "zu", "im", "am",
]);

function tokenize(q: string): string[] {
  return q
    .toLowerCase()
    .split(/[^a-zà-öø-ÿ0-9äöüß]+/i)
    .map((t) => t.trim())
    .filter((t) => t.length >= 2 && !STOP.has(t));
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function scoreText(haystack: string, tokens: string[]): number {
  if (!tokens.length) return 0;
  const lower = haystack.toLowerCase();
  let score = 0;
  for (const t of tokens) {
    if (!lower.includes(t)) continue;
    score += t.length >= 5 ? 2 : 1;
    const re = new RegExp(`(?:^|[^a-z0-9])${escapeRe(t)}(?:[^a-z0-9]|$)`, "i");
    if (re.test(haystack)) score += 1;
  }
  return score;
}

function splitParagraphs(content: string): string[] {
  return content
    .split(/\n{2,}/)
    .map((p) => p.replace(/\s+/g, " ").trim())
    .filter((p) => p.length >= 16 && !/^#+\s/.test(p));
}

export type SearchMemoryOpts = {
  query: string;
  limit?: number;
  snippetChars?: number;
};

/**
 * RAG-lite: keyword retrieval over MemoryFacts + personality staging markdown.
 * Confirm-gated writes still apply for new facts (distill); this is read-only search.
 */
export async function searchMemorySnippets(
  prisma: PrismaClient,
  profileId: string,
  opts: SearchMemoryOpts,
): Promise<MemorySnippet[]> {
  const query = opts.query.trim();
  const limit = Math.min(20, Math.max(1, opts.limit ?? 8));
  const snippetChars = Math.min(600, Math.max(80, opts.snippetChars ?? 280));
  const tokens = tokenize(query);
  if (!tokens.length) return [];

  const candidates: MemorySnippet[] = [];

  const facts = await prisma.memoryFact.findMany({
    orderBy: { updatedAt: "desc" },
    take: 200,
  });
  for (const f of facts) {
    const score = scoreText(`${f.key} ${f.value}`, tokens);
    if (score <= 0) continue;
    candidates.push({
      source: "fact",
      ref: f.key,
      label: f.key,
      text: f.value.slice(0, snippetChars),
      score: score + 0.25,
    });
  }

  const docs = await listStagingDocs(profileId);
  for (const doc of docs) {
    if (!doc.hasSubstance) continue;
    const paras = splitParagraphs(doc.content);
    const pools = paras.length ? paras : [doc.content.trim().slice(0, snippetChars)];
    for (const para of pools) {
      const score = scoreText(`${doc.id} ${doc.filename} ${para}`, tokens);
      if (score <= 0) continue;
      candidates.push({
        source: "staging",
        ref: doc.id as StagingDocId,
        label: doc.filename,
        text: para.slice(0, snippetChars),
        score,
      });
    }
  }

  candidates.sort((a, b) => b.score - a.score || a.label.localeCompare(b.label));
  const seen = new Set<string>();
  const out: MemorySnippet[] = [];
  for (const c of candidates) {
    const key = `${c.source}:${c.ref}:${c.text.slice(0, 48)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(c);
    if (out.length >= limit) break;
  }
  return out;
}

export function formatSnippetsForPrompt(snippets: MemorySnippet[], maxChars = 1200): string {
  if (!snippets.length) return "";
  const lines = snippets.map(
    (s) => `- (${s.source}:${s.label}) ${s.text.replace(/\s+/g, " ").trim()}`,
  );
  let block = `Known prefs / memory snippets (use when relevant; do not invent):\n${lines.join("\n")}`;
  if (block.length > maxChars) block = `${block.slice(0, maxChars - 1)}…`;
  return block;
}
