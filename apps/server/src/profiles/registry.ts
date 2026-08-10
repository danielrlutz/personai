import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { registryPath, config, profilesDir, profileDir, profileDbPath } from "../config.js";
import { getPrisma, shutdownPrisma } from "../db/prisma-singleton.js";
import {
  assertPasswordStrength,
  hashPassword,
  verifyPassword,
} from "../auth/password.js";
import {
  enableEncryptionForProfile,
  lockProfileDb,
  rewrapDek,
  unlockProfileDb,
  clearUnlockedDek,
  dbLooksEncryptedOnDisk,
  profileEncDbPath,
} from "../auth/crypto-db.js";
import { countSessionsForProfile } from "../auth/session.js";

export interface Profile {
  id: string;
  name: string;
  avatar?: string;
  createdAt: string;
  /** Argon2id JSON record — never returned to clients. */
  passwordHash?: string;
  kdfSalt?: string;
  wrappedDek?: string;
  dbEncrypted?: boolean;
}

export interface PublicProfile {
  id: string;
  name: string;
  avatar?: string;
  createdAt: string;
  /** True only when passwordHash + kdfSalt + wrappedDek are all present. */
  hasPassword: boolean;
  dbEncrypted: boolean;
  /**
   * Sealed (or marked encrypted) DB on disk but unlock material missing from
   * profiles.json — login/setup cannot work until restore or emergency reset.
   */
  needsCryptoRestore: boolean;
}

export interface ProfileRegistry {
  activeProfileId: string | null;
  profiles: Profile[];
}

export interface PublicProfileRegistry {
  activeProfileId: string | null;
  profiles: PublicProfile[];
}

export interface OrphanProfileDir {
  id: string;
  hasDb: boolean;
  hasEnc: boolean;
}

const PROFILE_ID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isProfileRegistry(value: unknown): value is ProfileRegistry {
  if (!value || typeof value !== "object") return false;
  const obj = value as Record<string, unknown>;
  if (!Array.isArray(obj.profiles)) return false;
  if (obj.activeProfileId !== null && typeof obj.activeProfileId !== "string") return false;
  return obj.profiles.every((p) => {
    if (!p || typeof p !== "object") return false;
    const row = p as Record<string, unknown>;
    return typeof row.id === "string" && typeof row.name === "string";
  });
}

/** UUID dirs under profiles/ that already hold a DB (plaintext or sealed). */
export function discoverOrphanProfileDirs(): OrphanProfileDir[] {
  const root = profilesDir();
  if (!fs.existsSync(root)) return [];
  const found: OrphanProfileDir[] = [];
  for (const name of fs.readdirSync(root)) {
    if (name === "bootstrap" || !PROFILE_ID_RE.test(name)) continue;
    const dir = profileDir(name);
    let st: fs.Stats;
    try {
      st = fs.statSync(dir);
    } catch {
      continue;
    }
    if (!st.isDirectory()) continue;
    const hasDb = fs.existsSync(profileDbPath(name));
    const hasEnc = fs.existsSync(profileEncDbPath(name));
    if (hasDb || hasEnc) {
      found.push({ id: name, hasDb, hasEnc });
    }
  }
  return found;
}

function stubFromOrphan(orphan: OrphanProfileDir): Profile {
  return {
    id: orphan.id,
    name: `Recovered ${orphan.id.slice(0, 8)}`,
    createdAt: new Date().toISOString(),
    dbEncrypted: orphan.hasEnc || dbLooksEncryptedOnDisk(orphan.id),
  };
}

/**
 * Rebuild registry entries from on-disk profile DBs when profiles.json is
 * missing/empty/corrupt. Does not invent crypto material — login still needs
 * a restored profiles.json (or suitcase) if passwordHash/wrappedDek were lost.
 */
export function rehydrateRegistryFromDisk(existing?: ProfileRegistry): ProfileRegistry {
  const orphans = discoverOrphanProfileDirs();
  const registry: ProfileRegistry = existing
    ? {
        activeProfileId: existing.activeProfileId,
        profiles: [...existing.profiles],
      }
    : { activeProfileId: null, profiles: [] };
  const known = new Set(registry.profiles.map((p) => p.id));
  let added = 0;
  for (const orphan of orphans) {
    if (known.has(orphan.id)) continue;
    registry.profiles.push(stubFromOrphan(orphan));
    known.add(orphan.id);
    added += 1;
  }
  if (!registry.activeProfileId && registry.profiles.length > 0) {
    registry.activeProfileId = registry.profiles[0].id;
  }
  if (added > 0 || !fs.existsSync(registryPath())) {
    console.warn(
      `[personai] Rehydrated profiles.json from ${orphans.length} on-disk profile dir(s) ` +
        `(+${added} stub entries). If unlock fails, restore profiles.json backup ` +
        `(passwordHash/wrappedDek) — sealed DBs alone are not enough.`,
    );
    saveRegistry(registry);
  }
  return registry;
}

function ensureRegistry(): ProfileRegistry {
  fs.mkdirSync(config.dataDir, { recursive: true });
  fs.mkdirSync(profilesDir(), { recursive: true });
  const orphans = discoverOrphanProfileDirs();

  if (!fs.existsSync(registryPath())) {
    if (orphans.length > 0) {
      console.warn(
        `[personai] profiles.json missing but found ${orphans.length} sealed/plain profile DB(s) — rehydrating (not creating Default)`,
      );
      return rehydrateRegistryFromDisk();
    }
    const initial: ProfileRegistry = { activeProfileId: null, profiles: [] };
    fs.writeFileSync(registryPath(), JSON.stringify(initial, null, 2), "utf-8");
    return initial;
  }

  try {
    const parsed: unknown = JSON.parse(fs.readFileSync(registryPath(), "utf-8"));
    if (!isProfileRegistry(parsed)) {
      throw new Error("invalid profiles.json shape");
    }
    if (parsed.profiles.length === 0 && orphans.length > 0) {
      console.warn(
        `[personai] profiles.json has 0 entries but found ${orphans.length} profile DB(s) under profiles/ — rehydrating (not creating Default)`,
      );
      return rehydrateRegistryFromDisk(parsed);
    }
    // Merge any orphan dirs not listed (never drop existing JSON entries).
    const known = new Set(parsed.profiles.map((p) => p.id));
    const missing = orphans.filter((o) => !known.has(o.id));
    if (missing.length > 0) {
      console.warn(
        `[personai] Found ${missing.length} profile DB dir(s) not listed in profiles.json — merging stubs`,
      );
      return rehydrateRegistryFromDisk(parsed);
    }
    return parsed;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const bak = `${registryPath()}.corrupt.${Date.now()}`;
    try {
      fs.renameSync(registryPath(), bak);
    } catch {
      /* keep going */
    }
    if (orphans.length > 0) {
      console.error(
        `[personai] profiles.json unreadable (${msg}); backed up to ${path.basename(bak)}; ` +
          `rehydrating ${orphans.length} on-disk profile dir(s) — NOT creating Default`,
      );
      return rehydrateRegistryFromDisk();
    }
    console.error(
      `[personai] profiles.json unreadable (${msg}); backed up to ${path.basename(bak)}; starting empty`,
    );
    const initial: ProfileRegistry = { activeProfileId: null, profiles: [] };
    fs.writeFileSync(registryPath(), JSON.stringify(initial, null, 2), "utf-8");
    return initial;
  }
}

function saveRegistry(registry: ProfileRegistry): void {
  // Never clobber a non-empty registry file with an empty one (boot races / bad DATA_DIR).
  if (registry.profiles.length === 0 && fs.existsSync(registryPath())) {
    try {
      const prevRaw = fs.readFileSync(registryPath(), "utf-8");
      const prev: unknown = JSON.parse(prevRaw);
      if (isProfileRegistry(prev) && prev.profiles.length > 0) {
        console.error(
          `[personai] Refusing to overwrite profiles.json (${prev.profiles.length} entries) with empty registry`,
        );
        throw new Error("Refusing to overwrite non-empty profiles.json with empty registry");
      }
    } catch (err) {
      if (err instanceof Error && err.message.startsWith("Refusing to overwrite")) throw err;
      // Unreadable previous file — allow write after ensureRegistry already backed it up.
    }
  }
  const tmp = `${registryPath()}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(registry, null, 2), "utf-8");
  fs.renameSync(tmp, registryPath());
}

function profileHasUnlockMaterial(profile: Profile): boolean {
  return Boolean(profile.passwordHash && profile.kdfSalt && profile.wrappedDek);
}

function profileNeedsCryptoRestore(profile: Profile): boolean {
  if (profileHasUnlockMaterial(profile)) return false;
  return Boolean(profile.dbEncrypted) || dbLooksEncryptedOnDisk(profile.id);
}

export function toPublicProfile(profile: Profile): PublicProfile {
  const dbEncrypted = Boolean(profile.dbEncrypted) || dbLooksEncryptedOnDisk(profile.id);
  return {
    id: profile.id,
    name: profile.name,
    avatar: profile.avatar,
    createdAt: profile.createdAt,
    hasPassword: profileHasUnlockMaterial(profile),
    dbEncrypted,
    needsCryptoRestore: profileNeedsCryptoRestore(profile),
  };
}

export function listProfiles(): ProfileRegistry {
  return ensureRegistry();
}

export function listPublicProfiles(): PublicProfileRegistry {
  const registry = ensureRegistry();
  return {
    activeProfileId: registry.activeProfileId,
    profiles: registry.profiles.map(toPublicProfile),
  };
}

export function getProfileById(profileId: string): Profile | null {
  return ensureRegistry().profiles.find((p) => p.id === profileId) ?? null;
}

function updateProfile(profileId: string, patch: Partial<Profile>): Profile {
  const registry = ensureRegistry();
  const idx = registry.profiles.findIndex((p) => p.id === profileId);
  if (idx === -1) throw new Error(`Profile not found: ${profileId}`);
  registry.profiles[idx] = { ...registry.profiles[idx], ...patch };
  saveRegistry(registry);
  return registry.profiles[idx];
}

export async function createProfile(
  name: string,
  options?: { avatar?: string; password?: string },
): Promise<Profile> {
  const registry = ensureRegistry();
  const profile: Profile = {
    id: randomUUID(),
    name,
    avatar: options?.avatar,
    createdAt: new Date().toISOString(),
  };

  if (options?.password) {
    assertPasswordStrength(options.password);
    profile.passwordHash = await hashPassword(options.password);
  }

  registry.profiles.push(profile);
  if (!registry.activeProfileId) {
    registry.activeProfileId = profile.id;
  }
  saveRegistry(registry);
  fs.mkdirSync(profileDir(profile.id), { recursive: true });

  if (options?.password) {
    const enc = await enableEncryptionForProfile(profile.id, options.password);
    updateProfile(profile.id, {
      kdfSalt: enc.kdfSalt,
      wrappedDek: enc.wrappedDek,
      dbEncrypted: true,
    });
  }

  await getPrisma(profile.id);
  return getProfileById(profile.id)!;
}

export async function switchProfile(profileId: string): Promise<Profile> {
  const registry = ensureRegistry();
  const profile = registry.profiles.find((p) => p.id === profileId);
  if (!profile) {
    throw new Error(`Profile not found: ${profileId}`);
  }

  const previousId = registry.activeProfileId;
  if (previousId && previousId !== profileId) {
    await shutdownPrisma();
    // Seal previous profile if no other live sessions keep it unlocked.
    if (countSessionsForProfile(previousId) === 0) {
      const prev = registry.profiles.find((p) => p.id === previousId);
      if (prev?.passwordHash && prev.wrappedDek) {
        await lockProfileDb(previousId);
        updateProfile(previousId, { dbEncrypted: true });
      }
    }
  }

  // Encrypted profiles must be unlocked before Prisma opens the file.
  if (profile.passwordHash && profile.dbEncrypted && dbLooksEncryptedOnDisk(profileId)) {
    throw new Error("Profile database is locked. Sign in with your password first.");
  }

  registry.activeProfileId = profileId;
  saveRegistry(registry);
  await getPrisma(profileId);
  return profile;
}

export function getActiveProfile(): Profile | null {
  const registry = ensureRegistry();
  if (!registry.activeProfileId) return null;
  return registry.profiles.find((p) => p.id === registry.activeProfileId) ?? null;
}

/**
 * Resolve profile id for a request. Prefer authenticated session; header alone is not trusted
 * by middleware for protected routes. Kept for workers / internal use.
 */
export function requireProfileId(headerValue?: string): string {
  if (headerValue) return headerValue;
  const active = getActiveProfile();
  if (!active) {
    throw new Error("No active profile. Create or switch to a profile first.");
  }
  return active.id;
}

/** First-run / migration: set password when none exists yet. Encrypts the DB. */
export async function setupProfilePassword(profileId: string, password: string): Promise<PublicProfile> {
  assertPasswordStrength(password);
  const profile = getProfileById(profileId);
  if (!profile) throw new Error(`Profile not found: ${profileId}`);
  if (profileHasUnlockMaterial(profile)) {
    throw new Error("Password already set. Use change-password while signed in.");
  }
  if (profileNeedsCryptoRestore(profile)) {
    throw new Error(
      "Unlock keys missing for a sealed database. Restore profiles.json backup " +
        "(passwordHash/kdfSalt/wrappedDek), or run scripts/emergency-reset-profile-crypto.sh " +
        "for this profile id (quarantines .enc; keeps uploads/archive; fresh empty DB).",
    );
  }

  const passwordHash = await hashPassword(password);
  const enc = await enableEncryptionForProfile(profileId, password);
  const updated = updateProfile(profileId, {
    passwordHash,
    kdfSalt: enc.kdfSalt,
    wrappedDek: enc.wrappedDek,
    dbEncrypted: true,
  });

  // Ensure DB exists/opened under the new DEK.
  await getPrisma(profileId);
  return toPublicProfile(updated);
}

export async function loginProfile(profileId: string, password: string): Promise<Profile> {
  const profile = getProfileById(profileId);
  if (!profile) throw new Error(`Profile not found: ${profileId}`);
  if (!profileHasUnlockMaterial(profile)) {
    if (profileNeedsCryptoRestore(profile)) {
      throw new Error(
        "Unlock keys missing from profiles.json. Restore a backup or run " +
          "scripts/emergency-reset-profile-crypto.sh",
      );
    }
    throw new Error("Password not set for this profile. Complete setup first.");
  }

  const ok = await verifyPassword(password, profile.passwordHash!);
  if (!ok) throw new Error("Invalid password");

  await unlockProfileDb(profileId, password, profile.kdfSalt!, profile.wrappedDek!);
  updateProfile(profileId, { dbEncrypted: true });
  await switchProfile(profileId);
  return getProfileById(profileId)!;
}

export async function changeProfilePassword(
  profileId: string,
  currentPassword: string,
  newPassword: string,
): Promise<PublicProfile> {
  assertPasswordStrength(newPassword);
  const profile = getProfileById(profileId);
  if (!profile?.passwordHash || !profile.kdfSalt || !profile.wrappedDek) {
    throw new Error("Password not set for this profile");
  }

  const ok = await verifyPassword(currentPassword, profile.passwordHash);
  if (!ok) throw new Error("Current password is incorrect");

  const passwordHash = await hashPassword(newPassword);
  const rewrapped = await rewrapDek(
    profileId,
    currentPassword,
    newPassword,
    profile.kdfSalt,
    profile.wrappedDek,
  );
  const updated = updateProfile(profileId, {
    passwordHash,
    kdfSalt: rewrapped.kdfSalt,
    wrappedDek: rewrapped.wrappedDek,
    dbEncrypted: true,
  });
  return toPublicProfile(updated);
}

/** Lock profile DB after last session ends (logout). */
export async function sealProfileIfIdle(profileId: string): Promise<void> {
  if (countSessionsForProfile(profileId) > 0) return;
  const profile = getProfileById(profileId);
  if (!profile?.passwordHash || !profile.wrappedDek) return;

  await shutdownPrisma();
  await lockProfileDb(profileId);
  updateProfile(profileId, { dbEncrypted: true });
  clearUnlockedDek(profileId);
}

export async function sealAllUnlockedProfiles(): Promise<void> {
  const registry = ensureRegistry();
  await shutdownPrisma();
  for (const profile of registry.profiles) {
    if (profile.passwordHash && profile.wrappedDek) {
      await lockProfileDb(profile.id);
      updateProfile(profile.id, { dbEncrypted: true });
    }
  }
}
