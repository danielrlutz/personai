import Fastify from "fastify";
import cors from "@fastify/cors";
import multipart from "@fastify/multipart";
import { config } from "./config.js";
import { registerRoutes } from "./routes/index.js";
import { startIngestionWorker, stopIngestionWorker } from "./ollama/ingestion-worker.js";
import { startBriefingScheduler, stopBriefingScheduler } from "./briefing/briefing-scheduler.js";
import {
  listProfiles,
  createProfile,
  switchProfile,
  sealAllUnlockedProfiles,
  getProfileById,
} from "./profiles/registry.js";
import { registerAuthHook } from "./auth/middleware.js";
import { dbLooksEncryptedOnDisk } from "./auth/crypto-db.js";
import fs from "node:fs";

async function bootstrap() {
  fs.mkdirSync(config.dataDir, { recursive: true });

  // ignoreTrailingSlash: phones / proxies often hit /health/ or /profiles/
  // Do not log request bodies — auth routes carry passwords.
  const app = Fastify({
    logger: {
      level: "info",
      serializers: {
        req(request) {
          return {
            method: request.method,
            url: request.url,
            host: request.hostname,
            remoteAddress: request.ip,
          };
        },
      },
    },
    bodyLimit: 512 * 1024 * 1024,
    ignoreTrailingSlash: true,
  });
  // Reflect request Origin for cross-port clients:
  // - HTTP:  https?://HOST:3000 → http://HOST:4000
  // - HTTPS: https://HOST (Serve :443) → https://HOST:8443 (Serve → :4000)
  // Auth is Bearer (not cookies); credentials:false keeps wildcard-reflect safe.
  await app.register(cors, {
    origin: true,
    credentials: false,
    methods: ["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Accept", "X-Profile-Id", "Authorization"],
    exposedHeaders: ["Content-Type", "Content-Disposition"],
    maxAge: 86400,
  });
  await app.register(multipart, { limits: { fileSize: 512 * 1024 * 1024 } });
  // Allow empty JSON POSTs (e.g. /briefing/generate)
  app.addContentTypeParser("application/json", { parseAs: "string" }, (req, body, done) => {
    try {
      const json = body && String(body).length > 0 ? JSON.parse(String(body)) : {};
      done(null, json);
    } catch (err) {
      done(err as Error, undefined);
    }
  });

  await registerAuthHook(app);
  await registerRoutes(app);

  // Bind early so Tauri health polling (and /health) succeed before profile DB work.
  await app.listen({ port: config.port, host: "0.0.0.0" });
  console.log(`[personai] Server listening on http://0.0.0.0:${config.port}`);

  const registry = listProfiles();
  if (registry.profiles.length === 0) {
    const profile = await createProfile("Default");
    console.log(`[personai] Created default profile: ${profile.id} (password setup required)`);
  } else if (registry.activeProfileId) {
    const active = getProfileById(registry.activeProfileId);
    // Never auto-open an encrypted DB without an authenticated unlock.
    if (active?.passwordHash && (active.dbEncrypted || dbLooksEncryptedOnDisk(active.id))) {
      console.log(
        `[personai] Active profile ${active.id} is encrypted — waiting for password login`,
      );
    } else {
      await switchProfile(registry.activeProfileId);
    }
  }

  startIngestionWorker();
  startBriefingScheduler();

  const shutdown = async () => {
    stopIngestionWorker();
    stopBriefingScheduler();
    await sealAllUnlockedProfiles();
    await app.close();
    process.exit(0);
  };
  process.on("SIGINT", () => void shutdown());
  process.on("SIGTERM", () => void shutdown());
}

bootstrap().catch((err) => {
  console.error(err);
  process.exit(1);
});
