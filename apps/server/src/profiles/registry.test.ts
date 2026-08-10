import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "personai-registry-"));
process.env.DATA_DIR = tmp;

const {
  discoverOrphanProfileDirs,
  listProfiles,
  listPublicProfiles,
  rehydrateRegistryFromDisk,
  setupProfilePassword,
} = await import("./registry.js");

const profileId = randomUUID();
const dir = path.join(tmp, "profiles", profileId);
fs.mkdirSync(dir, { recursive: true });
fs.writeFileSync(path.join(dir, "personai.db.enc"), Buffer.from("sealed-bytes"));

// Empty registry + sealed DB on disk → rehydrate, do not invent Default.
fs.writeFileSync(
  path.join(tmp, "profiles.json"),
  JSON.stringify({ activeProfileId: null, profiles: [] }, null, 2),
);

const orphans = discoverOrphanProfileDirs();
assert.equal(orphans.length, 1);
assert.equal(orphans[0].id, profileId);
assert.equal(orphans[0].hasEnc, true);

const reg = listProfiles();
assert.equal(reg.profiles.length, 1);
assert.equal(reg.profiles[0].id, profileId);
assert.ok(reg.profiles[0].name.startsWith("Recovered "));

// Existing named entry must not be clobbered by rehydrate.
const named = {
  activeProfileId: profileId,
  profiles: [
    {
      id: profileId,
      name: "Daniel Robin Lutz",
      createdAt: "2026-01-01T00:00:00.000Z",
      passwordHash: "keep-me",
      dbEncrypted: true,
    },
  ],
};
fs.writeFileSync(path.join(tmp, "profiles.json"), JSON.stringify(named, null, 2));
const kept = rehydrateRegistryFromDisk(named);
assert.equal(kept.profiles.length, 1);
assert.equal(kept.profiles[0].name, "Daniel Robin Lutz");
assert.equal(kept.profiles[0].passwordHash, "keep-me");

// Sealed stub without unlock material → public needsCryptoRestore; setup refused.
const sealedOnly = {
  activeProfileId: profileId,
  profiles: [
    {
      id: profileId,
      name: "Daniel Robin Lutz",
      createdAt: "2026-01-01T00:00:00.000Z",
      dbEncrypted: true,
    },
  ],
};
fs.writeFileSync(path.join(tmp, "profiles.json"), JSON.stringify(sealedOnly, null, 2));
const pub = listPublicProfiles();
assert.equal(pub.profiles[0].hasPassword, false);
assert.equal(pub.profiles[0].needsCryptoRestore, true);
await assert.rejects(
  () => setupProfilePassword(profileId, "new-password-123"),
  /Unlock keys missing/,
);

fs.rmSync(tmp, { recursive: true, force: true });
console.log("registry bootstrap checks ok");
