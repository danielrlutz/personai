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
  visionModel: process.env.OLLAMA_VISION_MODEL ?? "maternion/LightOnOCR-2",
  reasoningModel: process.env.OLLAMA_REASONING_MODEL ?? "deepseek-r1:8b",
  licenseTier: (process.env.LICENSE_TIER ?? "pro") as "core" | "pro",
  keepAlive: "0",
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

export function registryPath(): string {
  return path.join(config.dataDir, "profiles.json");
}
