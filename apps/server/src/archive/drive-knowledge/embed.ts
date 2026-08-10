/**
 * Local Ollama embeddings for Drive knowledge. Keyword-only fallback when no embed model.
 */
import { listInstalledModels, resolveOllamaHost } from "../../ollama/client.js";

export const EMBED_MODEL_CANDIDATES = [
  "nomic-embed-text",
  "nomic-embed-text:latest",
  "mxbai-embed-large",
  "mxbai-embed-large:latest",
  "all-minilm",
  "all-minilm:latest",
  "snowflake-arctic-embed",
  "snowflake-arctic-embed:latest",
] as const;

function baseName(tag: string): string {
  return tag.split(":")[0]!.toLowerCase();
}

export function pickEmbedModel(installed: string[]): string | null {
  const clean = installed.map((n) => n.trim()).filter(Boolean);
  for (const candidate of EMBED_MODEL_CANDIDATES) {
    const hit = clean.find(
      (m) =>
        m === candidate ||
        m.toLowerCase() === candidate.toLowerCase() ||
        baseName(m) === baseName(candidate),
    );
    if (hit) return hit;
  }
  return clean.find((m) => /embed/i.test(m)) ?? null;
}

export async function resolveEmbedModel(host?: string): Promise<{
  host: string;
  model: string | null;
}> {
  const resolvedHost = host ?? (await resolveOllamaHost());
  try {
    const installed = await listInstalledModels(resolvedHost);
    return { host: resolvedHost, model: pickEmbedModel(installed) };
  } catch {
    return { host: resolvedHost, model: null };
  }
}

export async function embedTexts(opts: {
  host: string;
  model: string;
  texts: string[];
  timeoutMs?: number;
}): Promise<Float32Array[]> {
  const out: Float32Array[] = [];
  for (const text of opts.texts) {
    const res = await fetch(`${opts.host.replace(/\/$/, "")}/api/embeddings`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: opts.model,
        prompt: text.slice(0, 8000),
        keep_alive: 0,
      }),
      signal: AbortSignal.timeout(opts.timeoutMs ?? 60_000),
    });
    if (!res.ok) {
      throw new Error(
        `Ollama embeddings failed: ${res.status} ${await res.text()} (model=${opts.model})`,
      );
    }
    const data = (await res.json()) as { embedding?: number[] };
    if (!Array.isArray(data.embedding) || data.embedding.length === 0) {
      throw new Error(`Ollama embeddings returned empty vector (model=${opts.model})`);
    }
    out.push(Float32Array.from(data.embedding));
  }
  return out;
}

export function cosineSimilarity(a: Float32Array, b: Float32Array): number {
  const n = Math.min(a.length, b.length);
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < n; i++) {
    const x = a[i]!;
    const y = b[i]!;
    dot += x * y;
    na += x * x;
    nb += y * y;
  }
  return dot / (Math.sqrt(na) * Math.sqrt(nb) + 1e-9);
}
