import { PrismaClient } from "@prisma/client";
import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import {
  profileArchiveDir,
  profileDbPath,
  profileDir,
  profileExportsDir,
  profileUploadsDir,
} from "../config.js";

let activeClient: PrismaClient | null = null;
let activeProfileId: string | null = null;

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const schemaPath = path.resolve(__dirname, "../../prisma/schema.prisma");

function ensureProfileDirs(profileId: string): void {
  fs.mkdirSync(profileDir(profileId), { recursive: true });
  fs.mkdirSync(profileUploadsDir(profileId), { recursive: true });
  fs.mkdirSync(profileExportsDir(profileId), { recursive: true });
  fs.mkdirSync(profileArchiveDir(profileId), { recursive: true });
}

function ensureDatabase(profileId: string): void {
  ensureProfileDirs(profileId);
  const dbPath = profileDbPath(profileId);
  // Always push so existing profiles pick up new models (e.g. Personal manners / Life).
  const url = `file:${dbPath}`;
  const cwd = path.resolve(__dirname, "../..");
  // Prefer the image-local CLI (prod Docker ships prisma as a dependency). Never bare
  // `npx prisma` — that can download a newer CLI that dropped --skip-generate.
  const localBin = path.join(cwd, "node_modules", ".bin", "prisma");
  const cli = fs.existsSync(localBin) ? `"${localBin}"` : "npx --no-install prisma";
  execSync(`${cli} db push --schema "${schemaPath}" --skip-generate`, {
    env: { ...process.env, DATABASE_URL: url },
    stdio: "pipe",
    cwd,
  });
}

export async function getPrisma(profileId: string): Promise<PrismaClient> {
  if (activeProfileId === profileId && activeClient) {
    return activeClient;
  }

  if (activeClient) {
    await activeClient.$disconnect();
    activeClient = null;
    activeProfileId = null;
  }

  ensureDatabase(profileId);
  const dbPath = profileDbPath(profileId);
  const url = `file:${dbPath}`;

  activeClient = new PrismaClient({
    datasources: { db: { url } },
  });
  activeProfileId = profileId;

  await seedDefaults(activeClient);
  return activeClient;
}

/** Settings + empty budget category templates only — never invents user content. */
async function seedDefaults(client: PrismaClient): Promise<void> {
  const defaults: Record<string, string> = {
    "ollama.visionModel": "maternion/LightOnOCR-2",
    "ollama.reasoningModel": "deepseek-r1:8b",
    "ollama.keepAlive": "0",
    "briefing.preferredTime": "07:00",
    "briefing.locale": "de-CH",
  };

  for (const [key, value] of Object.entries(defaults)) {
    await client.setting.upsert({
      where: { key },
      create: { key, value },
      update: {},
    });
  }

  // Empty category shells only — null limits so UI never shows fake "budget remaining".
  const catCount = await client.budgetCategory.count();
  if (catCount === 0) {
    await client.budgetCategory.createMany({
      data: [
        { name: "Betriebskosten", monthlyLimit: null, color: "#14b8a6" },
        { name: "Leben", monthlyLimit: null, color: "#6366f1" },
        { name: "Steuern/AHV", monthlyLimit: null, color: "#f59e0b" },
        { name: "Gesundheit", monthlyLimit: null, color: "#ef4444" },
      ],
    });
  } else {
    // Clear classic seed limits (name+amount) that looked like live budget data.
    const seedLimits: Array<{ name: string; monthlyLimit: number }> = [
      { name: "Betriebskosten", monthlyLimit: 1500 },
      { name: "Leben", monthlyLimit: 2000 },
      { name: "Steuern/AHV", monthlyLimit: 800 },
      { name: "Gesundheit", monthlyLimit: 400 },
    ];
    for (const seed of seedLimits) {
      await client.budgetCategory.updateMany({
        where: seed,
        data: { monthlyLimit: null },
      });
    }
  }

  await client.ceoProfile.upsert({
    where: { id: "default" },
    create: { id: "default" },
    update: {},
  });
}

export function getActiveProfileId(): string | null {
  return activeProfileId;
}

export async function shutdownPrisma(): Promise<void> {
  if (activeClient) {
    await activeClient.$disconnect();
    activeClient = null;
    activeProfileId = null;
  }
}
