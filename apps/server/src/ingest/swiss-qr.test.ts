import assert from "node:assert/strict";
import { parseSwissQrPayload, isLikelySwissIban } from "./swiss-qr.js";
import {
  expandSegmentsForPhoneScanner,
  mergeContinuationGroups,
  segmentBulkPages,
  type PreparedPage,
} from "./bulk-split.js";

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

const expanded = expandSegmentsForPhoneScanner(segs, {
  pageCount: 6,
  creator: "Genius Scan",
});
assert.equal(expanded.length, 5);

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

console.log("swiss-qr + bulk-split checks ok");
