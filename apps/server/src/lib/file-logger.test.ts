import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  createFileLogger,
  ensureLogDirs,
  resolveLogFile,
} from "./file-logger.js";

function tempLogsDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "personai-logs-"));
}

function readLines(filePath: string): string[] {
  return fs.readFileSync(filePath, "utf-8").trim().split("\n").filter(Boolean);
}

// —— directory layout ——
const dir = tempLogsDir();
ensureLogDirs(dir);
assert.ok(fs.existsSync(path.join(dir, "info")));
assert.ok(fs.existsSync(path.join(dir, "warning")));
assert.ok(fs.existsSync(path.join(dir, "error")));

// —— level routing ——
const logger = createFileLogger({ logsDir: dir, service: "test-service" });
logger.info("hello info", { route: "/health" });
logger.warning("slow query", { ms: 900 });
logger.error("boom", { status: 500 }, new Error("kaputt"));

const infoFile = resolveLogFile(dir, "info");
const warnFile = resolveLogFile(dir, "warning");
const errFile = resolveLogFile(dir, "error");

assert.ok(fs.existsSync(infoFile));
assert.ok(fs.existsSync(warnFile));
assert.ok(fs.existsSync(errFile));

const infoEntry = JSON.parse(readLines(infoFile)[0]!);
const warnEntry = JSON.parse(readLines(warnFile)[0]!);
const errEntry = JSON.parse(readLines(errFile)[0]!);

assert.equal(infoEntry.level, "info");
assert.equal(infoEntry.service, "test-service");
assert.equal(infoEntry.message, "hello info");
assert.equal(infoEntry.context.route, "/health");

assert.equal(warnEntry.level, "warning");
assert.equal(warnEntry.message, "slow query");

assert.equal(errEntry.level, "error");
assert.equal(errEntry.message, "boom");
assert.match(String(errEntry.stack), /kaputt/);

// —— redaction ——
logger.error("auth fail", { password: "secret123", token: "abc", ok: true });
const errLines = readLines(errFile);
const redacted = JSON.parse(errLines[errLines.length - 1]!);
assert.equal(redacted.context.password, "[redacted]");
assert.equal(redacted.context.token, "[redacted]");
assert.equal(redacted.context.ok, true);

console.log("file-logger.test.ts OK");
