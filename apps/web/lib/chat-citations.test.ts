import assert from "node:assert/strict";
import {
  collectDisplayCitations,
  parseDocCitations,
  stripDocCitations,
  supportsCiteFromArchive,
} from "./chat-citations.ts";

assert.deepEqual(parseDocCitations("See [@doc:abc|Swisscom bill] please."), [
  { id: "abc", label: "Swisscom bill" },
]);

assert.equal(
  stripDocCitations("See [@doc:abc|Swisscom bill] please.").trim(),
  "See please.",
);

assert.deepEqual(
  collectDisplayCitations("Filed 2026-03-01_BILL_Swisscom.pdf yesterday.", [
    { id: "d1", name: "2026-03-01_BILL_Swisscom.pdf" },
  ]),
  [{ id: "d1", label: "2026-03-01_BILL_Swisscom.pdf" }],
);

assert.equal(supportsCiteFromArchive("legal_aide"), true);
assert.equal(supportsCiteFromArchive("cfo"), true);
assert.equal(supportsCiteFromArchive("medical_integrator"), true);
assert.equal(supportsCiteFromArchive("secretary"), false);

console.log("chat-citations.test.ts: ok");
