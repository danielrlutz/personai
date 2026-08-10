/**
 * Run: pnpm --filter @personai/web test
 * (tsx assertion script — matches apps/server test style)
 */
import assert from "node:assert/strict";
import {
  labelForReinspectStatus,
  reinspectJobIdFromPayload,
  reinspectStatusFromPayload,
} from "./reinspect-status.ts";

assert.equal(reinspectStatusFromPayload(null), null);
assert.equal(reinspectStatusFromPayload("flagged"), null);
assert.equal(reinspectStatusFromPayload({}), null);
assert.equal(reinspectStatusFromPayload({ reinspectStatus: "nope" }), null);
assert.equal(reinspectStatusFromPayload({ reinspectStatus: "flagged" }), "flagged");
assert.equal(reinspectStatusFromPayload({ reinspectStatus: "reinspecting" }), "reinspecting");
assert.equal(reinspectStatusFromPayload({ reinspectStatus: "ready" }), "ready");
assert.equal(reinspectStatusFromPayload({ reinspectStatus: "failed" }), "failed");

assert.equal(reinspectJobIdFromPayload(null), null);
assert.equal(reinspectJobIdFromPayload({}), null);
assert.equal(reinspectJobIdFromPayload({ reinspectJobId: 12 }), null);
assert.equal(reinspectJobIdFromPayload({ reinspectJobId: "  " }), null);
assert.equal(reinspectJobIdFromPayload({ reinspectJobId: "job-1" }), "job-1");
assert.equal(reinspectJobIdFromPayload({ reinspectJobId: "  job-2  " }), "job-2");

assert.equal(labelForReinspectStatus("flagged"), "Flagged");
assert.equal(labelForReinspectStatus("reinspecting"), "Reinspecting");
assert.equal(labelForReinspectStatus("ready"), "Ready to review again");
assert.equal(labelForReinspectStatus("failed"), "Reinspect failed");

console.log("reinspect-status.test.ts: ok");
