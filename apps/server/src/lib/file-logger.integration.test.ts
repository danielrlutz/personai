import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Fastify from "fastify";
import {
  initFileLogger,
  resolveLogFile,
} from "./file-logger.js";
import { registerFastifyLogging } from "./fastify-logging.js";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "personai-logs-int-"));
const logger = initFileLogger({ logsDir: dir, service: "integration-test" });

const app = Fastify({ logger: false });
registerFastifyLogging(app, logger);

app.get("/ok", async () => ({ ok: true }));
app.get("/boom", async () => {
  throw new Error("integration boom");
});

await app.ready();
await app.inject({ method: "GET", url: "/ok" });
await app.inject({ method: "GET", url: "/boom" });
await app.inject({ method: "GET", url: "/missing-route" });

const errFile = resolveLogFile(dir, "error");
const warnFile = resolveLogFile(dir, "warning");
assert.ok(fs.existsSync(errFile), "error log file exists");
const errLines = fs.readFileSync(errFile, "utf-8").trim().split("\n").filter(Boolean);
const errMessages = errLines.map((l) => JSON.parse(l).message as string);
assert.ok(
  errMessages.some((m) => m.includes("integration boom") || m.includes("Request handler error")),
  "route error logged",
);

const warnLines = fs.existsSync(warnFile)
  ? fs.readFileSync(warnFile, "utf-8").trim().split("\n").filter(Boolean)
  : [];
const warnMessages = warnLines.map((l) => JSON.parse(l).message as string);
assert.ok(warnMessages.some((m) => m.includes("Route not found")), "404 logged");

await app.close();
console.log("file-logger.integration.test.ts OK");
