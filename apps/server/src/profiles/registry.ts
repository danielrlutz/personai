import fs from "node:fs";
import { randomUUID } from "node:crypto";
import { registryPath, config, profilesDir, profileDir } from "../config.js";
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
  hasPassword: boolean;
  dbEncrypted: boolean;
}

export interface ProfileRegistry {
  activeProfileId: string | null;
  profiles: Profile[];
}

export interface PublicProfileRegistry {
  activeProfileId: string | null;
  profiles: PublicProfile[];
}

function ensureRegistry(): ProfileRegistry {
  fs.mkdirSync(config.dataDir, { recursive: true });
  fs.mkdirSync(profilesDir(), { recursive: true });
  if (!fs.existsSync(registryPath())) {
    const initial: ProfileRegistry = { activeProfileId: null, profiles: [] };
    fs.writeFileSync(registryPath(), JSON.stringify(initial, null, 2), "utf-8");
    return initial;
  }
  return JSON.parse(fs.readFileSync(registryPath(), "utf-8")) as ProfileRegistry;
}

function saveRegistry(registry: ProfileRegistry): void {
  fs.writeFileSync(registryPath(), JSON.stringify(registry, null, 2), "utf-8");
}

export function toPublicProfile(profile: Profile): PublicProfile {
  return {
    id: profile.id,
    name: profile.name,
    avatar: profile.avatar,
    createdAt: profile.createdAt,
    hasPassword: Boolean(profile.passwordHash),
    dbEncrypted: Boolean(profile.dbEncrypted) || dbLooksEncryptedOnDisk(profile.id),
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
  if (profile.passwordHash) {
    throw new Error("Password already set. Use change-password while signed in.");
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
  if (!profile.passwordHash || !profile.kdfSalt || !profile.wrappedDek) {
    throw new Error("Password not set for this profile. Complete setup first.");
  }

  const ok = await verifyPassword(password, profile.passwordHash);
  if (!ok) throw new Error("Invalid password");

  await unlockProfileDb(profileId, password, profile.kdfSalt, profile.wrappedDek);
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
