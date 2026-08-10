import assert from "node:assert/strict";
import {
  archiveDatePrefix,
  safeDate,
  safeDateOrNow,
  safeEnum,
  safeFiniteNumber,
  sanitizeArchiveEntity,
  sanitizeExtension,
} from "./safe-data.js";
import { suggestArchiveName } from "../specialists/roster.js";

// —— safeDate: never Invalid Date ——
assert.equal(safeDate(null), null);
assert.equal(safeDate(""), null);
assert.equal(safeDate("Invalid Date"), null);
assert.equal(safeDate("n/a"), null);
assert.equal(safeDate("--"), null);
assert.equal(safeDate("unknown"), null);
assert.equal(safeDate("asap"), null);
assert.ok(safeDate("2026-08-09") instanceof Date);
assert.equal(safeDate("2026-08-09")!.toISOString().slice(0, 10), "2026-08-09");
assert.equal(safeDate(new Date("not a date")), null);
assert.ok(safeDateOrNow("bogus") instanceof Date);
assert.ok(Number.isFinite(safeDateOrNow("bogus").getTime()));

// —— amounts / enums ——
assert.equal(safeFiniteNumber("12.50"), 12.5);
assert.equal(safeFiniteNumber("nope"), null);
assert.equal(safeFiniteNumber(Number.NaN), null);
assert.equal(safeEnum("BILL", ["BILL", "OTHER"] as const, "OTHER"), "BILL");
assert.equal(safeEnum("WAT", ["BILL", "OTHER"] as const, "OTHER"), "OTHER");

// —— archive naming: garbage OCR dates must not become --__OTHER_* ——
const today = new Date().toISOString().slice(0, 10);
assert.equal(archiveDatePrefix("--"), today);
assert.equal(archiveDatePrefix("n/a"), today);
assert.equal(archiveDatePrefix(""), today);
assert.equal(archiveDatePrefix("2024-01-15"), "2024-01-15");

const nameFromGarbage = suggestArchiveName({
  date: "--",
  documentType: "OTHER",
  entity: "Unknown",
  extension: ".png",
});
assert.equal(nameFromGarbage, `${today}_Other_Unknown.png`);
assert.ok(!nameFromGarbage.startsWith("--"));
assert.ok(!nameFromGarbage.includes("__OTHER"));
assert.ok(!nameFromGarbage.includes("BILL"));

const nameEmptyEntity = suggestArchiveName({
  date: "not-a-date",
  documentType: "!!!",
  entity: "@@@",
  extension: "png",
});
assert.equal(nameEmptyEntity, `${today}_Other_Unknown.png`);

assert.equal(
  suggestArchiveName({
    date: "2026-08-10",
    documentType: "BILL",
    entity: "Swisscom",
    extension: ".pdf",
  }),
  "2026-08-10_Invoice_Swisscom.pdf",
);

// CH OCR date form
assert.equal(archiveDatePrefix("10.08.2026"), "2026-08-10");
assert.ok(safeDate("09.08.2026") instanceof Date);

assert.equal(sanitizeArchiveEntity("  "), "Unknown");
assert.equal(sanitizeExtension("png"), ".png");
assert.equal(sanitizeExtension(".pdf"), ".pdf");

// Stress: hammer garbage dueDate/date strings (same path as ingest persistExtraction)
const garbage = [
  "Invalid Date",
  "invalid",
  "--",
  "----",
  "null",
  "undefined",
  "unknown",
  "n/a",
  "Frist bald",
  "32.13.2026",
  {},
  [],
  Number.NaN,
  Number.POSITIVE_INFINITY,
  new Date(Number.NaN),
];
for (const g of garbage) {
  const d = safeDate(g as unknown);
  assert.equal(d, null, `safeDate(${JSON.stringify(g)}) should be null`);
  const prefix = archiveDatePrefix(g as unknown);
  assert.match(prefix, /^\d{4}-\d{2}-\d{2}$/);
  const name = suggestArchiveName({
    date: typeof g === "string" ? g : null,
    documentType: "OTHER",
    entity: "X",
    extension: ".png",
  });
  assert.match(name, /^\d{4}-\d{2}-\d{2}_Other_X\.png$/);
  assert.ok(!name.includes("BILL"));
}

console.log("safe-data + archive-name + garbage-date stress checks ok");
