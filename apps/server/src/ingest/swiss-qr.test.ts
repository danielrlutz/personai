import assert from "node:assert/strict";
import { parseSwissQrPayload, isLikelySwissIban } from "./swiss-qr.js";
import {
  expandSegmentsForPhoneScanner,
  mergeContinuationGroups,
  parsePageLabel,
  segmentAfterOcr,
  segmentBlankRunsAfterOcr,
  segmentBulkPages,
  type PreparedPage,
} from "./bulk-split.js";
import { suggestArchiveCategory, suggestArchiveName } from "../specialists/roster.js";
import { archiveTypeToken, normalizeDocumentType } from "../archive/doc-type-tokens.js";
import {
  coerceOcrDateString,
  normalizeStructuredExtraction,
  pickArchiveEntity,
} from "./normalize-extraction.js";

// Fully padded SPC (amount empty / open amount) — Salt Mobile sample shape
const SALT_SPC = [
  "SPC",
  "0200",
  "1",
  "CH973000522810925900C",
  "S",
  "Salt Mobile SA",
  "Avenue de Malley",
  "2",
  "1008",
  "Prilly",
  "CH",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "", // amount open
  "CHF",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "QRR",
  "000000000000000009609378140",
  "",
  "EPD",
].join("\n");

function page(n: number, blank = false): PreparedPage {
  return {
    index: n - 1,
    pageNumber: n,
    file: `page-${String(n).padStart(3, "0")}.png`,
    path: `/tmp/page-${n}.png`,
    blank,
  };
}

const qr = parseSwissQrPayload(SALT_SPC);
assert.ok(qr);
assert.equal(qr.iban, "CH973000522810925900C");
assert.equal(qr.creditorName, "Salt Mobile SA");
assert.equal(qr.currency, "CHF");
assert.equal(qr.reference, "000000000000000009609378140");
assert.equal(qr.referenceType, "QRR");
assert.equal(qr.amount, null);
assert.ok(isLikelySwissIban(qr.iban));

const pages = [page(1), page(2), page(3), page(4, true), page(5), page(6)];
const segs = segmentBulkPages(pages);
assert.equal(segs.length, 2);
assert.deepEqual(
  segs.map((s) => [s.startPage, s.endPage]),
  [
    [1, 3],
    [5, 6],
  ],
);

// Genius Scan must NOT explode related pages by default
const expanded = expandSegmentsForPhoneScanner(segs, {
  pageCount: 6,
  creator: "Genius Scan",
});
assert.equal(expanded.length, 2);
assert.deepEqual(
  expanded.map((s) => [s.startPage, s.endPage]),
  [
    [1, 3],
    [5, 6],
  ],
);

const merged = mergeContinuationGroups(
  [page(1), page(2), page(3)],
  [
    { pageLabel: "Seite 1 von 2" },
    { pageLabel: "Seite 2 von 2" },
    { pageLabel: null },
  ],
);
assert.equal(merged.length, 2);
assert.equal(merged[0]!.endPage, 2);
assert.equal(merged[1]!.startPage, 3);

assert.deepEqual(parsePageLabel("Page 1 of 3"), { part: 1, total: 3 });
assert.deepEqual(parsePageLabel("1/2"), { part: 1, total: 2 });

// Related multipage series without blanks stays together (Genius Scan path)
const related = [page(1), page(2), page(3)];
const relatedKept = segmentAfterOcr(related, [
  { documentType: "BILL", pageLabel: "Seite 1 von 3", creditorName: "Swisscom", hasSwissQrBill: true, iban: "CH9300762011623852957" },
  { documentType: "BILL", pageLabel: "Seite 2 von 3", creditorName: "Swisscom" },
  { documentType: "BILL", pageLabel: "Seite 3 von 3", creditorName: "Swisscom" },
]);
assert.equal(relatedKept.length, 1, "related pages must stay one segment");
assert.equal(relatedKept[0]!.startPage, 1);
assert.equal(relatedKept[0]!.endPage, 3);
assert.equal(relatedKept[0]!.pages.length, 3, "must not drop pages");

// Single Swiss QR / clear single-doc → whole document
const singleQr = segmentAfterOcr(related, [
  { documentType: "OTHER", hasSwissQrBill: true, iban: "CH9300762011623852957", creditorName: "SBB" },
  { documentType: "OTHER", summary: "Fortsetzung" },
  { documentType: "OTHER", summary: "Anhang" },
]);
assert.equal(singleQr.length, 1);

// High-confidence split: two distinct QR bills
const twoBills = segmentAfterOcr(
  [page(1), page(2), page(3), page(4)],
  [
    { documentType: "BILL", hasSwissQrBill: true, iban: "CH9300762011623852957", creditorName: "Swisscom", pageLabel: "Seite 1 von 2" },
    { documentType: "BILL", creditorName: "Swisscom", pageLabel: "Seite 2 von 2" },
    { documentType: "BILL", hasSwissQrBill: true, iban: "CH4431999123000889012", creditorName: "Salt Mobile SA", pageLabel: "Seite 1 von 2" },
    { documentType: "BILL", creditorName: "Salt Mobile SA", pageLabel: "Seite 2 von 2" },
  ],
);
assert.equal(twoBills.length, 2);
assert.deepEqual(
  twoBills.map((s) => [s.startPage, s.endPage]),
  [
    [1, 2],
    [3, 4],
  ],
);

// Blank runs + OCR: pages never dropped
const blankRuns = segmentBulkPages([page(1), page(2), page(3, true), page(4)]);
const byPage = new Map<number, Record<string, unknown>>([
  [1, { documentType: "BILL", hasSwissQrBill: true, iban: "CH9300762011623852957", creditorName: "A" }],
  [2, { documentType: "BILL", creditorName: "A" }],
  [4, { documentType: "OFFICIAL", vendor: "Gemeinde" }],
]);
const afterBlank = segmentBlankRunsAfterOcr(blankRuns, byPage);
const covered = afterBlank.flatMap((s) => s.pages.map((p) => p.pageNumber)).sort((a, b) => a - b);
assert.deepEqual(covered, [1, 2, 4]);

// Archive taxonomy: medical → Health, Behörden → Official, court/contracts → Legal
assert.equal(suggestArchiveCategory("MEDICAL_RECORD"), 6);
assert.equal(suggestArchiveCategory("OFFICIAL"), 1);
assert.equal(suggestArchiveCategory("LEGAL"), 8);
assert.equal(suggestArchiveCategory("CONTRACT"), 8);
assert.equal(suggestArchiveCategory("OTHER"), 9);

// Invoice naming — never BILL in archiveName
assert.equal(normalizeDocumentType("Invoice"), "BILL");
assert.equal(normalizeDocumentType("Rechnung"), "BILL");
assert.equal(archiveTypeToken("BILL"), "Invoice");
assert.equal(archiveTypeToken("Invoice"), "Invoice");
const invoiceName = suggestArchiveName({
  date: "2026-08-10",
  documentType: "BILL",
  entity: "Swisscom",
  extension: ".pdf",
});
assert.equal(invoiceName, "2026-08-10_Invoice_Swisscom.pdf");
assert.ok(!invoiceName.includes("BILL"));
assert.equal(
  suggestArchiveName({
    date: "2026-08-10",
    documentType: "Invoice",
    entity: "Swisscom",
    extension: ".pdf",
  }),
  "2026-08-10_Invoice_Swisscom.pdf",
);

// Entity/date hardening
assert.equal(coerceOcrDateString("10.08.2026"), "2026-08-10");
assert.equal(pickArchiveEntity({ vendor: "Invoice", creditorName: null }), "Unknown");
assert.equal(pickArchiveEntity({ vendor: "Swisscom AG" }), "Swisscom AG");
const norm = normalizeStructuredExtraction({
  documentType: "Rechnung",
  date: "09.08.2026",
  dueDate: "n/a",
  vendor: "Invoice",
  creditorName: "Salt Mobile SA",
});
assert.equal(norm.documentType, "BILL");
assert.equal(norm.date, "2026-08-09");
assert.equal(norm.dueDate, null);
assert.equal(pickArchiveEntity(norm), "Salt Mobile SA");

console.log("swiss-qr + bulk-split + archive-naming checks ok");
