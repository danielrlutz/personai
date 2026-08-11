import assert from "node:assert/strict";
import { batchLifecycle } from "./lifecycle.js";
import type { Batch } from "./types.js";

function baseBatch(overrides: Partial<Batch> = {}): Batch {
  return {
    id: "batch-1",
    sessionId: "sess",
    state: "ready",
    messageIds: ["m1"],
    urgent: false,
    awaitingReason: null,
    awaitingUntil: null,
    composedPrompt: "test prompt",
    composeError: null,
    createdAt: "2026-08-11T10:00:00.000Z",
    readyAt: "2026-08-11T10:00:01.000Z",
    composedAt: "2026-08-11T10:00:01.000Z",
    dispatchedAt: null,
    cursorAgentId: null,
    cursorRunId: null,
    ackedAt: null,
    ackReason: null,
    deployStatus: "none",
    deployNote: null,
    deployedAt: null,
    ...overrides,
  };
}

assert.equal(batchLifecycle(baseBatch()).current, "ready");
assert.equal(batchLifecycle(baseBatch()).dismissSafety, "caution");

const prompted = batchLifecycle(
  baseBatch({ cursorAgentId: "agent-abc", cursorRunId: "run-xyz" }),
);
assert.equal(prompted.current, "dispatched");
assert.match(prompted.headline, /Cursor/i);
assert.equal(prompted.dismissSafety, "caution");

const live = batchLifecycle(
  baseBatch({
    cursorAgentId: "agent-abc",
    dispatchedAt: "2026-08-11T10:01:00.000Z",
    deployStatus: "live",
    deployedAt: "2026-08-11T10:05:00.000Z",
  }),
);
assert.equal(live.current, "deployed");
assert.equal(live.dismissSafety, "safe");

console.log("lifecycle.test.ts ok");
