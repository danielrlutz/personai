/**
 * Per-profile Google Drive OAuth tokens + root folder preference.
 * Client id/secret still come from env; refresh token is user-linked.
 */
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { profileDir } from "../config.js";

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

function storePath(profileId: string): string {
  return path.join(profileDir(profileId), "drive-oauth.json");
}

export function readDriveOauthStore(profileId: string): DriveOauthStore | null {
  const p = storePath(profileId);
  if (!fs.existsSync(p)) return null;
  try {
    const raw = JSON.parse(fs.readFileSync(p, "utf-8")) as DriveOauthStore;
    if (!raw?.refreshToken) return null;
    return raw;
  } catch {
    return null;
  }
}

export function writeDriveOauthStore(profileId: string, data: DriveOauthStore): void {
  const dir = profileDir(profileId);
  fs.mkdirSync(dir, { recursive: true });
  const next: DriveOauthStore = {
    ...data,
    updatedAt: new Date().toISOString(),
  };
  fs.writeFileSync(storePath(profileId), JSON.stringify(next, null, 2), "utf-8");
}

export function clearDriveOauthStore(profileId: string): void {
  const p = storePath(profileId);
  if (fs.existsSync(p)) fs.unlinkSync(p);
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

/** Separate tiny store for SA/root folder override when using service account. */
export type DrivePrefsStore = {
  rootFolderId?: string | null;
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

export function writeDrivePrefs(profileId: string, prefs: { rootFolderId?: string | null }): DrivePrefsStore {
  const next: DrivePrefsStore = {
    rootFolderId: prefs.rootFolderId ?? null,
    updatedAt: new Date().toISOString(),
  };
  fs.mkdirSync(profileDir(profileId), { recursive: true });
  fs.writeFileSync(prefsPath(profileId), JSON.stringify(next, null, 2), "utf-8");
  return next;
}
