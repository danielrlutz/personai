import path from "node:path";
import { fileURLToPath } from "node:url";

function envInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) ? n : fallback;
}

function envStr(name: string, fallback = ""): string {
  return (process.env[name] ?? fallback).trim();
}

function envBool(name: string, fallback: boolean): boolean {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return fallback;
  const v = raw.trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(v)) return true;
  if (["0", "false", "no", "off"].includes(v)) return false;
  return fallback;
}

const dataDir = path.resolve(envStr("DATA_DIR", "./data/agent-debug"));

/** Prefer AGENT_DEBUG_REPO_PATH; else walk up from this package toward monorepo root. */
function resolveRepoPath(): string {
  const fromEnv = envStr("AGENT_DEBUG_REPO_PATH");
  if (fromEnv) return path.resolve(fromEnv);
  const here = path.dirname(fileURLToPath(import.meta.url));
  // src/ → apps/agent-debug → apps → repo root
  return path.resolve(here, "../../..");
}

export const config = {
  port: envInt("PORT", 8790),
  host: envStr("HOST", "0.0.0.0"),
  dataDir,
  uploadsDir: path.join(dataDir, "uploads"),
  thumbsDir: path.join(dataDir, "thumbs"),
  storePath: path.join(dataDir, "store.json"),
  archivePath: path.join(dataDir, "archive.json"),
  token: envStr("AGENT_DEBUG_TOKEN"),
  ollamaHost: envStr("OLLAMA_HOST", "http://127.0.0.1:11434").replace(/\/$/, ""),
  composeModel: envStr("AGENT_DEBUG_COMPOSE_MODEL", "llama3:latest"),
  visionModel:
    envStr("AGENT_DEBUG_VISION_MODEL") ||
    envStr("OLLAMA_VISION_MODEL", "maternion/LightOnOCR-2"),
  batchTimeoutMs: envInt("AGENT_DEBUG_BATCH_TIMEOUT_MS", 90_000),
  workerMs: envInt("AGENT_DEBUG_WORKER_MS", 2_000),
  contextHint: envStr("AGENT_DEBUG_CONTEXT_HINT"),
  vpsHost: envStr("AGENT_DEBUG_VPS_HOST"),
  profileHint: envStr("AGENT_DEBUG_PROFILE_HINT"),
  baseUrl: envStr("AGENT_DEBUG_URL", "http://127.0.0.1:8790").replace(/\/$/, ""),
  repoPath: resolveRepoPath(),
  /** Optional — server runs without this; SDK dispatch becomes a no-op. */
  cursorApiKey: envStr("CURSOR_API_KEY"),
  cursorModel: envStr("CURSOR_MODEL", "composer-2.5"),
  /** Text-only batches at or below this length skip Ollama compose (0 = never skip). */
  composeSkipThresholdChars: envInt("COMPOSE_SKIP_THRESHOLD_CHARS", 120),
  /** Trim compose system prompt; static PersonAI context moves to user prompt block. */
  composeMinimalMode: envBool("COMPOSE_MINIMAL_MODE", true),
};
