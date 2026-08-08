#!/usr/bin/env node
/**
 * Tauri beforeDevCommand helper.
 *
 * Default: start Next.js dev (HMR).
 * Fast path: PERSONAI_DEV_STATIC=1 serves prebuilt apps/web/out on :3000
 *            when out/index.html exists (skip Next cold start).
 *
 * Stability: if :3000 is already serving HTTP, keep this process alive and
 * reuse it (avoids EADDRINUSE → beforeDevCommand exit → Tauri killing the UI).
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

function keepAlive(reason) {
  console.log(`[personai] ${reason}`);
  // Tauri ties UI lifetime to beforeDevCommand — never exit while reusing :3000.
  setInterval(() => {}, 1 << 30);
}

async function httpReady(port, path = "/") {
  try {
    const res = await fetch(`http://127.0.0.1:${port}${path}`, {
      signal: AbortSignal.timeout(800),
    });
    // Any HTTP response means something is listening (even 404/500).
    return res.status > 0;
  } catch {
    return false;
  }
}

function run(command, args, opts = {}) {
  const child = spawn(command, args, {
    cwd: root,
    stdio: "inherit",
    shell: process.platform === "win32",
    ...opts,
  });
  child.on("exit", (code, signal) => {
    // If Next dies but :3000 is still served by another process, keep alive
    // so Tauri does not tear down personai-os.exe with 0xffffffff.
    void httpReady(3000).then((ok) => {
      if (ok) {
        keepAlive(
          `Dev server child exited (code=${code ?? "null"}, signal=${signal ?? "null"}); reusing existing :3000`,
        );
        return;
      }
      if (signal) {
        try {
          process.kill(process.pid, signal);
        } catch {
          /* ignore */
        }
      }
      process.exit(code ?? 1);
    });
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

  server.on("error", (err) => {
    if (err && err.code === "EADDRINUSE") {
      void httpReady(port).then((ok) => {
        if (ok) {
          keepAlive(`Port ${port} already in use — reusing existing static/dev server`);
          return;
        }
        console.error(`[personai] Port ${port} in use but not responding:`, err);
        process.exit(1);
      });
      return;
    }
    console.error("[personai] Static server error:", err);
    process.exit(1);
  });

  server.listen(port, "127.0.0.1", () => {
    console.log(
      `[personai] Serving static export ${relative(root, outDir)} at http://127.0.0.1:${port}`,
    );
  });

  const shutdown = () => {
    server.close(() => process.exit(0));
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

async function main() {
  if (await httpReady(3000)) {
    keepAlive("Port 3000 already serving — reusing (skip Next/static spawn)");
    return;
  }

  if (useStatic) {
    serveStatic(3000);
  } else {
    console.log(
      "[personai] Starting Next.js dev (set PERSONAI_DEV_STATIC=1 to serve apps/web/out)",
    );
    run("pnpm", ["--filter", "@personai/web", "dev"]);
  }
}

void main();
