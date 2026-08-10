import assert from "node:assert/strict";
import {
  collectReplyCitations,
  formatCitableDocsBlock,
  matchMentionedCitables,
  parseDocCitations,
  type CitableDoc,
} from "./citable-docs.js";

const docs: CitableDoc[] = [
  {
    id: "doc_swisscom",
    name: "2026-03-01_BILL_Swisscom.pdf",
    category: 4,
    documentType: "BILL",
  },
  {
    id: "doc_ahv",
    name: "2025-11-12_LETTER_AHV.pdf",
    category: 1,
    documentType: "LETTER",
  },
];

assert.deepEqual(parseDocCitations("See [@doc:doc_swisscom|Swisscom bill] for amount."), [
  { id: "doc_swisscom", label: "Swisscom bill" },
]);

assert.deepEqual(
  parseDocCitations(
    "A [@doc:doc_swisscom|Swisscom] and B [@doc:doc_ahv|AHV] and again [@doc:doc_swisscom|dup].",
  ),
  [
    { id: "doc_swisscom", label: "Swisscom" },
    { id: "doc_ahv", label: "AHV" },
  ],
);

assert.deepEqual(parseDocCitations("No citations here."), []);

assert.deepEqual(
  matchMentionedCitables("I filed 2026-03-01_BILL_Swisscom.pdf last week.", docs),
  [{ id: "doc_swisscom", label: "2026-03-01_BILL_Swisscom.pdf" }],
);

const collected = collectReplyCitations(
  "Based on [@doc:doc_ahv|AHV letter] and 2026-03-01_BILL_Swisscom.pdf",
  docs,
);
assert.equal(collected.length, 2);
assert.equal(collected[0]?.id, "doc_ahv");
assert.equal(collected[1]?.id, "doc_swisscom");

const block = formatCitableDocsBlock(docs);
assert.match(block, /\[@doc:ID\|short-label\]/);
assert.match(block, /id=doc_swisscom/);
assert.match(formatCitableDocsBlock([]), /none yet/);

console.log("citable-docs.test.ts: ok");
