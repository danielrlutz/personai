import assert from "node:assert/strict";
import {
  buildManifest,
  encodePayload,
  fileEntry,
  openSuitcase,
  sealSuitcase,
} from "./format.js";

const files = [
  fileEntry("personai.db", Buffer.from("sqlite-bytes-demo")),
  fileEntry("profile.json", Buffer.from(JSON.stringify({ name: "Demo" }), "utf8")),
  fileEntry("archive/01_Official/2026-01-01_BILL_Test.pdf", Buffer.from("%PDF-demo")),
];

const manifest = buildManifest({
  profileName: "Demo",
  sourceProfileId: "profile-demo",
  includesArchive: true,
  files,
});
assert.equal(manifest.kind, "personai-suitcase-v1");
assert.equal(manifest.files.length, 3);

const payload = encodePayload(manifest, files);
const password = "correct-horse-battery";
const sealed = await sealSuitcase(payload, password);
assert.ok(sealed.length > 32);
assert.equal(sealed.subarray(0, 4).toString("utf8"), "PAS1");

const opened = await openSuitcase(sealed, password);
assert.equal(opened.manifest.profileName, "Demo");
assert.equal(opened.manifest.sourceProfileId, "profile-demo");
assert.equal(opened.files.length, 3);
assert.equal(
  opened.files.find((f) => f.path === "personai.db")?.data.toString("utf8"),
  "sqlite-bytes-demo",
);

let rejected = false;
try {
  await openSuitcase(sealed, "wrong-password-here");
} catch {
  rejected = true;
}
assert.equal(rejected, true);

console.log("suitcase/format.test.ts: ok");
