import assert from "node:assert/strict";
import fs from "node:fs";
import fsp from "node:fs/promises";
import { profileDir } from "../config.js";
import {
  appendCorrection,
  buildCorrectionsInjection,
  correctionSignature,
  correctionsPath,
  formatCorrectionLine,
  hashContext,
  listCorrections,
  lookupCorrectionArchiveCategory,
  namingFieldsFromPayload,
  preferredReinspectNeighborRadius,
  recordNamingPatch,
} from "./corrections.js";

const profileId = `corrections-test-${Date.now()}`;
const file = correctionsPath(profileId);

assert.equal(hashContext(["a", "b"]).length, 16);
assert.equal(hashContext(["a", "b"]), hashContext(["A", "B"]));

const naming = namingFieldsFromPayload({
  archiveName: "2026-08-09_Invoice_Swisscom.pdf",
  archiveCategory: 4,
  entity: "Swisscom",
});
assert.equal(naming.entity, "Swisscom");
assert.equal(naming.archiveCategory, 4);
assert.equal(naming.docTypeToken, "Invoice");

const sig = correctionSignature("naming.patch", {
  entity: "Swisscom",
  archiveCategory: 4,
  docTypeToken: "Invoice",
});
assert.equal(typeof sig, "string");
assert.equal(sig.length, 16);

await recordNamingPatch({
  profileId,
  confirmationId: "c1",
  documentId: "d1",
  action: "archive.commit",
  beforePayload: {
    archiveName: "2026-08-09_Invoice_Swisscom.pdf",
    archiveCategory: 9,
    entity: "Swisscom",
  },
  afterPayload: {
    archiveName: "2026-08-09_Invoice_Swisscom.pdf",
    archiveCategory: 4,
    entity: "Swisscom",
  },
});

await recordNamingPatch({
  profileId,
  confirmationId: "c2",
  documentId: "d2",
  action: "archive.commit",
  beforePayload: {
    archiveName: "2026-08-10_Invoice_Swisscom.pdf",
    archiveCategory: 9,
    entity: "Swisscom",
  },
  afterPayload: {
    archiveName: "2026-08-10_Invoice_Swisscom.pdf",
    archiveCategory: 4,
    entity: "Swisscom",
  },
});

assert.ok(fs.existsSync(file));
const listed = await listCorrections(profileId, { limit: 10 });
assert.equal(listed.length, 2);
assert.equal(listed[0]!.kind, "naming.patch");

const learnedCat = await lookupCorrectionArchiveCategory(profileId, "Swisscom");
assert.equal(learnedCat, 4);

const radius = await preferredReinspectNeighborRadius(profileId, {
  entity: "Swisscom",
  docTypeToken: "Invoice",
});
assert.equal(radius, 1);

await appendCorrection(profileId, {
  kind: "reinspect.flag",
  contextHash: hashContext(["d1", "swisscom"]),
  before: {},
  after: {
    status: "flagged",
    entity: "Swisscom",
    docTypeToken: "Invoice",
    documentId: "d1",
  },
});
await appendCorrection(profileId, {
  kind: "reinspect.flag",
  contextHash: hashContext(["d2", "swisscom"]),
  before: {},
  after: {
    status: "flagged",
    entity: "Swisscom",
    docTypeToken: "Invoice",
    documentId: "d2",
  },
});
const radius2 = await preferredReinspectNeighborRadius(profileId, {
  entity: "Swisscom",
  docTypeToken: "Invoice",
});
assert.equal(radius2, 2);

const inject = await buildCorrectionsInjection(profileId, 500);
assert.match(inject, /User corrections/);
assert.match(inject, /Swisscom/);

const line = formatCorrectionLine(listed[0]!);
assert.match(line, /Naming:/);

const noop = await recordNamingPatch({
  profileId,
  confirmationId: "c3",
  beforePayload: {
    archiveName: "2026-08-11_Invoice_Swisscom.pdf",
    archiveCategory: 4,
  },
  afterPayload: {
    archiveName: "2026-08-11_Invoice_Swisscom.pdf",
    archiveCategory: 4,
  },
});
assert.equal(noop, null);

await fsp.rm(profileDir(profileId), { recursive: true, force: true }).catch(() => undefined);
console.log("corrections checks ok");
