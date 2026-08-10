import assert from "node:assert/strict";
import {
  banRawEnumsInChatCopy,
  chatFacingDocType,
  extractDriveVocab,
  formatVocabForPrompt,
} from "./chat-vocabulary.js";

const corpus = `
2026-01-10_Invoice_Swisscom.pdf
2026-02-01_Rechnung_CSS.pdf
2025-12-01_BILL_OldLegacy.pdf
folder 4 Financial
`;

const vocab = extractDriveVocab(corpus);
assert.equal(vocab.invoiceLabel, "Invoice");
assert.ok(vocab.docTypeTokens.some((t) => /invoice/i.test(t)));
assert.ok(vocab.docTypeTokens.some((t) => /rechnung/i.test(t)));

assert.equal(chatFacingDocType("BILL", vocab), "Invoice");
assert.equal(chatFacingDocType("BILL", null), "Invoice");
assert.equal(chatFacingDocType("Invoice", vocab), "Invoice");
assert.equal(chatFacingDocType("MEDICAL_RECORD"), "Medical record");

assert.equal(banRawEnumsInChatCopy("File as BILL for Swisscom", vocab), "File as Invoice for Swisscom");
assert.match(formatVocabForPrompt(vocab), /NEVER say BILL/);

const rechnungOnly = extractDriveVocab("2026-03-01_Rechnung_SBB.pdf");
assert.equal(rechnungOnly.invoiceLabel, "Rechnung");
assert.equal(chatFacingDocType("BILL", rechnungOnly), "Rechnung");

console.log("chat-vocabulary.test.ts: ok");
