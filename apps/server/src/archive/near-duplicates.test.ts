import assert from "node:assert/strict";
import {
  dayDelta,
  normalizeEntityKey,
  parseArchiveName,
  scoreNearDuplicate,
  NEAR_DUP_MIN_SCORE,
} from "./near-duplicates.js";

assert.equal(normalizeEntityKey("Swisscom AG"), "swisscomag");
assert.equal(normalizeEntityKey("swisscom_ag"), "swisscomag");

const parsed = parseArchiveName("2026-08-01_BILL_Swisscom.pdf");
assert.equal(parsed.date, "2026-08-01");
assert.equal(parsed.docType, "BILL");
assert.equal(parsed.entity, "Swisscom");

assert.equal(dayDelta("2026-08-08", "2026-08-01"), 7);
assert.equal(dayDelta("2026-08-01", "2026-08-08"), -7);

const exact = scoreNearDuplicate(
  { date: "2026-08-01", docType: "BILL", entity: "Swisscom" },
  {
    archiveName: "2026-08-01_BILL_Swisscom.pdf",
    documentId: "doc1",
    confirmedAt: "2026-08-02T10:00:00.000Z",
  },
);
assert.ok(exact);
assert.equal(exact!.score, 100);
assert.ok(exact!.reasons.some((r) => /exact/i.test(r)));

const windowHit = scoreNearDuplicate(
  { date: "2026-08-08", docType: "BILL", entity: "Swisscom", windowDays: 7 },
  {
    archiveName: "2026-08-01_BILL_Swisscom.pdf",
    documentId: "doc2",
  },
);
assert.ok(windowHit);
assert.ok(windowHit!.score >= NEAR_DUP_MIN_SCORE);
assert.equal(windowHit!.dayDelta, -7);

const outside = scoreNearDuplicate(
  { date: "2026-09-01", docType: "BILL", entity: "Swisscom", windowDays: 7 },
  { archiveName: "2026-08-01_BILL_Swisscom.pdf", documentId: "doc3" },
);
assert.equal(outside, null);

const unrelated = scoreNearDuplicate(
  { date: "2026-08-01", docType: "BILL", entity: "Swisscom" },
  { archiveName: "2026-08-01_BILL_Sunrise.pdf", documentId: "doc4" },
);
assert.equal(unrelated, null);

const similarEntity = scoreNearDuplicate(
  { date: "2026-08-01", docType: "BILL", entity: "CSS Versicherung" },
  { archiveName: "2026-08-02_BILL_CSS.pdf", documentId: "doc5" },
);
assert.ok(similarEntity);
assert.ok(similarEntity!.score >= NEAR_DUP_MIN_SCORE);

console.log("archive near-duplicate radar checks ok");
