import type { FastifyInstance } from "fastify";
import { createConfirmation } from "../confirm/confirm-service.js";
import { getPrisma } from "../db/prisma-singleton.js";
import {
  exportSealedSuitcase,
  listArchiveBlobOptions,
  stageSuitcaseImport,
} from "../suitcase/service.js";
import { getProfileId, sendError, withPrisma } from "./helpers.js";
import fs from "node:fs/promises";
import path from "node:path";
import { config } from "../config.js";

export async function registerSuitcaseRoutes(app: FastifyInstance): Promise<void> {
  app.get("/suitcase/archive-blobs", async (req, reply) => {
    try {
      const profileId = getProfileId(req);
      const blobs = await listArchiveBlobOptions(profileId);
      return { blobs };
    } catch (err) {
      return sendError(reply, err);
    }
  });

  app.post<{
    Body: {
      password?: string;
      includeArchive?: boolean;
      archivePaths?: string[];
    };
  }>("/suitcase/export", async (req, reply) => {
    try {
      const profileId = getProfileId(req);
      const password = String(req.body?.password ?? "");
      const includeArchive = Boolean(req.body?.includeArchive);
      const archivePaths = Array.isArray(req.body?.archivePaths)
        ? req.body.archivePaths.map((p) => String(p))
        : undefined;
      const result = await exportSealedSuitcase({
        profileId,
        password,
        includeArchive,
        archivePaths,
      });
      reply.header("Content-Type", "application/octet-stream");
      reply.header(
        "Content-Disposition",
        `attachment; filename="${result.filename.replace(/"/g, "")}"`,
      );
      return reply.send(result.bytes);
    } catch (err) {
      return sendError(reply, err);
    }
  });

  app.post("/suitcase/import", async (req, reply) => {
    try {
      const profileId = getProfileId(req);
      const parts = req.parts();
      let password = "";
      let profileName = "";
      let fileBuf: Buffer | null = null;
      let filename = "import.pao";

      for await (const part of parts) {
        if (part.type === "file") {
          const chunks: Buffer[] = [];
          let total = 0;
          for await (const chunk of part.file) {
            const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
            total += buf.length;
            if (total > 512 * 1024 * 1024) {
              throw new Error("Suitcase file exceeds 512 MiB upload limit");
            }
            chunks.push(buf);
          }
          fileBuf = Buffer.concat(chunks);
          if (part.filename) filename = part.filename;
        } else if (part.type === "field") {
          const val = String(part.value ?? "");
          if (part.fieldname === "password") password = val;
          if (part.fieldname === "profileName") profileName = val;
        }
      }

      if (!fileBuf || fileBuf.length === 0) {
        return reply.status(400).send({ error: "Missing suitcase file" });
      }
      if (!password) {
        return reply.status(400).send({ error: "Password is required" });
      }

      const staged = await stageSuitcaseImport({
        blob: fileBuf,
        password,
        profileName: profileName || undefined,
      });

      // Persist optional display name override for apply step.
      if (profileName.trim()) {
        const dir = path.join(config.dataDir, "suitcases", "staging", staged.stagingId);
        await fs.writeFile(path.join(dir, "import-name.txt"), profileName.trim(), "utf8");
      }

      const { prisma } = await withPrisma(req);
      const confirmation = await createConfirmation(prisma, {
        action: "suitcase.import",
        summary: `Import sealed suitcase as "${staged.profileName}" (${staged.fileCount} files${
          staged.includesArchive ? ", includes archive" : ""
        })`,
        entity: "Suitcase",
        entityId: staged.stagingId,
        payload: {
          stagingId: staged.stagingId,
          profileName: staged.profileName,
          sourceProfileId: staged.sourceProfileId,
          includesArchive: staged.includesArchive,
          fileCount: staged.fileCount,
          totalBytes: staged.totalBytes,
          exportedAt: staged.exportedAt,
          filename,
          requestedByProfileId: profileId,
        },
      });

      return {
        staged,
        confirmation,
      };
    } catch (err) {
      return sendError(reply, err);
    }
  });
}
