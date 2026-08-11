import path from "node:path";

function envInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) ? n : fallback;
}

function envStr(name: string, fallback = ""): string {
  return (process.env[name] ?? fallback).trim();
}

const dataDir = path.resolve(envStr("DATA_DIR", "./data/agent-debug"));

export const config = {
  port: envInt("PORT", 8790),
  host: envStr("HOST", "0.0.0.0"),
  dataDir,
  uploadsDir: path.join(dataDir, "uploads"),
  thumbsDir: path.join(dataDir, "thumbs"),
  storePath: path.join(dataDir, "store.json"),
  token: envStr("AGENT_DEBUG_TOKEN"),
  ollamaHost: envStr("OLLAMA_HOST", "http://127.0.0.1:11434").replace(/\/$/, ""),
  composeModel: envStr("AGENT_DEBUG_COMPOSE_MODEL", "llama3.1:8b"),
  visionModel:
    envStr("AGENT_DEBUG_VISION_MODEL") ||
    envStr("OLLAMA_VISION_MODEL", "maternion/LightOnOCR-2"),
  batchTimeoutMs: envInt("AGENT_DEBUG_BATCH_TIMEOUT_MS", 90_000),
  workerMs: envInt("AGENT_DEBUG_WORKER_MS", 2_000),
  contextHint: envStr("AGENT_DEBUG_CONTEXT_HINT"),
  vpsHost: envStr("AGENT_DEBUG_VPS_HOST"),
  profileHint: envStr("AGENT_DEBUG_PROFILE_HINT"),
  baseUrl: envStr("AGENT_DEBUG_URL", "http://127.0.0.1:8790").replace(/\/$/, ""),
};

export function buildContextPreamble(): string {
  const lines: string[] = [
    "You are assisting via PersonAI OS agent-debug inbox (balcony / phone → Cursor).",
  ];
  if (config.profileHint) lines.push(`Profile hint: ${config.profileHint}`);
  if (config.vpsHost) lines.push(`VPS / Tailscale host: ${config.vpsHost}`);
  if (config.contextHint) lines.push(config.contextHint);
  lines.push(
    "Act on the user request below. Prefer local tools, MCP, and the PersonAI repo when relevant.",
  );
  return lines.join("\n");
}
