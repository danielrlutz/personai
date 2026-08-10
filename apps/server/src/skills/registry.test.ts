import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  clampSkillChars,
  DEFAULT_MAX_SKILL_CHARS,
  MAX_SKILL_CHARS_CAP,
  MIN_SKILL_CHARS,
  renderSkillMarkdown,
  slugifySkillDir,
} from "./registry.js";

assert.equal(slugifySkillDir("Hotel Scout"), "hotel-scout");
assert.equal(slugifySkillDir("  Legal!!Tone  "), "legal-tone");
assert.equal(slugifySkillDir("@@@"), "custom-skill");

assert.equal(clampSkillChars(undefined), DEFAULT_MAX_SKILL_CHARS);
assert.equal(clampSkillChars(10), MIN_SKILL_CHARS);
assert.equal(clampSkillChars(99999), MAX_SKILL_CHARS_CAP);
assert.equal(clampSkillChars(800), 800);

const md = renderSkillMarkdown({
  name: "demo",
  description: "Demo skill",
  specialists: ["secretary", "cfo"],
  body: "1. Do the thing.\n2. Wait for confirm.",
});
assert.match(md, /^---\n/);
assert.match(md, /name: demo/);
assert.match(md, /specialists: \[secretary, cfo\]/);
assert.match(md, /Do the thing/);

const { loadSkills, invalidateSkillsCache } = await import("./registry.js");
invalidateSkillsCache();
const skills = loadSkills(true);
assert.ok(skills.length >= 1, "expected at least one builtin skill");
assert.ok(skills.every((s) => s.name && s.dirName && s.body));

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "personai-skills-"));
const dir = path.join(tmp, "demo-skill");
fs.mkdirSync(dir);
fs.writeFileSync(path.join(dir, "SKILL.md"), md, "utf8");
assert.ok(fs.existsSync(path.join(dir, "SKILL.md")));
fs.rmSync(tmp, { recursive: true, force: true });

console.log("skills/registry.test.ts: ok");
