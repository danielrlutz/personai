import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { FastifyInstance } from "fastify";
import { requireToken } from "./auth.js";
import { config } from "./config.js";
import { replayUndispatchedReadyBatches } from "./dispatch/cursor-sdk-bridge.js";
import {
  ack,
  composeNow,
  enrichMessages,
  getStatus,
  listArchive,
  listPending,
  markDeployed,
  postMessage,
} from "./inbox.js";
import { ollamaTags } from "./ollama.js";
import { store } from "./store.js";

function mediaUrl(absPath: string | null | undefined): string | null {
  if (!absPath) return null;
  const uploads = path.resolve(config.uploadsDir);
  const thumbs = path.resolve(config.thumbsDir);
  const resolved = path.resolve(absPath);
  if (resolved.startsWith(uploads)) {
    return `/media/uploads/${path.relative(uploads, resolved).replace(/\\/g, "/")}`;
  }
  if (resolved.startsWith(thumbs)) {
    return `/media/thumbs/${path.relative(thumbs, resolved).replace(/\\/g, "/")}`;
  }
  return null;
}

export async function registerRoutes(app: FastifyInstance): Promise<void> {
  app.addHook("preHandler", requireToken);

  app.get("/health", async () => {
    const tags = await ollamaTags();
    return {
      ok: true,
      service: "agent-debug",
      port: config.port,
      ollamaHost: config.ollamaHost,
      ollamaUp: tags.length > 0,
      composeModel: config.composeModel,
      authRequired: Boolean(config.token),
    };
  });

  app.get("/v1/status", async () => getStatus());
  app.get("/v1/pending", async () => listPending());
  app.get("/v1/archive", async (req) => {
    const q = req.query as { limit?: string };
    const limit = q.limit ? Number.parseInt(q.limit, 10) : 20;
    return listArchive(Number.isFinite(limit) ? limit : 20);
  });

  app.get("/v1/sessions", async () => ({ sessions: store.listSessions() }));

  app.get("/v1/messages", async (req) => {
    const q = req.query as { sessionId?: string };
    const messages = enrichMessages(q.sessionId).map((m) => ({
      ...m,
      images: m.images.map((img) => ({
        ...img,
        url: mediaUrl(img.path),
        thumbUrl: mediaUrl(img.thumbPath) ?? mediaUrl(img.path),
      })),
    }));
    return { messages };
  });

  app.post("/v1/messages", async (req, reply) => {
    const body = (req.body ?? {}) as {
      sessionId?: string;
      text?: string;
      urgent?: boolean;
      sendNow?: boolean;
      deployBatchId?: string;
      deployStatus?: "none" | "pending" | "live" | "failed";
      deployNote?: string;
      images?: Array<{
        filename: string;
        mimeType: string;
        size: number;
        path: string;
      }>;
    };
    const result = await postMessage(body);
    return reply.code(201).send(result);
  });

  app.post("/v1/upload", async (req, reply) => {
    const images: Array<{
      filename: string;
      mimeType: string;
      size: number;
      path: string;
    }> = [];
    let sessionId: string | undefined;
    let text = "";
    let urgent = false;
    let sendNow = false;

    const parts = req.parts();
    for await (const part of parts) {
      if (part.type === "file") {
        const id = randomUUID();
        const safeName = path
          .basename(part.filename || `image-${id}.bin`)
          .replace(/[^\w.\-()+ ]+/g, "_");
        const dest = path.join(config.uploadsDir, `${id}-${safeName}`);
        const buf = await part.toBuffer();
        fs.writeFileSync(dest, buf);
        images.push({
          filename: safeName,
          mimeType: part.mimetype || "application/octet-stream",
          size: buf.length,
          path: dest,
        });
      } else {
        const value = String(part.value ?? "");
        if (part.fieldname === "sessionId") sessionId = value || undefined;
        if (part.fieldname === "text") text = value;
        if (part.fieldname === "urgent") urgent = value === "true";
        if (part.fieldname === "sendNow") sendNow = value === "true";
      }
    }

    if (!images.length && !text.trim()) {
      return reply.code(400).send({ error: "missing file or text" });
    }

    const result = await postMessage({
      sessionId,
      text,
      urgent,
      sendNow,
      images,
    });
    return reply.code(201).send({
      ...result,
      mediaUrls: images.map((img) => mediaUrl(img.path)),
    });
  });

  app.post("/v1/compose-now", async (req) => {
    const body = (req.body ?? {}) as { batchId?: string; sessionId?: string };
    const batches = await composeNow(body.batchId, body.sessionId);
    return { batches };
  });

  app.post("/v1/dispatch", async (req) => {
    const body = (req.body ?? {}) as { batchId?: string };
    const enqueued = replayUndispatchedReadyBatches(body.batchId);
    return { enqueued, batchId: body.batchId ?? null };
  });

  app.post("/v1/mark-deployed", async (req, reply) => {
    const body = (req.body ?? {}) as {
      batchId?: string;
      deployNote?: string;
      deployStatus?: "none" | "pending" | "live" | "failed";
    };
    if (!body.batchId) {
      return reply.code(400).send({ error: "batchId required" });
    }
    const result = await markDeployed(
      body.batchId,
      body.deployNote,
      body.deployStatus ?? "live",
    );
    return result;
  });

  app.post("/v1/ack", async (req) => {
    const body = (req.body ?? {}) as {
      batchIds?: string[];
      messageIds?: string[];
      batchId?: string;
      messageId?: string;
      reason?: "implemented" | "discarded" | "already_done";
    };
    const batchIds = [
      ...(body.batchIds ?? []),
      ...(body.batchId ? [body.batchId] : []),
    ];
    const messageIds = [
      ...(body.messageIds ?? []),
      ...(body.messageId ? [body.messageId] : []),
    ];
    return ack({ batchIds, messageIds, reason: body.reason });
  });

  app.get("/media/uploads/*", async (req, reply) => {
    const rel = (req.params as { "*": string })["*"];
    const filePath = path.join(config.uploadsDir, rel);
    if (!path.resolve(filePath).startsWith(path.resolve(config.uploadsDir))) {
      return reply.code(400).send({ error: "bad path" });
    }
    if (!fs.existsSync(filePath)) return reply.code(404).send({ error: "not found" });
    return reply.send(fs.createReadStream(filePath));
  });

  app.get("/media/thumbs/*", async (req, reply) => {
    const rel = (req.params as { "*": string })["*"];
    const filePath = path.join(config.thumbsDir, rel);
    if (!path.resolve(filePath).startsWith(path.resolve(config.thumbsDir))) {
      return reply.code(400).send({ error: "bad path" });
    }
    if (!fs.existsSync(filePath)) return reply.code(404).send({ error: "not found" });
    return reply.send(fs.createReadStream(filePath));
  });
}
