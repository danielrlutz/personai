import assert from "node:assert/strict";
import {
  isArchiveRootName,
  matchFolderForCategory,
  normalizeFolderKey,
  personAiStyleFolderName,
  preferFolderAmongDuplicates,
  parseFolderMatchLlmResponse,
} from "./folder-match.js";

// Screenshot-style numbering variants
assert.equal(normalizeFolderKey("01_Official"), "official");
assert.equal(normalizeFolderKey("1. Official Documents"), "official documents");
assert.equal(normalizeFolderKey("01 - Official"), "official");
assert.equal(normalizeFolderKey("02_Housing"), "housing");
assert.equal(normalizeFolderKey("2. Housing"), "housing");
assert.equal(normalizeFolderKey("03_Insurance"), "insurance");
assert.equal(normalizeFolderKey("3. Insurance"), "insurance");
assert.equal(normalizeFolderKey("04_Financial"), "financial");
assert.equal(normalizeFolderKey("4. Financial"), "financial");
assert.equal(normalizeFolderKey("05_Employment"), "employment");
assert.equal(normalizeFolderKey("5. Employment"), "employment");
assert.equal(normalizeFolderKey("06_Health"), "health");
assert.equal(normalizeFolderKey("6. Health"), "health");

// DE / FR variants + umlauts
assert.equal(normalizeFolderKey("01_Behörden"), "behoerden");
assert.equal(normalizeFolderKey("2. Wohnen"), "wohnen");
assert.equal(normalizeFolderKey("3. Versicherung"), "versicherung");
assert.equal(normalizeFolderKey("Assurances"), "assurances");
assert.equal(normalizeFolderKey("Gesundheit"), "gesundheit");

// Root detection
assert.equal(isArchiveRootName("PersonAI_Archive"), true);
assert.equal(isArchiveRootName("Archived Files"), true);
assert.equal(isArchiveRootName("Archiv"), true);
assert.equal(isArchiveRootName("Random Photos"), false);

// Match legacy when PersonAI duplicate also present
const officialMatch = matchFolderForCategory(1, [
  { id: "pa", name: "01_Official", fileCount: 0 },
  { id: "legacy", name: "1. Official Documents", fileCount: 12 },
]);
assert.ok(officialMatch);
assert.equal(officialMatch!.folderId, "legacy");
assert.equal(officialMatch!.source, "reconcile");
assert.equal(officialMatch!.duplicates.length, 1);

// Match DE Versicherung → Insurance
const insuranceDe = matchFolderForCategory(3, [
  { id: "v", name: "3. Versicherung", fileCount: 2 },
]);
assert.ok(insuranceDe);
assert.equal(insuranceDe!.folderId, "v");

// Housing variants
const housing = matchFolderForCategory(2, [
  { id: "h", name: "2. Housing" },
  { id: "pa2", name: "02_Housing", fileCount: 0 },
]);
assert.ok(housing);
assert.equal(housing!.folderId, "h");

// Prefer richer folder among duplicates
const preferred = preferFolderAmongDuplicates(4, [
  { id: "empty", name: "04_Financial", fileCount: 0 },
  { id: "full", name: "4. Financial", fileCount: 8 },
]);
assert.equal(preferred.id, "full");

assert.equal(personAiStyleFolderName(1), "01_Official");
assert.equal(personAiStyleFolderName(9), "09_Misc");

// LLM parse: only allow listed ids
const allowed = new Set(["abc", "def"]);
assert.equal(parseFolderMatchLlmResponse('{"folderId":"abc","reason":"ok"}', allowed), "abc");
assert.equal(parseFolderMatchLlmResponse('{"folderId":"zzz","reason":"no"}', allowed), null);
assert.equal(parseFolderMatchLlmResponse("no json here", allowed), null);
assert.equal(
  parseFolderMatchLlmResponse('Here:\n{"folderId":null,"reason":"none"}', allowed),
  null,
);

// No false match for unrelated folder
const noMatch = matchFolderForCategory(6, [{ id: "x", name: "Vacation Photos 2024" }]);
assert.equal(noMatch, null);

console.log("archive folder-match checks ok");
