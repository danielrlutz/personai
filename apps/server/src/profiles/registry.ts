import fs from "node:fs";
import { randomUUID } from "node:crypto";
import { registryPath, config, profilesDir, profileDir } from "../config.js";
import { getPrisma, shutdownPrisma } from "../db/prisma-singleton.js";

export interface Profile {
  id: string;
  name: string;
  avatar?: string;
  createdAt: string;
}

export interface ProfileRegistry {
  activeProfileId: string | null;
  profiles: Profile[];
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

export function listProfiles(): ProfileRegistry {
  return ensureRegistry();
}

export async function createProfile(name: string, avatar?: string): Promise<Profile> {
  const registry = ensureRegistry();
  const profile: Profile = {
    id: randomUUID(),
    name,
    avatar,
    createdAt: new Date().toISOString(),
  };
  registry.profiles.push(profile);
  if (!registry.activeProfileId) {
    registry.activeProfileId = profile.id;
  }
  saveRegistry(registry);
  fs.mkdirSync(profileDir(profile.id), { recursive: true });
  await getPrisma(profile.id);
  return profile;
}

export async function switchProfile(profileId: string): Promise<Profile> {
  const registry = ensureRegistry();
  const profile = registry.profiles.find((p) => p.id === profileId);
  if (!profile) {
    throw new Error(`Profile not found: ${profileId}`);
  }
  await shutdownPrisma();
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

export function requireProfileId(headerValue?: string): string {
  if (headerValue) return headerValue;
  const active = getActiveProfile();
  if (!active) {
    throw new Error("No active profile. Create or switch to a profile first.");
  }
  return active.id;
}
