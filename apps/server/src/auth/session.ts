import fs from "node:fs";
import path from "node:path";
import { randomBytes } from "node:crypto";
import { config } from "../config.js";
import { sha256Hex } from "./password.js";

export type SessionRecord = {
  tokenHash: string;
  profileId: string;
  createdAt: string;
  expiresAt: string;
};

type SessionFile = {
  sessions: SessionRecord[];
};

const DEFAULT_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

function sessionsPath(): string {
  return path.join(config.dataDir, "sessions.json");
}

function load(): SessionFile {
  fs.mkdirSync(config.dataDir, { recursive: true });
  const p = sessionsPath();
  if (!fs.existsSync(p)) return { sessions: [] };
  try {
    const raw = JSON.parse(fs.readFileSync(p, "utf-8")) as SessionFile;
    if (!raw || !Array.isArray(raw.sessions)) return { sessions: [] };
    return raw;
  } catch {
    return { sessions: [] };
  }
}

function save(file: SessionFile): void {
  fs.writeFileSync(sessionsPath(), JSON.stringify(file, null, 2), "utf-8");
}

function purgeExpired(file: SessionFile): SessionFile {
  const now = Date.now();
  return {
    sessions: file.sessions.filter((s) => Date.parse(s.expiresAt) > now),
  };
}

export function createSession(profileId: string, ttlMs = DEFAULT_TTL_MS): string {
  const token = randomBytes(32).toString("base64url");
  const tokenHash = sha256Hex(token);
  const now = new Date();
  const expires = new Date(now.getTime() + ttlMs);
  let file = purgeExpired(load());
  file.sessions.push({
    tokenHash,
    profileId,
    createdAt: now.toISOString(),
    expiresAt: expires.toISOString(),
  });
  save(file);
  return token;
}

export function resolveSession(token: string | undefined | null): SessionRecord | null {
  if (!token) return null;
  const tokenHash = sha256Hex(token);
  const before = load();
  const file = purgeExpired(before);
  if (file.sessions.length !== before.sessions.length) {
    save(file);
  }
  return file.sessions.find((s) => s.tokenHash === tokenHash) ?? null;
}

export function revokeSession(token: string | undefined | null): void {
  if (!token) return;
  const tokenHash = sha256Hex(token);
  const file = load();
  file.sessions = file.sessions.filter((s) => s.tokenHash !== tokenHash);
  save(file);
}

export function revokeAllSessionsForProfile(profileId: string): void {
  const file = load();
  file.sessions = file.sessions.filter((s) => s.profileId !== profileId);
  save(file);
}

export function countSessionsForProfile(profileId: string): number {
  const file = purgeExpired(load());
  return file.sessions.filter((s) => s.profileId === profileId).length;
}

export function extractBearerToken(authorization: string | string[] | undefined): string | null {
  const header = Array.isArray(authorization) ? authorization[0] : authorization;
  if (!header) return null;
  const m = /^Bearer\s+(.+)$/i.exec(header.trim());
  return m?.[1]?.trim() || null;
}
