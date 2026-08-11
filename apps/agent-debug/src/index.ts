import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import cors from "@fastify/cors";
import multipart from "@fastify/multipart";
import fastifyStatic from "@fastify/static";
import Fastify from "fastify";
import { config } from "./config.js";
import { registerRoutes } from "./routes.js";
import { store } from "./store.js";
import { startWorker, stopWorker } from "./worker.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function main(): Promise<void> {
  await store.init();

  const app = Fastify({
    logger: true,
    bodyLimit: 25 * 1024 * 1024,
  });

  await app.register(cors, { origin: true });
  await app.register(multipart, {
    limits: { fileSize: 20 * 1024 * 1024, files: 8 },
  });

  await registerRoutes(app);

  const publicCandidates = [
    path.join(__dirname, "public"),
    path.join(__dirname, "..", "public"),
    path.resolve("public"),
  ];
  const publicDir = publicCandidates.find((p) =>
    fs.existsSync(path.join(p, "index.html")),
  );
  if (publicDir) {
    await app.register(fastifyStatic, {
      root: publicDir,
      prefix: "/",
    });
  } else {
    app.log.warn("static UI public/ not found — API-only mode");
  }

  startWorker();

  await app.listen({ port: config.port, host: config.host });
  app.log.info(
    `agent-debug listening on http://${config.host}:${config.port} (auth=${config.token ? "token" : "off"})`,
  );

  const shutdown = async () => {
    stopWorker();
    await app.close();
    process.exit(0);
  };
  process.on("SIGINT", () => void shutdown());
  process.on("SIGTERM", () => void shutdown());
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
