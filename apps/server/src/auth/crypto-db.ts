import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { bytesToHex, hexToBytes } from "@noble/hashes/utils.js";
import { profileDbPath, profileDir } from "../config.js";
import { deriveKek, newKdfSalt } from "./password.js";

const ALGO = "aes-256-gcm";
const IV_LEN = 12;
const TAG_LEN = 16;

/** In-memory DEKs for unlocked profiles (never written to disk). */
const unlockedKeys = new Map<string, Buffer>();

export type WrappedDek = {
  v: 1;
  alg: "aes-256-gcm";
  iv: string;
  tag: string;
  ciphertext: string;
};

export function profileEncDbPath(profileId: string): string {
  return path.join(profileDir(profileId), "personai.db.enc");
}

export function isProfileUnlocked(profileId: string): boolean {
  return unlockedKeys.has(profileId);
}

export function getUnlockedDek(profileId: string): Buffer | null {
  return unlockedKeys.get(profileId) ?? null;
}

export function clearUnlockedDek(profileId: string): void {
  unlockedKeys.delete(profileId);
}

export function clearAllUnlockedDeks(): void {
  unlockedKeys.clear();
}

function wrapDek(dek: Buffer, kek: Uint8Array): WrappedDek {
  const iv = randomBytes(IV_LEN);
  const cipher = createCipheriv(ALGO, Buffer.from(kek), iv);
  const ciphertext = Buffer.concat([cipher.update(dek), cipher.final()]);
  const tag = cipher.getAuthTag();
  return {
    v: 1,
    alg: "aes-256-gcm",
    iv: bytesToHex(iv),
    tag: bytesToHex(tag),
    ciphertext: bytesToHex(ciphertext),
  };
}

function unwrapDek(wrapped: WrappedDek | string, kek: Uint8Array): Buffer {
  const rec: WrappedDek = typeof wrapped === "string" ? JSON.parse(wrapped) : wrapped;
  if (rec.v !== 1 || rec.alg !== "aes-256-gcm") {
    throw new Error("Unsupported wrapped DEK format");
  }
  const decipher = createDecipheriv(ALGO, Buffer.from(kek), hexToBytes(rec.iv));
  decipher.setAuthTag(Buffer.from(hexToBytes(rec.tag)));
  return Buffer.concat([
    decipher.update(Buffer.from(hexToBytes(rec.ciphertext))),
    decipher.final(),
  ]);
}

function encryptBuffer(plaintext: Buffer, dek: Buffer): Buffer {
  const iv = randomBytes(IV_LEN);
  const cipher = createCipheriv(ALGO, dek, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();
  // layout: magic(4) | ver(1) | iv(12) | tag(16) | ciphertext
  const magic = Buffer.from("PAI1");
  return Buffer.concat([magic, Buffer.from([1]), iv, tag, ciphertext]);
}

function decryptBuffer(blob: Buffer, dek: Buffer): Buffer {
  if (blob.length < 4 + 1 + IV_LEN + TAG_LEN + 1) {
    throw new Error("Encrypted database is truncated");
  }
  const magic = blob.subarray(0, 4).toString("utf8");
  if (magic !== "PAI1") throw new Error("Not a PersonAI encrypted database");
  const ver = blob[4];
  if (ver !== 1) throw new Error(`Unsupported encryption version: ${ver}`);
  const iv = blob.subarray(5, 5 + IV_LEN);
  const tag = blob.subarray(5 + IV_LEN, 5 + IV_LEN + TAG_LEN);
  const ciphertext = blob.subarray(5 + IV_LEN + TAG_LEN);
  const decipher = createDecipheriv(ALGO, dek, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
}

async function removeSidecars(dbPath: string): Promise<void> {
  for (const suffix of ["-wal", "-shm", "-journal"]) {
    const p = `${dbPath}${suffix}`;
    if (fs.existsSync(p)) await fsp.unlink(p);
  }
}

/**
 * Create a new DEK, wrap with password-derived KEK, encrypt existing plaintext DB if present.
 * Returns fields to persist on the profile record.
 */
export async function enableEncryptionForProfile(
  profileId: string,
  password: string,
): Promise<{ kdfSalt: string; wrappedDek: string; dbEncrypted: boolean }> {
  const kdfSalt = newKdfSalt();
  const kek = await deriveKek(password, kdfSalt);
  const dek = randomBytes(32);
  const wrappedDek = JSON.stringify(wrapDek(dek, kek));

  const dbPath = profileDbPath(profileId);
  const encPath = profileEncDbPath(profileId);
  fs.mkdirSync(profileDir(profileId), { recursive: true });

  if (fs.existsSync(dbPath)) {
    const plaintext = await fsp.readFile(dbPath);
    const encrypted = encryptBuffer(plaintext, dek);
    await fsp.writeFile(encPath, encrypted);
    // Keep plaintext open for the active session; mark unlocked.
  } else if (!fs.existsSync(encPath)) {
    // Empty profile — encryption enabled; DB will be created then sealed on lock.
  }

  unlockedKeys.set(profileId, dek);
  return { kdfSalt, wrappedDek, dbEncrypted: fs.existsSync(encPath) };
}

/** Unlock: unwrap DEK, decrypt .enc → .db when needed. */
export async function unlockProfileDb(
  profileId: string,
  password: string,
  kdfSalt: string,
  wrappedDekJson: string,
): Promise<void> {
  const kek = await deriveKek(password, kdfSalt);
  const dek = unwrapDek(wrappedDekJson, kek);
  unlockedKeys.set(profileId, dek);

  const dbPath = profileDbPath(profileId);
  const encPath = profileEncDbPath(profileId);

  if (fs.existsSync(encPath)) {
    const blob = await fsp.readFile(encPath);
    const plaintext = decryptBuffer(blob, dek);
    await fsp.writeFile(dbPath, plaintext);
    await removeSidecars(dbPath);
  }
}

/**
 * Seal plaintext DB to .enc and delete plaintext (+ sidecars).
 * No-op if no DEK in memory (cannot encrypt without key).
 */
export async function lockProfileDb(profileId: string): Promise<boolean> {
  const dek = unlockedKeys.get(profileId);
  if (!dek) return false;

  const dbPath = profileDbPath(profileId);
  const encPath = profileEncDbPath(profileId);

  if (fs.existsSync(dbPath)) {
    // Checkpoint-ish: remove WAL so we encrypt a consistent main file when possible.
    await removeSidecars(dbPath);
    const plaintext = await fsp.readFile(dbPath);
    const encrypted = encryptBuffer(plaintext, dek);
    await fsp.writeFile(encPath, encrypted);
    await fsp.unlink(dbPath);
    await removeSidecars(dbPath);
  }

  unlockedKeys.delete(profileId);
  return true;
}

/** Re-wrap DEK under a new password (password change). */
export async function rewrapDek(
  profileId: string,
  currentPassword: string,
  newPassword: string,
  kdfSalt: string,
  wrappedDekJson: string,
): Promise<{ kdfSalt: string; wrappedDek: string }> {
  const oldKek = await deriveKek(currentPassword, kdfSalt);
  const dek = unwrapDek(wrappedDekJson, oldKek);
  const newSalt = newKdfSalt();
  const newKek = await deriveKek(newPassword, newSalt);
  const wrappedDek = JSON.stringify(wrapDek(dek, newKek));
  unlockedKeys.set(profileId, dek);
  return { kdfSalt: newSalt, wrappedDek };
}

export function dbLooksEncryptedOnDisk(profileId: string): boolean {
  return fs.existsSync(profileEncDbPath(profileId)) && !fs.existsSync(profileDbPath(profileId));
}

export function dbHasPlaintext(profileId: string): boolean {
  return fs.existsSync(profileDbPath(profileId));
}
