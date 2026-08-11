import assert from "node:assert/strict";
import {
  assertProfileName,
  getProfileNameLimits,
  resolveProfileNameMaxLength,
  validateProfileName,
} from "./name-limits.js";

const prev = process.env.PROFILE_NAME_MAX_LENGTH;
delete process.env.PROFILE_NAME_MAX_LENGTH;

assert.equal(resolveProfileNameMaxLength(), 12);
assert.equal(getProfileNameLimits().maxLength, 12);

assert.deepEqual(validateProfileName("Alex"), { ok: true, trimmed: "Alex" });
assert.equal(validateProfileName("   ").ok, false);

const long = "a".repeat(13);
assert.equal(validateProfileName(long).ok, false);

process.env.PROFILE_NAME_MAX_LENGTH = "8";
assert.equal(resolveProfileNameMaxLength(), 8);
assert.throws(() => assertProfileName("123456789"), /at most 8/);

process.env.PROFILE_NAME_MAX_LENGTH = "999";
assert.equal(resolveProfileNameMaxLength(), 32);

if (prev === undefined) delete process.env.PROFILE_NAME_MAX_LENGTH;
else process.env.PROFILE_NAME_MAX_LENGTH = prev;

console.log("profile name limits ok");
