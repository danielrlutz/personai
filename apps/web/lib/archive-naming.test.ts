import assert from "node:assert/strict";
import {
  buildArchiveName,
  draftFromArchivePayload,
  extensionFromFilename,
  sanitizeArchiveExtension,
} from "./archive-naming.ts";

assert.equal(sanitizeArchiveExtension("png"), ".png");
assert.equal(sanitizeArchiveExtension(".PDF"), ".pdf");
assert.equal(extensionFromFilename("2026-08-09_OTHER_Unknown.png"), ".png");
assert.equal(extensionFromFilename("noext"), ".pdf");

const fromPng = draftFromArchivePayload({
  archiveName: "2026-08-09_OTHER_Unknown.png",
  archiveCategory: 9,
  documentType: "OTHER",
  entity: "Unknown",
  sourceExtension: ".png",
  mimeType: "image/png",
});
assert.equal(fromPng.extension, ".png");
assert.equal(buildArchiveName(fromPng), "2026-08-09_OTHER_Unknown.png");

// Header/summary and preview must not diverge to a fake .pdf.
assert.notEqual(buildArchiveName(fromPng), "2026-08-09_OTHER_Unknown.pdf");

const fromMeta = draftFromArchivePayload({
  archiveName: "broken-name",
  archiveCategory: 4,
  documentType: "BILL",
  entity: "Swisscom",
  sourceExtension: ".pdf",
  mimeType: "application/pdf",
});
assert.equal(fromMeta.docType, "BILL");
assert.equal(fromMeta.entity, "Swisscom");
assert.equal(fromMeta.extension, ".pdf");
assert.equal(buildArchiveName(fromMeta), `${fromMeta.date}_BILL_Swisscom.pdf`);

console.log("web archive-naming consistency checks ok");
