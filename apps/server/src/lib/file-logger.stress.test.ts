import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createFileLogger, resolveLogFile } from "./file-logger.js";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "personai-logs-stress-"));
const logger = createFileLogger({ logsDir: dir, service: "stress" });

const perLevel = 200;
const workers = Array.from({ length: perLevel }, (_, i) =>
  Promise.all([
    Promise.resolve().then(() => logger.info(`info-${i}`, { i })),
    Promise.resolve().then(() => logger.warning(`warn-${i}`, { i })),
    Promise.resolve().then(() => logger.error(`err-${i}`, { i }, new Error(`e-${i}`))),
  ]),
);

await Promise.all(workers);

for (const level of ["info", "warning", "error"] as const) {
  const file = resolveLogFile(dir, level);
  const lines = fs.readFileSync(file, "utf-8").trim().split("\n").filter(Boolean);
  assert.equal(lines.length, perLevel, `${level} count`);
  const parsed = lines.map((l) => JSON.parse(l));
  assert.ok(parsed.every((e) => e.level === level));
  assert.ok(parsed.every((e) => e.service === "stress"));
}

console.log(`file-logger.stress.test.ts OK (${perLevel * 3} writes)`);
