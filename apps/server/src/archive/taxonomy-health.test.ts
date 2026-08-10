import assert from "node:assert/strict";
import { buildTaxonomyHealthReport, suggestWinnerReason } from "./taxonomy-health.js";

const report = buildTaxonomyHealthReport({
  rootFolderId: "root1",
  children: [
    { id: "pa", name: "01_Official", fileCount: 0 },
    { id: "legacy", name: "1. Official Documents", fileCount: 12 },
    { id: "h", name: "02_Housing", fileCount: 3 },
    { id: "photos", name: "Vacation Photos", fileCount: 40 },
  ],
  cachedFolderIds: { 1: "pa" },
  folderMatchMeta: {
    1: { source: "created", matchedName: "01_Official", at: "2026-01-01T00:00:00.000Z" },
  },
  scannedAt: "2026-08-10T12:00:00.000Z",
});

assert.equal(report.neverDeletesFolders, true);
assert.equal(report.childFolderCount, 4);
assert.equal(report.issues.length, 1);
assert.equal(report.issues[0]!.category, 1);
assert.equal(report.issues[0]!.suggested.id, "legacy");
assert.equal(report.issues[0]!.duplicates.length, 1);
assert.equal(report.issues[0]!.duplicates[0]!.id, "pa");
assert.equal(report.issues[0]!.cachedFolderId, "pa");
assert.equal(report.issues[0]!.cachedMatchesSuggested, false);
assert.match(report.issues[0]!.reason, /More files/);

const official = report.mappings.find((m) => m.category === 1)!;
assert.equal(official.hasDuplicates, true);
assert.equal(official.folderId, "pa");

const housing = report.mappings.find((m) => m.category === 2)!;
assert.equal(housing.hasDuplicates, false);
assert.equal(housing.folderId, "h");

const clean = buildTaxonomyHealthReport({
  rootFolderId: "root1",
  children: [{ id: "legacy", name: "1. Official Documents", fileCount: 12 }],
});
assert.equal(clean.issues.length, 0);
assert.match(clean.note, /No duplicate/);

const reason = suggestWinnerReason(
  1,
  { id: "legacy", name: "1. Official Documents", fileCount: 0, isPersonAiStyle: false },
  [{ id: "pa", name: "01_Official", fileCount: 0, isPersonAiStyle: true }],
);
assert.match(reason, /Legacy/);

console.log("archive taxonomy-health checks ok");
