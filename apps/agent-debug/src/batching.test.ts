import assert from "node:assert/strict";
import { detectWaitSignal, looksLikeFollowUp } from "./batching.js";

assert.equal(detectWaitSignal("wait for pictures in my second message").awaitingMore, true);
assert.equal(detectWaitSignal("send now please").flushNow, true);
assert.equal(detectWaitSignal("fix the login bug").awaitingMore, false);
assert.equal(looksLikeFollowUp("", 1), true);
assert.equal(looksLikeFollowUp("here you go", 1), true);
assert.equal(looksLikeFollowUp("rewrite the README", 0), false);

console.log("batching.test.ts: ok");
