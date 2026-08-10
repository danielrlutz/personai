import assert from "node:assert/strict";
import {
  buildArchiveName,
  coerceArchiveDocType,
  draftFromArchivePayload,
  extensionFromFilename,
  sanitizeArchiveExtension,
} from "./archive-naming.ts";

assert.equal(sanitizeArchiveExtension("png"), ".png");
assert.equal(sanitizeArchiveExtension(".PDF"), ".pdf");
assert.equal(extensionFromFilename("2026-08-09_Other_Unknown.png"), ".png");
assert.equal(extensionFromFilename("noext"), ".pdf");

const fromPng = draftFromArchivePayload({
  archiveName: "2026-08-09_Other_Unknown.png",
  archiveCategory: 9,
  documentType: "OTHER",
  entity: "Unknown",
  sourceExtension: ".png",
  mimeType: "image/png",
});
assert.equal(fromPng.extension, ".png");
assert.equal(fromPng.docType, "Other");
assert.equal(buildArchiveName(fromPng), "2026-08-09_Other_Unknown.png");

// Header/summary and preview must not diverge to a fake .pdf.
assert.notEqual(buildArchiveName(fromPng), "2026-08-09_Other_Unknown.pdf");

const fromMeta = draftFromArchivePayload({
  archiveName: "broken-name",
  archiveCategory: 4,
  documentType: "BILL",
  entity: "Swisscom",
  sourceExtension: ".pdf",
  mimeType: "application/pdf",
});
assert.equal(fromMeta.docType, "Invoice");
assert.equal(fromMeta.entity, "Swisscom");
assert.equal(fromMeta.extension, ".pdf");
assert.equal(buildArchiveName(fromMeta), `${fromMeta.date}_Invoice_Swisscom.pdf`);
assert.ok(!buildArchiveName(fromMeta).includes("BILL"));

// Legacy shouty archive names coerce to Drive tokens in the draft
const fromLegacy = draftFromArchivePayload({
  archiveName: "2026-08-10_BILL_Salt_Mobile.pdf",
  archiveCategory: 4,
  documentType: "BILL",
});
assert.equal(fromLegacy.docType, "Invoice");
assert.equal(buildArchiveName(fromLegacy), "2026-08-10_Invoice_Salt_Mobile.pdf");

assert.equal(coerceArchiveDocType("Rechnung"), "Invoice");
assert.equal(coerceArchiveDocType("INVOICE"), "Invoice");
assert.equal(coerceArchiveDocType("Quittance"), "Quittance");

console.log("web archive-naming consistency checks ok");
