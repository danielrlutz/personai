import assert from "node:assert/strict";
import {
  MODEL_DEFAULTS,
  MODEL_ROLE_CANDIDATES,
} from "../specialists/model-catalog.js";
import { SERVER_JOB_CONFIRM_REINSPECT } from "./reinspect.js";

assert.equal(SERVER_JOB_CONFIRM_REINSPECT, "confirm.reinspect");
assert.equal(MODEL_DEFAULTS.reinspectModel, "deepseek-r1:14b");
assert.equal(MODEL_DEFAULTS.reasoningModel, "deepseek-r1:8b");
assert.equal(MODEL_ROLE_CANDIDATES.reinspect[0], "deepseek-r1:14b");
console.log("confirm/reinspect.test.ts: ok");
