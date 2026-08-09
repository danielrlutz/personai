import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { argon2idAsync } from "@noble/hashes/argon2.js";
import { bytesToHex, hexToBytes, utf8ToBytes } from "@noble/hashes/utils.js";

/** Memory-hard params — practical on VPS/Docker/Tauri without multi-second waits. */
const ARGON2 = {
  t: 3,
  m: 64 * 1024, // 64 MiB
  p: 1,
  maxmem: 128 * 1024 * 1024,
} as const;

const HASH_LEN = 32;
const SALT_LEN = 16;

export type PasswordHashRecord = {
  v: 1;
  alg: "argon2id";
  t: number;
  m: number;
  p: number;
  salt: string;
  hash: string;
};

function isRecord(value: unknown): value is PasswordHashRecord {
  if (!value || typeof value !== "object") return false;
  const r = value as PasswordHashRecord;
  return (
    r.v === 1 &&
    r.alg === "argon2id" &&
    typeof r.salt === "string" &&
    typeof r.hash === "string" &&
    typeof r.t === "number" &&
    typeof r.m === "number" &&
    typeof r.p === "number"
  );
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(SALT_LEN);
  const hash = await argon2idAsync(utf8ToBytes(password), salt, {
    ...ARGON2,
    dkLen: HASH_LEN,
  });
  const record: PasswordHashRecord = {
    v: 1,
    alg: "argon2id",
    t: ARGON2.t,
    m: ARGON2.m,
    p: ARGON2.p,
    salt: bytesToHex(salt),
    hash: bytesToHex(hash),
  };
  return JSON.stringify(record);
}

export async function verifyPassword(password: string, encoded: string): Promise<boolean> {
  let record: PasswordHashRecord;
  try {
    record = JSON.parse(encoded) as PasswordHashRecord;
  } catch {
    return false;
  }
  if (!isRecord(record)) return false;

  const salt = hexToBytes(record.salt);
  const expected = hexToBytes(record.hash);
  const actual = await argon2idAsync(utf8ToBytes(password), salt, {
    t: record.t,
    m: record.m,
    p: record.p,
    dkLen: expected.length,
    maxmem: Math.max(ARGON2.maxmem, record.m * 1024 * 2),
  });

  if (actual.length !== expected.length) return false;
  return timingSafeEqual(Buffer.from(actual), Buffer.from(expected));
}

/** Derive a 32-byte key encryption key from the password + per-profile salt. */
export async function deriveKek(password: string, saltHex: string): Promise<Uint8Array> {
  return argon2idAsync(utf8ToBytes(password), hexToBytes(saltHex), {
    ...ARGON2,
    dkLen: 32,
  });
}

export function newKdfSalt(): string {
  return bytesToHex(randomBytes(SALT_LEN));
}

export function sha256Hex(input: string | Buffer | Uint8Array): string {
  return createHash("sha256").update(input).digest("hex");
}

export function assertPasswordStrength(password: string): void {
  if (typeof password !== "string" || password.length < 8) {
    throw new Error("Password must be at least 8 characters");
  }
  if (password.length > 200) {
    throw new Error("Password is too long");
  }
}
