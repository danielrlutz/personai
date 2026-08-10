import assert from "node:assert/strict";
import {
  accumulateTerminology,
  detectFolderNumberingStyle,
  formatNamingMuscle,
  tokenizeFilename,
} from "./terminology.js";

assert.equal(detectFolderNumberingStyle("01_Official"), "01_Label");
assert.equal(detectFolderNumberingStyle("1. Official Documents"), "1. Label");
assert.equal(detectFolderNumberingStyle("01 - Insurance"), "01 - Label");

const personAi = tokenizeFilename("2026-03-01_BILL_Swisscom.pdf");
assert.equal(personAi.date, "2026-03-01");
assert.equal(personAi.docTypeCanonical, "BILL");
assert.equal(personAi.entity, "Swisscom");

const invoice = tokenizeFilename("Invoice_Swisscom_2026-01-15.pdf");
assert.equal(invoice.docTypeCanonical, "BILL");
assert.ok(invoice.entity?.toLowerCase().includes("swisscom"));

const terms = accumulateTerminology([
  { name: "Invoice_AXA_2026-02-01.pdf", folderLabel: "1. Official Documents" },
  { name: "2026-02-01_BILL_AXA.pdf", folderLabel: "1. Official Documents" },
  { name: "Rechnung_CSS.pdf", folderLabel: "03_Insurance" },
]);
assert.ok(terms.some((t) => t.kind === "doc_type" && t.token.includes("BILL")));
assert.ok(terms.some((t) => t.kind === "folder_style"));

const muscle = formatNamingMuscle(terms);
assert.ok(muscle.includes("Drive naming muscle"));
assert.ok(muscle.includes("BILL"));

console.log("drive-knowledge terminology checks ok");
