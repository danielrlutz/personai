#!/usr/bin/env node
/**
 * Fastest desktop startup path:
 * 1) ensure server dist exists (reuse if present)
 * 2) ensure web static export exists (reuse if present, else build)
 * 3) cargo tauri dev with PERSONAI_DEV_STATIC=1 (no Next cold start)
 */
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const serverEntry = join(root, "apps/server/dist/index.js");
const webIndex = join(root, "apps/web/out/index.html");

function run(command, args) {
  const result = spawnSync(command, args, {
    cwd: root,
    stdio: "inherit",
    shell: process.platform === "win32",
    env: process.env,
  });
  if (result.status !== 0) process.exit(result.status ?? 1);
}

if (!existsSync(serverEntry)) {
  console.log("[personai] Building server dist (one-time / missing)...");
  run("pnpm", ["build:server"]);
} else {
  console.log("[personai] Reusing apps/server/dist");
}

if (!existsSync(webIndex)) {
  console.log("[personai] Building web static export (missing out/)...");
  run("pnpm", ["build:web"]);
} else {
  console.log("[personai] Reusing apps/web/out (set FORCE_WEB_BUILD=1 to rebuild)");
  if (process.env.FORCE_WEB_BUILD === "1") {
    run("pnpm", ["build:web"]);
  }
}

process.env.PERSONAI_DEV_STATIC = "1";
run("pnpm", ["tauri:dev"]);
