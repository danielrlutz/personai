/**
 * Per-profile Google Drive OAuth tokens — sealed at rest (AES-GCM with host vault key).
 * Legacy plaintext drive-oauth.json is migrated on first read, then removed.
 */
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { profileDir, config } from "../config.js";

export type DriveOauthStore = {
  refreshToken: string;
  accessToken?: string | null;
  accessExpiresAt?: number | null;
  rootFolderId?: string | null;
  email?: string | null;
  linkedAt: string;
  updatedAt: string;
};

export type OauthPending = {
  profileId: string;
  createdAt: number;
  returnTo: string;
};

const pendingByState = new Map<string, OauthPending>();
const PENDING_TTL_MS = 15 * 60 * 1000;
const ALGO = "aes-256-gcm";
const IV_LEN = 12;

function legacyPath(profileId: string): string {
  return path.join(profileDir(profileId), "drive-oauth.json");
}

function sealedPath(profileId: string): string {
  return path.join(profileDir(profileId), "drive-oauth.enc");
}

function hostVaultKeyPath(): string {
  return path.join(config.dataDir, ".host-vault.key");
}

function ensureSealKey(): Buffer {
  const kp = hostVaultKeyPath();
  if (fs.existsSync(kp)) {
    return Buffer.from(fs.readFileSync(kp, "utf-8").trim(), "hex");
  }
  fs.mkdirSync(config.dataDir, { recursive: true });
  const key = randomBytes(32);
  fs.writeFileSync(kp, key.toString("hex"), { encoding: "utf-8", mode: 0o600 });
  try {
    fs.chmodSync(kp, 0o600);
  } catch {
    /* windows */
  }
  return key;
}

function encryptStore(data: DriveOauthStore, key: Buffer): Buffer {
  const iv = randomBytes(IV_LEN);
  const cipher = createCipheriv(ALGO, key, iv);
  const plaintext = Buffer.from(JSON.stringify(data), "utf-8");
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([Buffer.from("PAO1"), Buffer.from([1]), iv, tag, ciphertext]);
}

function decryptStore(blob: Buffer, key: Buffer): DriveOauthStore {
  if (blob.subarray(0, 4).toString("utf8") !== "PAO1") throw new Error("Not sealed oauth");
  const iv = blob.subarray(5, 5 + IV_LEN);
  const tag = blob.subarray(5 + IV_LEN, 5 + IV_LEN + 16);
  const ciphertext = blob.subarray(5 + IV_LEN + 16);
  const decipher = createDecipheriv(ALGO, key, iv);
  decipher.setAuthTag(tag);
  const plain = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  return JSON.parse(plain.toString("utf-8")) as DriveOauthStore;
}

export function readDriveOauthStore(profileId: string): DriveOauthStore | null {
  const sealed = sealedPath(profileId);
  const key = ensureSealKey();
  if (fs.existsSync(sealed)) {
    try {
      return decryptStore(fs.readFileSync(sealed), key);
    } catch {
      return null;
    }
  }
  // Migrate legacy plaintext once
  const legacy = legacyPath(profileId);
  if (fs.existsSync(legacy)) {
    try {
      const raw = JSON.parse(fs.readFileSync(legacy, "utf-8")) as DriveOauthStore;
      if (raw?.refreshToken) {
        writeDriveOauthStore(profileId, raw);
        try {
          fs.unlinkSync(legacy);
        } catch {
          /* ignore */
        }
        return raw;
      }
    } catch {
      return null;
    }
  }
  return null;
}

export function writeDriveOauthStore(profileId: string, data: DriveOauthStore): void {
  const dir = profileDir(profileId);
  fs.mkdirSync(dir, { recursive: true });
  const next: DriveOauthStore = {
    ...data,
    updatedAt: new Date().toISOString(),
  };
  const key = ensureSealKey();
  fs.writeFileSync(sealedPath(profileId), encryptStore(next, key), { mode: 0o600 });
  const legacy = legacyPath(profileId);
  if (fs.existsSync(legacy)) {
    try {
      fs.unlinkSync(legacy);
    } catch {
      /* ignore */
    }
  }
}

export function clearDriveOauthStore(profileId: string): void {
  for (const p of [sealedPath(profileId), legacyPath(profileId)]) {
    if (fs.existsSync(p)) fs.unlinkSync(p);
  }
}

export function createOauthPending(profileId: string, returnTo: string): string {
  prunePending();
  const state = crypto.randomBytes(24).toString("hex");
  pendingByState.set(state, { profileId, createdAt: Date.now(), returnTo });
  return state;
}

export function consumeOauthPending(state: string): OauthPending | null {
  prunePending();
  const row = pendingByState.get(state);
  if (!row) return null;
  pendingByState.delete(state);
  return row;
}

function prunePending(): void {
  const now = Date.now();
  for (const [k, v] of pendingByState) {
    if (now - v.createdAt > PENDING_TTL_MS) pendingByState.delete(k);
  }
}

export type DriveFolderMatchMeta = {
  source: "cache" | "regex" | "synonym" | "exact" | "reconcile" | "llm" | "created";
  matchedName?: string | null;
  duplicates?: Array<{ id: string; name: string }>;
  at: string;
};

export type DrivePrefsStore = {
  rootFolderId?: string | null;
  /** Cached taxonomy → Drive folder id (avoids re-LLM / re-list every upload). */
  folderIds?: Record<number, string>;
  folderMatchMeta?: Record<number, DriveFolderMatchMeta>;
  updatedAt: string;
};

function prefsPath(profileId: string): string {
  return path.join(profileDir(profileId), "drive-prefs.json");
}

export function readDrivePrefs(profileId: string): DrivePrefsStore | null {
  const p = prefsPath(profileId);
  if (!fs.existsSync(p)) return null;
  try {
    return JSON.parse(fs.readFileSync(p, "utf-8")) as DrivePrefsStore;
  } catch {
    return null;
  }
}

export function writeDrivePrefs(
  profileId: string,
  prefs: {
    rootFolderId?: string | null;
    folderIds?: Record<number, string>;
    folderMatchMeta?: Record<number, DriveFolderMatchMeta>;
  },
): DrivePrefsStore {
  const prev = readDrivePrefs(profileId);
  const next: DrivePrefsStore = {
    rootFolderId:
      prefs.rootFolderId !== undefined ? prefs.rootFolderId : (prev?.rootFolderId ?? null),
    folderIds: prefs.folderIds !== undefined ? prefs.folderIds : (prev?.folderIds ?? {}),
    folderMatchMeta:
      prefs.folderMatchMeta !== undefined
        ? prefs.folderMatchMeta
        : (prev?.folderMatchMeta ?? {}),
    updatedAt: new Date().toISOString(),
  };
  fs.mkdirSync(profileDir(profileId), { recursive: true });
  fs.writeFileSync(prefsPath(profileId), JSON.stringify(next, null, 2), "utf-8");
  return next;
}

/** Persist a single category → folder mapping (regex/LLM/created). */
export function cacheDriveFolderMapping(
  profileId: string,
  category: number,
  folderId: string,
  meta: Omit<DriveFolderMatchMeta, "at">,
): void {
  const prev = readDrivePrefs(profileId) ?? { updatedAt: new Date().toISOString() };
  const folderIds = { ...(prev.folderIds ?? {}), [category]: folderId };
  const folderMatchMeta = {
    ...(prev.folderMatchMeta ?? {}),
    [category]: { ...meta, at: new Date().toISOString() },
  };
  writeDrivePrefs(profileId, {
    rootFolderId: prev.rootFolderId ?? null,
    folderIds,
    folderMatchMeta,
  });
}
