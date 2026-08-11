import assert from "node:assert/strict";
import fs from "node:fs";
import { profileDir, profileMemoryDir } from "../config.js";
import { formatSnippetsForPrompt, type MemorySnippet } from "./rag-lite.js";
import {
  loadStagingForPrompt,
  stagingHasSubstance,
  writeStagingDoc,
} from "./staging.js";

const profileId = `staging-test-${Date.now()}`;

assert.equal(stagingHasSubstance("# USER\n\n", "USER"), false);
assert.equal(
  stagingHasSubstance(
    `# USER

Who you are — name, location (e.g. Example City), household, work context.

Edit freely. PersonAI injects a truncated slice into Staff and specialist chats.
`,
    "USER",
  ),
  false,
);
assert.equal(
  stagingHasSubstance(
    `# USER

Alex · Example City · hotel budget usually ≤ CHF 180 when traveling for work.
`,
    "USER",
  ),
  true,
);

await writeStagingDoc(
  profileId,
  "preferences",
  `# Preferences

- Hotel budget ≤ CHF 180
- Prefer Example City area for meetings
`,
);

const loaded = await loadStagingForPrompt(profileId);
assert.ok(loaded.totalInjected > 0, "expected preferences to inject");
assert.ok(loaded.block.includes("Hotel budget"), loaded.block);
assert.ok(loaded.slices.some((s) => s.id === "preferences"));

const snippets: MemorySnippet[] = [
  {
    source: "staging",
    ref: "preferences",
    label: "preferences.md",
    text: "Hotel budget ≤ CHF 180",
    score: 3,
  },
];
const formatted = formatSnippetsForPrompt(snippets, 500);
assert.match(formatted, /Hotel budget/);
assert.match(formatted, /staging:preferences\.md/);

fs.rmSync(profileMemoryDir(profileId), { recursive: true, force: true });
fs.rmSync(profileDir(profileId), { recursive: true, force: true });

console.log("staging.test.ts: ok");
