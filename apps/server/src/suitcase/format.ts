import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { deflateSync, inflateSync } from "node:zlib";
import { bytesToHex, hexToBytes } from "@noble/hashes/utils.js";
import { deriveKek, newKdfSalt } from "../auth/password.js";

const MAGIC = Buffer.from("PAS1"); // PersonAI Suitcase v1
const ALGO = "aes-256-gcm";
const IV_LEN = 12;
const TAG_LEN = 16;
const VERSION = 1;

export const SUITCASE_KIND = "personai-suitcase-v1";

export type SuitcaseManifest = {
  kind: typeof SUITCASE_KIND;
  exportedAt: string;
  profileName: string;
  sourceProfileId: string;
  includesArchive: boolean;
  files: Array<{ path: string; size: number; sha256: string }>;
};

export type SuitcaseFile = {
  path: string;
  data: Buffer;
};

export type UnpackedSuitcase = {
  manifest: SuitcaseManifest;
  files: SuitcaseFile[];
};

function sha256Hex(buf: Buffer): string {
  return createHash("sha256").update(buf).digest("hex");
}

function assertSafeRelPath(rel: string): string {
  const normalized = rel.replace(/\\/g, "/").replace(/^\/+/, "");
  if (!normalized || normalized.includes("..") || normalized.includes("\0")) {
    throw new Error(`Unsafe suitcase path: ${rel}`);
  }
  return normalized;
}

/** Pack files + manifest into an uncompressed binary payload. */
export function encodePayload(manifest: SuitcaseManifest, files: SuitcaseFile[]): Buffer {
  const manifestBuf = Buffer.from(JSON.stringify(manifest), "utf8");
  const parts: Buffer[] = [];
  const header = Buffer.alloc(4);
  header.writeUInt32BE(manifestBuf.length, 0);
  parts.push(header, manifestBuf);

  for (const file of files) {
    const relPath = assertSafeRelPath(file.path);
    const pathBuf = Buffer.from(relPath, "utf8");
    if (pathBuf.length > 0xffff) throw new Error(`Path too long: ${relPath}`);
    const meta = Buffer.alloc(2 + 4);
    meta.writeUInt16BE(pathBuf.length, 0);
    meta.writeUInt32BE(file.data.length, 2);
    parts.push(meta, pathBuf, file.data);
  }
  return Buffer.concat(parts);
}

export function decodePayload(payload: Buffer): UnpackedSuitcase {
  if (payload.length < 4) throw new Error("Suitcase payload truncated");
  let offset = 0;
  const manifestLen = payload.readUInt32BE(offset);
  offset += 4;
  if (offset + manifestLen > payload.length) throw new Error("Suitcase manifest truncated");
  const manifestRaw = payload.subarray(offset, offset + manifestLen).toString("utf8");
  offset += manifestLen;
  let manifest: SuitcaseManifest;
  try {
    manifest = JSON.parse(manifestRaw) as SuitcaseManifest;
  } catch {
    throw new Error("Suitcase manifest is not valid JSON");
  }
  if (manifest.kind !== SUITCASE_KIND) {
    throw new Error(`Unsupported suitcase kind: ${String(manifest.kind)}`);
  }

  const files: SuitcaseFile[] = [];
  while (offset < payload.length) {
    if (offset + 6 > payload.length) throw new Error("Suitcase file header truncated");
    const pathLen = payload.readUInt16BE(offset);
    offset += 2;
    const dataLen = payload.readUInt32BE(offset);
    offset += 4;
    if (offset + pathLen + dataLen > payload.length) throw new Error("Suitcase file truncated");
    const relPath = assertSafeRelPath(payload.subarray(offset, offset + pathLen).toString("utf8"));
    offset += pathLen;
    const data = Buffer.from(payload.subarray(offset, offset + dataLen));
    offset += dataLen;
    files.push({ path: relPath, data });
  }

  const byPath = new Map(files.map((f) => [f.path, f]));
  for (const entry of manifest.files ?? []) {
    const relPath = assertSafeRelPath(entry.path);
    const file = byPath.get(relPath);
    if (!file) throw new Error(`Suitcase missing file: ${relPath}`);
    if (file.data.length !== entry.size) {
      throw new Error(`Suitcase size mismatch for ${relPath}`);
    }
    if (entry.sha256 && sha256Hex(file.data) !== entry.sha256) {
      throw new Error(`Suitcase hash mismatch for ${relPath}`);
    }
  }

  return { manifest, files };
}

export function buildManifest(input: {
  profileName: string;
  sourceProfileId: string;
  includesArchive: boolean;
  files: SuitcaseFile[];
}): SuitcaseManifest {
  return {
    kind: SUITCASE_KIND,
    exportedAt: new Date().toISOString(),
    profileName: input.profileName,
    sourceProfileId: input.sourceProfileId,
    includesArchive: input.includesArchive,
    files: input.files.map((f) => ({
      path: assertSafeRelPath(f.path),
      size: f.data.length,
      sha256: sha256Hex(f.data),
    })),
  };
}

/** Seal payload with a password-derived AES-256-GCM key (Argon2id). */
export async function sealSuitcase(payload: Buffer, password: string): Promise<Buffer> {
  const saltHex = newKdfSalt();
  const kek = await deriveKek(password, saltHex);
  const compressed = deflateSync(payload);
  const iv = randomBytes(IV_LEN);
  const cipher = createCipheriv(ALGO, Buffer.from(kek), iv);
  const ciphertext = Buffer.concat([cipher.update(compressed), cipher.final()]);
  const tag = cipher.getAuthTag();
  const salt = Buffer.from(hexToBytes(saltHex));
  return Buffer.concat([MAGIC, Buffer.from([VERSION, salt.length]), salt, iv, tag, ciphertext]);
}

/** Open a sealed suitcase with the export password. */
export async function openSuitcase(blob: Buffer, password: string): Promise<UnpackedSuitcase> {
  if (blob.length < 4 + 1 + 1 + IV_LEN + TAG_LEN + 1) {
    throw new Error("Suitcase file is truncated");
  }
  if (blob.subarray(0, 4).toString("utf8") !== "PAS1") {
    throw new Error("Not a PersonAI sealed suitcase");
  }
  const ver = blob[4];
  if (ver !== VERSION) throw new Error(`Unsupported suitcase version: ${ver}`);
  const saltLen = blob[5];
  let offset = 6;
  if (offset + saltLen + IV_LEN + TAG_LEN > blob.length) {
    throw new Error("Suitcase header truncated");
  }
  const salt = blob.subarray(offset, offset + saltLen);
  offset += saltLen;
  const iv = blob.subarray(offset, offset + IV_LEN);
  offset += IV_LEN;
  const tag = blob.subarray(offset, offset + TAG_LEN);
  offset += TAG_LEN;
  const ciphertext = blob.subarray(offset);

  const saltHex = bytesToHex(salt);
  const kek = await deriveKek(password, saltHex);
  const decipher = createDecipheriv(ALGO, Buffer.from(kek), iv);
  decipher.setAuthTag(tag);
  let compressed: Buffer;
  try {
    compressed = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  } catch {
    throw new Error("Invalid suitcase password or corrupted file");
  }
  let payload: Buffer;
  try {
    payload = inflateSync(compressed);
  } catch {
    throw new Error("Suitcase payload is corrupted");
  }
  return decodePayload(payload);
}

export function fileEntry(path: string, data: Buffer): SuitcaseFile {
  return { path: assertSafeRelPath(path), data };
}
