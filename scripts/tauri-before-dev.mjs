#!/usr/bin/env node
/**
 * Tauri beforeDevCommand helper.
 *
 * Default: start Next.js dev (HMR).
 * Fast path: PERSONAI_DEV_STATIC=1 serves prebuilt apps/web/out on :3000
 *            when out/index.html exists (skip Next cold start).
 *
 * Usage:
 *   PERSONAI_DEV_STATIC=1 pnpm tauri:dev
 *   pnpm tauri:dev:fast   # builds web if needed, then static serve
 */
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { existsSync, readFileSync, statSync } from "node:fs";
import { extname, join, normalize, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const outDir = join(root, "apps/web/out");
const useStatic =
  process.env.PERSONAI_DEV_STATIC === "1" ||
  process.env.PERSONAI_DEV_STATIC === "true";

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".webp": "image/webp",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".txt": "text/plain; charset=utf-8",
  ".map": "application/json",
};

function run(command, args, opts = {}) {
  const child = spawn(command, args, {
    cwd: root,
    stdio: "inherit",
    shell: process.platform === "win32",
    ...opts,
  });
  child.on("exit", (code, signal) => {
    if (signal) process.kill(process.pid, signal);
    process.exit(code ?? 1);
  });
  return child;
}

function serveStatic(port = 3000) {
  const indexHtml = join(outDir, "index.html");
  if (!existsSync(indexHtml)) {
    console.error(
      `[personai] PERSONAI_DEV_STATIC set but ${relative(root, indexHtml)} missing.\n` +
        `Run: pnpm build:web`,
    );
    process.exit(1);
  }

  const server = createServer((req, res) => {
    try {
      const url = new URL(req.url ?? "/", `http://127.0.0.1:${port}`);
      let pathname = decodeURIComponent(url.pathname);
      if (pathname.endsWith("/")) pathname = `${pathname}index.html`;

      const filePath = normalize(join(outDir, pathname));
      if (!filePath.startsWith(outDir)) {
        res.writeHead(403).end("Forbidden");
        return;
      }

      let target = filePath;
      if (!existsSync(target) || statSync(target).isDirectory()) {
        const withIndex = join(filePath, "index.html");
        if (existsSync(withIndex)) target = withIndex;
        else if (existsSync(join(outDir, "404.html"))) target = join(outDir, "404.html");
        else {
          res.writeHead(404).end("Not found");
          return;
        }
      }

      const body = readFileSync(target);
      res.writeHead(200, {
        "Content-Type": MIME[extname(target)] ?? "application/octet-stream",
        "Cache-Control": "no-store",
      });
      res.end(body);
    } catch (err) {
      res.writeHead(500).end(String(err));
    }
  });

  server.listen(port, "127.0.0.1", () => {
    console.log(`[personai] Serving static export ${relative(root, outDir)} at http://127.0.0.1:${port}`);
  });

  const shutdown = () => {
    server.close(() => process.exit(0));
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

if (useStatic) {
  serveStatic(3000);
} else {
  console.log("[personai] Starting Next.js dev (set PERSONAI_DEV_STATIC=1 to serve apps/web/out)");
  run("pnpm", ["--filter", "@personai/web", "dev"]);
}
