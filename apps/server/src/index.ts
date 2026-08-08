import Fastify from "fastify";
import cors from "@fastify/cors";
import multipart from "@fastify/multipart";
import { config } from "./config.js";
import { registerRoutes } from "./routes/index.js";
import { shutdownPrisma } from "./db/prisma-singleton.js";
import { startIngestionWorker, stopIngestionWorker } from "./ollama/ingestion-worker.js";
import { startBriefingScheduler, stopBriefingScheduler } from "./briefing/briefing-scheduler.js";
import { listProfiles, createProfile, switchProfile } from "./profiles/registry.js";
import fs from "node:fs";

async function bootstrap() {
  fs.mkdirSync(config.dataDir, { recursive: true });

  const registry = listProfiles();
  if (registry.profiles.length === 0) {
    const profile = await createProfile("Default");
    console.log(`[personai] Created default profile: ${profile.id}`);
  } else if (registry.activeProfileId) {
    await switchProfile(registry.activeProfileId);
  }

  const app = Fastify({ logger: true, bodyLimit: 50 * 1024 * 1024 });
  await app.register(cors, { origin: true });
  await app.register(multipart, { limits: { fileSize: 40 * 1024 * 1024 } });
  // Allow empty JSON POSTs (e.g. /briefing/generate)
  app.addContentTypeParser("application/json", { parseAs: "string" }, (req, body, done) => {
    try {
      const json = body && String(body).length > 0 ? JSON.parse(String(body)) : {};
      done(null, json);
    } catch (err) {
      done(err as Error, undefined);
    }
  });
  await registerRoutes(app);

  startIngestionWorker();
  startBriefingScheduler();

  const shutdown = async () => {
    stopIngestionWorker();
    stopBriefingScheduler();
    await shutdownPrisma();
    await app.close();
    process.exit(0);
  };
  process.on("SIGINT", () => void shutdown());
  process.on("SIGTERM", () => void shutdown());

  await app.listen({ port: config.port, host: "0.0.0.0" });
  console.log(`[personai] Server listening on http://0.0.0.0:${config.port}`);
}

bootstrap().catch((err) => {
  console.error(err);
  process.exit(1);
});
