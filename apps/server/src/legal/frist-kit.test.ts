import assert from "node:assert/strict";
import {
  buildFristKitChecklist,
  buildFristKitPayload,
  buildFristKitTitle,
  buildLegalAideDeepLink,
  fristDay,
} from "./frist-kit.js";

assert.equal(fristDay("2026-09-01T12:00:00.000Z"), "2026-09-01");
assert.equal(fristDay("nope"), null);

assert.equal(
  buildFristKitTitle({ archiveName: "2026-08-10_COURT_Bern.pdf", deadline: "2026-09-01" }),
  "Deadline (Frist): 2026-08-10_COURT_Bern.pdf",
);

const payload = buildFristKitPayload({
  archiveName: "2026-08-10_COURT_Bern.pdf",
  deadline: "2026-09-01",
  documentId: "doc_1",
});
assert.equal(payload.deadline, "2026-09-01");
assert.ok(payload.checklist.includes("Deadline (Frist): 2026-09-01"));
assert.ok(payload.checklist.includes("do not invent"));
assert.ok(payload.teamHref.includes("/team/?specialist=legal_aide&q="));
assert.ok(decodeURIComponent(payload.teamHref).includes("Next actions checklist"));

assert.throws(() => buildFristKitPayload({ archiveName: "x.pdf" }), /deadline/i);

const href = buildLegalAideDeepLink(
  buildFristKitChecklist({
    title: "Frist",
    deadline: "2026-09-01",
  }),
);
assert.ok(href.startsWith("/team/?specialist=legal_aide&q="));

console.log("legal/frist-kit.test.ts: ok");
