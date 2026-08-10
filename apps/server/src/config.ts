import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "../../..");

// Load apps/server/.env and repo root .env without extra deps
for (const candidate of [
  path.resolve(__dirname, "../.env"),
  path.resolve(repoRoot, ".env"),
]) {
  if (!fs.existsSync(candidate)) continue;
  for (const line of fs.readFileSync(candidate, "utf-8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    const value = trimmed.slice(eq + 1).trim().replace(/^["']|["']$/g, "");
    if (!(key in process.env)) process.env[key] = value;
  }
}

export const config = {
  port: Number(process.env.PORT ?? 4000),
  dataDir: path.resolve(process.env.DATA_DIR ?? path.join(repoRoot, "data")),
  ollamaHost: process.env.OLLAMA_HOST ?? "http://127.0.0.1:11434",
  /** Defaults match models already pulled on Daniel's host — see model-catalog.ts */
  visionModel: process.env.OLLAMA_VISION_MODEL ?? "maternion/LightOnOCR-2:latest",
  reasoningModel: process.env.OLLAMA_REASONING_MODEL ?? "deepseek-r1:8b",
  architectModel: process.env.OLLAMA_ARCHITECT_MODEL ?? "deepseek-r1:14b",
  /** Forge: prefer instruct-q5 tag, failover to qwen2.5-coder:14b then deepseek-r1:8b */
  coderModel:
    process.env.OLLAMA_CODER_MODEL ?? "qwen2.5-coder:14b-instruct-q5_K_M",
  coachingModel: process.env.OLLAMA_COACHING_MODEL ?? "llama3.1:8b",
  stylistModel: process.env.OLLAMA_STYLIST_MODEL ?? "gemma4:e4b",
  qaModel: process.env.OLLAMA_QA_MODEL ?? "deepseek-r1:8b",
  /** Confirm closer-inspection refine (vault `reinspectModel`; default architect-class 14b). */
  reinspectModel: process.env.OLLAMA_REINSPECT_MODEL ?? "deepseek-r1:14b",
  licenseTier: (process.env.LICENSE_TIER ?? "pro") as "core" | "pro",
  keepAlive: "0",
  /** Soul News sidecar base URL (no trailing slash). Proxied at GET /integrations/soul-news/feed */
  soulNewsUrl: (process.env.SOUL_NEWS_URL ?? "http://127.0.0.1:8787").replace(/\/$/, ""),
};

export function profilesDir(): string {
  return path.join(config.dataDir, "profiles");
}

export function profileDir(profileId: string): string {
  return path.join(profilesDir(), profileId);
}

export function profileDbPath(profileId: string): string {
  return path.join(profileDir(profileId), "personai.db");
}

export function profileUploadsDir(profileId: string): string {
  return path.join(profileDir(profileId), "uploads");
}

export function profileExportsDir(profileId: string): string {
  return path.join(profileDir(profileId), "exports");
}

export function profileArchiveDir(profileId: string): string {
  return path.join(profileDir(profileId), "archive");
}

/** OpenClaw-style personality staging markdown (USER.md, SOUL.md, …). */
export function profileMemoryDir(profileId: string): string {
  return path.join(profileDir(profileId), "memory");
}

export function registryPath(): string {
  return path.join(config.dataDir, "profiles.json");
}
