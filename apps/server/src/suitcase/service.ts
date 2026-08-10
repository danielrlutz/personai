import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import {
  config,
  profileArchiveDir,
  profileDbPath,
  profileDir,
  profilesDir,
  registryPath,
} from "../config.js";
import { assertPasswordStrength, hashPassword } from "../auth/password.js";
import {
  clearUnlockedDek,
  enableEncryptionForProfile,
  isProfileUnlocked,
  lockProfileDb,
} from "../auth/crypto-db.js";
import { getPrisma, shutdownPrisma } from "../db/prisma-singleton.js";
import {
  getProfileById,
  listProfiles,
  toPublicProfile,
  type Profile,
  type PublicProfile,
} from "../profiles/registry.js";
import {
  buildManifest,
  encodePayload,
  fileEntry,
  openSuitcase,
  sealSuitcase,
  type SuitcaseFile,
  type SuitcaseManifest,
} from "./format.js";

const MAX_ARCHIVE_BYTES = 400 * 1024 * 1024;
const MAX_ARCHIVE_FILES = 5000;
const RESTORE_PASSWORD_FILE = ".restore-password";
const MANIFEST_FILE = "manifest.json";

export type ArchiveBlobOption = {
  path: string;
  size: number;
  name: string;
};

export type SuitcaseExportResult = {
  filename: string;
  bytes: Buffer;
  manifest: SuitcaseManifest;
};

export type SuitcaseStagingResult = {
  stagingId: string;
  profileName: string;
  sourceProfileId: string;
  includesArchive: boolean;
  fileCount: number;
  totalBytes: number;
  exportedAt: string;
};

export type SuitcaseImportApplyResult = {
  profile: PublicProfile;
  stagingId: string;
};

function stagingRoot(): string {
  return path.join(config.dataDir, "suitcases", "staging");
}

function stagingDir(stagingId: string): string {
  const id = stagingId.trim();
  if (!id || id.includes("..") || id.includes("/") || id.includes("\\") || id.includes("\0")) {
    throw new Error("Invalid staging id");
  }
  return path.join(stagingRoot(), id);
}

function assertSafeRelPath(rel: string): string {
  const normalized = rel.replace(/\\/g, "/").replace(/^\/+/, "");
  if (!normalized || normalized.includes("..") || normalized.includes("\0")) {
    throw new Error(`Unsafe path: ${rel}`);
  }
  return normalized;
}

async function walkFiles(root: string): Promise<Array<{ abs: string; rel: string; size: number }>> {
  const out: Array<{ abs: string; rel: string; size: number }> = [];
  async function walk(dir: string, relBase: string): Promise<void> {
    let entries: fs.Dirent[];
    try {
      entries = await fsp.readdir(dir, { withFileTypes: true });
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return;
      throw err;
    }
    for (const ent of entries) {
      const abs = path.join(dir, ent.name);
      const rel = relBase ? `${relBase}/${ent.name}` : ent.name;
      if (ent.isDirectory()) {
        await walk(abs, rel.replace(/\\/g, "/"));
      } else if (ent.isFile()) {
        const st = await fsp.stat(abs);
        out.push({ abs, rel: rel.replace(/\\/g, "/"), size: st.size });
      }
    }
  }
  await walk(root, "");
  return out;
}

function saveRegistry(registry: ReturnType<typeof listProfiles>): void {
  fs.mkdirSync(path.dirname(registryPath()), { recursive: true });
  fs.writeFileSync(registryPath(), JSON.stringify(registry, null, 2), "utf-8");
}

async function collectArchiveFiles(
  profileId: string,
  archivePaths?: string[],
): Promise<SuitcaseFile[]> {
  const archiveRoot = profileArchiveDir(profileId);
  const listed = await walkFiles(archiveRoot);
  let selected = listed;
  if (archivePaths && archivePaths.length > 0) {
    const wanted = new Set(archivePaths.map(assertSafeRelPath));
    selected = listed.filter((f) => wanted.has(f.rel));
    for (const w of wanted) {
      if (!selected.some((f) => f.rel === w)) {
        throw new Error(`Archive path not found: ${w}`);
      }
    }
  }
  if (selected.length > MAX_ARCHIVE_FILES) {
    throw new Error(`Archive has too many files (max ${MAX_ARCHIVE_FILES})`);
  }
  let total = 0;
  const files: SuitcaseFile[] = [];
  for (const item of selected) {
    total += item.size;
    if (total > MAX_ARCHIVE_BYTES) {
      throw new Error(`Archive exceeds ${MAX_ARCHIVE_BYTES / (1024 * 1024)} MiB limit`);
    }
    const data = await fsp.readFile(item.abs);
    files.push(fileEntry(`archive/${item.rel}`, data));
  }
  return files;
}

/** List local archive blobs available for optional suitcase inclusion. */
export async function listArchiveBlobOptions(profileId: string): Promise<ArchiveBlobOption[]> {
  const archiveRoot = profileArchiveDir(profileId);
  const listed = await walkFiles(archiveRoot);
  return listed
    .map((f) => ({
      path: f.rel,
      size: f.size,
      name: path.basename(f.rel),
    }))
    .sort((a, b) => a.path.localeCompare(b.path));
}

/**
 * Export the unlocked profile DB (+ optional archive) into a password-sealed .pao suitcase.
 * Does not change the active session.
 */
export async function exportSealedSuitcase(input: {
  profileId: string;
  password: string;
  includeArchive?: boolean;
  archivePaths?: string[];
}): Promise<SuitcaseExportResult> {
  assertPasswordStrength(input.password);
  const profile = getProfileById(input.profileId);
  if (!profile) throw new Error("Profile not found");
  if (!isProfileUnlocked(input.profileId)) {
    throw new Error("Profile must be unlocked to export a sealed suitcase");
  }

  const prisma = await getPrisma(input.profileId);
  try {
    await prisma.$executeRawUnsafe("PRAGMA wal_checkpoint(TRUNCATE);");
  } catch {
    // ignore — best-effort consistency
  }

  const dbPath = profileDbPath(input.profileId);
  if (!fs.existsSync(dbPath)) {
    throw new Error("Profile database file is missing");
  }
  const dbBytes = await fsp.readFile(dbPath);

  const files: SuitcaseFile[] = [
    fileEntry("personai.db", dbBytes),
    fileEntry(
      "profile.json",
      Buffer.from(
        JSON.stringify(
          {
            name: profile.name,
            avatar: profile.avatar ?? null,
            sourceProfileId: profile.id,
            createdAt: profile.createdAt,
          },
          null,
          2,
        ),
        "utf8",
      ),
    ),
  ];

  const includeArchive = Boolean(input.includeArchive);
  if (includeArchive) {
    files.push(...(await collectArchiveFiles(input.profileId, input.archivePaths)));
  }

  const manifest = buildManifest({
    profileName: profile.name,
    sourceProfileId: profile.id,
    includesArchive: includeArchive,
    files,
  });
  const payload = encodePayload(manifest, files);
  const bytes = await sealSuitcase(payload, input.password);
  const stamp = new Date().toISOString().slice(0, 10);
  const safeName = profile.name.replace(/[^\w\-]+/g, "_").slice(0, 48) || "profile";
  return {
    filename: `${safeName}-${stamp}.pao`,
    bytes,
    manifest,
  };
}

/** Decrypt suitcase into staging; password kept in sidecar for confirm-time restore. */
export async function stageSuitcaseImport(input: {
  blob: Buffer;
  password: string;
  profileName?: string;
}): Promise<SuitcaseStagingResult> {
  assertPasswordStrength(input.password);
  const unpacked = await openSuitcase(input.blob, input.password);
  const { manifest, files } = unpacked;
  if (files.length > MAX_ARCHIVE_FILES + 8) {
    throw new Error(`Suitcase has too many files (max ${MAX_ARCHIVE_FILES})`);
  }
  let total = 0;
  for (const f of files) {
    total += f.data.length;
    if (total > MAX_ARCHIVE_BYTES + 64 * 1024 * 1024) {
      throw new Error("Suitcase payload is too large");
    }
  }
  const hasDb = files.some((f) => f.path === "personai.db");
  if (!hasDb) throw new Error("Suitcase is missing personai.db");

  const stagingId = randomUUID();
  const dir = stagingDir(stagingId);
  await fsp.mkdir(dir, { recursive: true });
  try {
    await fsp.writeFile(path.join(dir, MANIFEST_FILE), JSON.stringify(manifest, null, 2), "utf8");
    await fsp.writeFile(path.join(dir, RESTORE_PASSWORD_FILE), input.password, "utf8");
    for (const file of files) {
      const rel = assertSafeRelPath(file.path);
      const abs = path.join(dir, ...rel.split("/"));
      await fsp.mkdir(path.dirname(abs), { recursive: true });
      await fsp.writeFile(abs, file.data);
    }
  } catch (err) {
    await fsp.rm(dir, { recursive: true, force: true }).catch(() => undefined);
    throw err;
  }

  const preferredName = (input.profileName ?? "").trim() || manifest.profileName || "Imported profile";
  if ((input.profileName ?? "").trim()) {
    await fsp.writeFile(path.join(dir, "import-name.txt"), preferredName, "utf8");
  }
  return {
    stagingId,
    profileName: preferredName,
    sourceProfileId: manifest.sourceProfileId,
    includesArchive: Boolean(manifest.includesArchive),
    fileCount: files.length,
    totalBytes: total,
    exportedAt: manifest.exportedAt,
  };
}

export async function discardSuitcaseStaging(stagingId: string): Promise<void> {
  const dir = stagingDir(stagingId);
  await fsp.rm(dir, { recursive: true, force: true });
}

function uniqueProfileName(desired: string): string {
  const base = desired.trim() || "Imported profile";
  const registry = listProfiles();
  const names = new Set(registry.profiles.map((p) => p.name.toLowerCase()));
  if (!names.has(base.toLowerCase())) return base;
  for (let i = 2; i < 1000; i++) {
    const candidate = `${base} (${i})`;
    if (!names.has(candidate.toLowerCase())) return candidate;
  }
  return `${base} (${randomUUID().slice(0, 8)})`;
}

/**
 * Materialize staging into a NEW sealed profile. Does not switch the active session.
 */
export async function applySuitcaseImport(stagingId: string): Promise<SuitcaseImportApplyResult> {
  const dir = stagingDir(stagingId);
  const manifestPath = path.join(dir, MANIFEST_FILE);
  const passwordPath = path.join(dir, RESTORE_PASSWORD_FILE);
  const dbSrc = path.join(dir, "personai.db");
  if (!fs.existsSync(manifestPath) || !fs.existsSync(passwordPath) || !fs.existsSync(dbSrc)) {
    throw new Error("Suitcase staging is incomplete or already applied");
  }

  const manifest = JSON.parse(await fsp.readFile(manifestPath, "utf8")) as SuitcaseManifest;
  const password = (await fsp.readFile(passwordPath, "utf8")).toString();
  assertPasswordStrength(password);

  let preferredName = manifest.profileName || "Imported profile";
  try {
    const metaRaw = await fsp.readFile(path.join(dir, "profile.json"), "utf8");
    const meta = JSON.parse(metaRaw) as { name?: string };
    if (meta.name?.trim()) preferredName = meta.name.trim();
  } catch {
    // optional
  }
  // Prefer name captured at stage time if present in a sidecar note file written by route.
  const nameOverridePath = path.join(dir, "import-name.txt");
  if (fs.existsSync(nameOverridePath)) {
    const override = (await fsp.readFile(nameOverridePath, "utf8")).trim();
    if (override) preferredName = override;
  }

  const registry = listProfiles();
  const previousActiveId = registry.activeProfileId;
  const previousWasUnlocked = previousActiveId ? isProfileUnlocked(previousActiveId) : false;

  await shutdownPrisma();

  const profileId = randomUUID();
  const name = uniqueProfileName(preferredName);
  const passwordHash = await hashPassword(password);
  const profile: Profile = {
    id: profileId,
    name,
    createdAt: new Date().toISOString(),
    passwordHash,
    dbEncrypted: false,
  };

  fs.mkdirSync(profilesDir(), { recursive: true });
  fs.mkdirSync(profileDir(profileId), { recursive: true });
  fs.mkdirSync(profileArchiveDir(profileId), { recursive: true });

  await fsp.copyFile(dbSrc, profileDbPath(profileId));

  const archiveStaging = path.join(dir, "archive");
  if (fs.existsSync(archiveStaging)) {
    const archiveFiles = await walkFiles(archiveStaging);
    if (archiveFiles.length > MAX_ARCHIVE_FILES) {
      throw new Error(`Imported archive has too many files (max ${MAX_ARCHIVE_FILES})`);
    }
    let total = 0;
    for (const item of archiveFiles) {
      total += item.size;
      if (total > MAX_ARCHIVE_BYTES) {
        throw new Error("Imported archive exceeds size limit");
      }
      const rel = assertSafeRelPath(item.rel);
      const dest = path.join(profileArchiveDir(profileId), ...rel.split("/"));
      await fsp.mkdir(path.dirname(dest), { recursive: true });
      await fsp.copyFile(item.abs, dest);
    }
  }

  registry.profiles.push(profile);
  // Keep previous active profile — never switch session on import.
  if (!registry.activeProfileId) {
    registry.activeProfileId = previousActiveId;
  }
  saveRegistry(registry);

  try {
    const enc = await enableEncryptionForProfile(profileId, password);
    const updated = listProfiles();
    const idx = updated.profiles.findIndex((p) => p.id === profileId);
    if (idx === -1) throw new Error("Imported profile missing from registry");
    updated.profiles[idx] = {
      ...updated.profiles[idx],
      kdfSalt: enc.kdfSalt,
      wrappedDek: enc.wrappedDek,
      dbEncrypted: true,
      passwordHash,
    };
    // Restore prior active id explicitly.
    if (previousActiveId) updated.activeProfileId = previousActiveId;
    saveRegistry(updated);

    await lockProfileDb(profileId);
    clearUnlockedDek(profileId);

    const sealed = listProfiles();
    const sealedIdx = sealed.profiles.findIndex((p) => p.id === profileId);
    if (sealedIdx >= 0) {
      sealed.profiles[sealedIdx] = { ...sealed.profiles[sealedIdx], dbEncrypted: true };
      if (previousActiveId) sealed.activeProfileId = previousActiveId;
      saveRegistry(sealed);
    }
  } catch (err) {
    // Best-effort cleanup of failed import profile
    try {
      const failed = listProfiles();
      failed.profiles = failed.profiles.filter((p) => p.id !== profileId);
      if (previousActiveId) failed.activeProfileId = previousActiveId;
      saveRegistry(failed);
      await fsp.rm(profileDir(profileId), { recursive: true, force: true });
    } catch {
      // ignore
    }
    throw err;
  } finally {
    clearUnlockedDek(profileId);
    await shutdownPrisma();
    // Re-attach prisma to previous unlocked session when possible.
    if (previousActiveId && previousWasUnlocked && isProfileUnlocked(previousActiveId)) {
      try {
        await getPrisma(previousActiveId);
      } catch {
        // caller session middleware will recover on next request
      }
    }
  }

  await discardSuitcaseStaging(stagingId);

  const created = getProfileById(profileId);
  if (!created) throw new Error("Import succeeded but profile is missing");
  return { profile: toPublicProfile(created), stagingId };
}
