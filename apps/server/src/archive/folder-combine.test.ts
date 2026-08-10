import assert from "node:assert/strict";
import {
  nextAutoRename,
  nextKeptAsideName,
  resolveDecision,
  splitFileName,
} from "./folder-combine-logic.js";

assert.deepEqual(splitFileName("report.pdf", false), { base: "report", ext: ".pdf" });
assert.deepEqual(splitFileName("archive", false), { base: "archive", ext: "" });
assert.deepEqual(splitFileName("01_Official", true), { base: "01_Official", ext: "" });

const taken = new Set(["report.pdf", "report (1).pdf"]);
assert.equal(nextAutoRename("report.pdf", taken, false), "report (2).pdf");
assert.equal(nextAutoRename("fresh.txt", taken, false), "fresh.txt");
assert.equal(nextAutoRename("Notes", new Set(["Notes", "Notes (1)"]), true), "Notes (2)");

assert.equal(
  nextKeptAsideName("report.pdf", new Set(["report.pdf"]), false),
  "report (kept 1).pdf",
);
assert.equal(
  nextKeptAsideName("report.pdf", new Set(["report.pdf", "report (kept 1).pdf"]), false),
  "report (kept 2).pdf",
);

assert.equal(resolveDecision(true, undefined), "keep_both");
assert.equal(resolveDecision(true, { action: "skip" }), "skip");
assert.equal(resolveDecision(true, { action: "keep_destination" }), "keep_destination");
assert.equal(resolveDecision(true, { action: "keep_incoming", trashOther: true }), "keep_incoming");
assert.equal(resolveDecision(false, { action: "skip" }), "keep_both");

console.log("folder-combine.test.ts: ok");
