/**
 * Host-level product settings vault (Settings-first — no user .env for product config).
 * AES-256-GCM at rest under DATA_DIR; key file is local-only (never committed).
 * Env vars remain bootstrap fallbacks for Docker ports / first boot only.
 */
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { config } from "../config.js";
import { KNOWN_MODELS } from "../specialists/model-catalog.js";

const ALGO = "aes-256-gcm";
const IV_LEN = 12;
const TAG_LEN = 16;

export type HostVaultData = {
  ollamaHost?: string | null;
  visionModel?: string | null;
  reasoningModel?: string | null;
  architectModel?: string | null;
  coderModel?: string | null;
  coachingModel?: string | null;
  stylistModel?: string | null;
  qaModel?: string | null;
  publicWebUrl?: string | null;
  publicApiUrl?: string | null;
  googleOauthClientId?: string | null;
  googleOauthClientSecret?: string | null;
  googleOauthRedirectUri?: string | null;
  googleDriveRootFolderId?: string | null;
  googleDriveFolderIds?: Record<string, string> | null;
  googleServiceAccountJson?: string | null;
  premiumApiKey?: string | null;
  premiumProvider?: string | null;
  premiumMonthlyQuota?: number | null;
  notificationsEnabled?: boolean | null;
  updatedAt?: string;
};

function vaultDir(): string {
  return config.dataDir;
}

function keyPath(): string {
  return path.join(vaultDir(), ".host-vault.key");
}

function encPath(): string {
  return path.join(vaultDir(), "host-vault.enc");
}

function ensureKey(): Buffer {
  const kp = keyPath();
  if (fs.existsSync(kp)) {
    return Buffer.from(fs.readFileSync(kp, "utf-8").trim(), "hex");
  }
  fs.mkdirSync(vaultDir(), { recursive: true });
  const key = randomBytes(32);
  fs.writeFileSync(kp, key.toString("hex"), { encoding: "utf-8", mode: 0o600 });
  try {
    fs.chmodSync(kp, 0o600);
  } catch {
    // Windows may ignore mode
  }
  return key;
}

function encryptJson(data: HostVaultData, key: Buffer): Buffer {
  const iv = randomBytes(IV_LEN);
  const cipher = createCipheriv(ALGO, key, iv);
  const plaintext = Buffer.from(JSON.stringify(data), "utf-8");
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([Buffer.from("PAHV"), Buffer.from([1]), iv, tag, ciphertext]);
}

function decryptJson(blob: Buffer, key: Buffer): HostVaultData {
  if (blob.length < 4 + 1 + IV_LEN + TAG_LEN + 1) throw new Error("Vault truncated");
  if (blob.subarray(0, 4).toString("utf8") !== "PAHV") throw new Error("Not a host vault");
  if (blob[4] !== 1) throw new Error("Unsupported vault version");
  const iv = blob.subarray(5, 5 + IV_LEN);
  const tag = blob.subarray(5 + IV_LEN, 5 + IV_LEN + TAG_LEN);
  const ciphertext = blob.subarray(5 + IV_LEN + TAG_LEN);
  const decipher = createDecipheriv(ALGO, key, iv);
  decipher.setAuthTag(tag);
  const plain = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  return JSON.parse(plain.toString("utf-8")) as HostVaultData;
}

let cache: HostVaultData | null = null;

export function readHostVault(): HostVaultData {
  if (cache) return cache;
  const p = encPath();
  if (!fs.existsSync(p)) {
    cache = {};
    return cache;
  }
  try {
    cache = decryptJson(fs.readFileSync(p), ensureKey());
    return cache;
  } catch {
    cache = {};
    return cache;
  }
}

export async function writeHostVault(patch: Partial<HostVaultData>): Promise<HostVaultData> {
  const prev = readHostVault();
  const next: HostVaultData = {
    ...prev,
    ...sanitizePatch(patch),
    updatedAt: new Date().toISOString(),
  };
  // Empty string clears optional secrets
  for (const key of Object.keys(patch) as (keyof HostVaultData)[]) {
    const v = patch[key];
    if (v === "" || v === null) {
      (next as Record<string, unknown>)[key] = null;
    }
  }
  fs.mkdirSync(vaultDir(), { recursive: true });
  await fsp.writeFile(encPath(), encryptJson(next, ensureKey()), { mode: 0o600 });
  cache = next;
  return next;
}

function sanitizePatch(patch: Partial<HostVaultData>): Partial<HostVaultData> {
  const out: Partial<HostVaultData> = { ...patch };
  if (typeof out.ollamaHost === "string") out.ollamaHost = out.ollamaHost.trim().replace(/\/$/, "");
  if (typeof out.publicWebUrl === "string") out.publicWebUrl = out.publicWebUrl.trim().replace(/\/$/, "");
  if (typeof out.publicApiUrl === "string") out.publicApiUrl = out.publicApiUrl.trim().replace(/\/$/, "");
  return out;
}

export function maskSecret(value: string | null | undefined): string | null {
  if (!value) return null;
  if (value.length <= 4) return "••••";
  return `••••${value.slice(-4)}`;
}

export type PublicHostSettings = {
  ollamaHost: string | null;
  visionModel: string | null;
  reasoningModel: string | null;
  architectModel: string | null;
  coderModel: string | null;
  coachingModel: string | null;
  stylistModel: string | null;
  qaModel: string | null;
  suggestedModels: string[];
  publicWebUrl: string | null;
  publicApiUrl: string | null;
  googleOauthClientId: string | null;
  googleOauthClientSecretSet: boolean;
  googleOauthClientSecretMasked: string | null;
  googleOauthRedirectUri: string | null;
  googleDriveRootFolderId: string | null;
  googleDriveFolderIds: Record<string, string>;
  googleServiceAccountJsonSet: boolean;
  premiumApiKeySet: boolean;
  premiumApiKeyMasked: string | null;
  premiumProvider: string | null;
  premiumMonthlyQuota: number;
  notificationsEnabled: boolean;
  source: {
    ollamaHost: "vault" | "env" | "default";
    googleOauth: "vault" | "env" | "none";
  };
  updatedAt: string | null;
};

/** Resolve effective values: vault wins over env bootstrap. */
export function resolveProductConfig(): {
  ollamaHost: string;
  visionModel: string;
  reasoningModel: string;
  architectModel: string;
  coderModel: string;
  coachingModel: string;
  stylistModel: string;
  qaModel: string;
  publicWebUrl: string;
  publicApiUrl: string | null;
  googleOauthClientId: string | null;
  googleOauthClientSecret: string | null;
  googleOauthRedirectUri: string | null;
  googleDriveRootFolderId: string | null;
  googleDriveFolderIds: Record<number, string>;
  googleServiceAccountJson: string | null;
  premiumApiKey: string | null;
  premiumProvider: string;
  premiumMonthlyQuota: number;
} {
  const v = readHostVault();
  const folderIds: Record<number, string> = {};
  const fromVault = v.googleDriveFolderIds ?? {};
  for (const [k, val] of Object.entries(fromVault)) {
    const n = Number(k);
    if (Number.isFinite(n) && val) folderIds[n] = String(val).trim();
  }
  // env taxonomy as bootstrap only when vault empty
  if (Object.keys(folderIds).length === 0) {
    const jsonMap = process.env.GOOGLE_DRIVE_FOLDERS?.trim();
    if (jsonMap) {
      try {
        const parsed = JSON.parse(jsonMap) as Record<string, string>;
        for (const [k, val] of Object.entries(parsed)) {
          const n = Number(k);
          if (Number.isFinite(n) && val) folderIds[n] = String(val).trim();
        }
      } catch {
        /* ignore */
      }
    }
    for (let i = 1; i <= 10; i++) {
      const envVal = process.env[`GOOGLE_DRIVE_FOLDER_${i}`]?.trim();
      if (envVal) folderIds[i] = envVal;
    }
  }

  const oauthId = v.googleOauthClientId?.trim() || process.env.GOOGLE_OAUTH_CLIENT_ID?.trim() || null;
  const oauthSecret =
    v.googleOauthClientSecret?.trim() || process.env.GOOGLE_OAUTH_CLIENT_SECRET?.trim() || null;

  return {
    ollamaHost: (v.ollamaHost || process.env.OLLAMA_HOST || config.ollamaHost).replace(/\/$/, ""),
    visionModel: v.visionModel || process.env.OLLAMA_VISION_MODEL || config.visionModel,
    reasoningModel: v.reasoningModel || process.env.OLLAMA_REASONING_MODEL || config.reasoningModel,
    architectModel: v.architectModel || process.env.OLLAMA_ARCHITECT_MODEL || config.architectModel,
    coderModel: v.coderModel || process.env.OLLAMA_CODER_MODEL || config.coderModel,
    coachingModel: v.coachingModel || process.env.OLLAMA_COACHING_MODEL || config.coachingModel,
    stylistModel: v.stylistModel || process.env.OLLAMA_STYLIST_MODEL || config.stylistModel,
    qaModel: v.qaModel || process.env.OLLAMA_QA_MODEL || config.qaModel,
    publicWebUrl: (
      v.publicWebUrl ||
      process.env.PUBLIC_WEB_URL ||
      process.env.WEB_APP_URL ||
      "http://127.0.0.1:3000"
    ).replace(/\/$/, ""),
    publicApiUrl: (v.publicApiUrl || process.env.PUBLIC_API_URL || process.env.NEXT_PUBLIC_API_URL || null)?.replace(
      /\/$/,
      "",
    ) ?? null,
    googleOauthClientId: oauthId,
    googleOauthClientSecret: oauthSecret,
    googleOauthRedirectUri:
      v.googleOauthRedirectUri?.trim() || process.env.GOOGLE_OAUTH_REDIRECT_URI?.trim() || null,
    googleDriveRootFolderId:
      v.googleDriveRootFolderId?.trim() || process.env.GOOGLE_DRIVE_ROOT_FOLDER_ID?.trim() || null,
    googleDriveFolderIds: folderIds,
    googleServiceAccountJson:
      v.googleServiceAccountJson?.trim() ||
      process.env.GOOGLE_SERVICE_ACCOUNT_JSON_INLINE?.trim() ||
      null,
    premiumApiKey: v.premiumApiKey?.trim() || process.env.PREMIUM_API_KEY?.trim() || null,
    premiumProvider: v.premiumProvider || process.env.PREMIUM_PROVIDER || "cloud-optional",
    premiumMonthlyQuota: v.premiumMonthlyQuota ?? Number(process.env.PREMIUM_MONTHLY_QUOTA ?? 20),
  };
}

export function toPublicHostSettings(): PublicHostSettings {
  const v = readHostVault();
  const resolved = resolveProductConfig();
  const vaultHasOauth = Boolean(v.googleOauthClientId && v.googleOauthClientSecret);
  const envHasOauth = Boolean(
    process.env.GOOGLE_OAUTH_CLIENT_ID?.trim() && process.env.GOOGLE_OAUTH_CLIENT_SECRET?.trim(),
  );
  return {
    ollamaHost: resolved.ollamaHost,
    visionModel: resolved.visionModel,
    reasoningModel: resolved.reasoningModel,
    architectModel: resolved.architectModel,
    coderModel: resolved.coderModel,
    coachingModel: resolved.coachingModel,
    stylistModel: resolved.stylistModel,
    qaModel: resolved.qaModel,
    suggestedModels: [...KNOWN_MODELS],
    publicWebUrl: resolved.publicWebUrl,
    publicApiUrl: resolved.publicApiUrl,
    googleOauthClientId: resolved.googleOauthClientId,
    googleOauthClientSecretSet: Boolean(resolved.googleOauthClientSecret),
    googleOauthClientSecretMasked: maskSecret(resolved.googleOauthClientSecret),
    googleOauthRedirectUri: resolved.googleOauthRedirectUri,
    googleDriveRootFolderId: resolved.googleDriveRootFolderId,
    googleDriveFolderIds: Object.fromEntries(
      Object.entries(resolved.googleDriveFolderIds).map(([k, val]) => [String(k), val]),
    ),
    googleServiceAccountJsonSet: Boolean(resolved.googleServiceAccountJson),
    premiumApiKeySet: Boolean(resolved.premiumApiKey),
    premiumApiKeyMasked: maskSecret(resolved.premiumApiKey),
    premiumProvider: resolved.premiumProvider,
    premiumMonthlyQuota: resolved.premiumMonthlyQuota,
    notificationsEnabled: Boolean(v.notificationsEnabled),
    source: {
      ollamaHost: v.ollamaHost ? "vault" : process.env.OLLAMA_HOST ? "env" : "default",
      googleOauth: vaultHasOauth ? "vault" : envHasOauth ? "env" : "none",
    },
    updatedAt: v.updatedAt ?? null,
  };
}
