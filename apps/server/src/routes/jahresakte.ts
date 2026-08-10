import type { FastifyInstance } from "fastify";
import { createConfirmation } from "../confirm/confirm-service.js";
import { taxonomyFolderName } from "../archive/commit.js";
import { loadDriveConfig } from "../archive/drive.js";
import {
  JAHRESAKTE_DEFAULT_CATEGORIES,
  listJahresakteHits,
  normalizeJahresakteCategories,
} from "../export/jahresakte-pack.js";
import { ARCHIVE_TAXONOMY } from "../specialists/roster.js";
import { sendError, withPrisma } from "./helpers.js";

/** Swiss Jahresakte year-pack routes. */
export async function registerJahresakteRoutes(app: FastifyInstance): Promise<void> {
  app.get("/archive/jahresakte", async (req, reply) => {
    try {
      const { prisma, profileId } = await withPrisma(req);
      const query = req.query as { year?: string; categories?: string };
      const year = Number(query.year);
      if (!Number.isInteger(year) || year < 1990 || year > 2100) {
        return reply.status(400).send({ error: "year query required (1990–2100)" });
      }
      const categories = query.categories
        ? normalizeJahresakteCategories(
            query.categories
              .split(",")
              .map((s) => Number(s.trim()))
              .filter((n) => Number.isFinite(n)),
          )
        : [...JAHRESAKTE_DEFAULT_CATEGORIES];
      const hits = await listJahresakteHits(prisma, { year, categories });
      const drive = loadDriveConfig(profileId);
      return {
        year,
        categories,
        taxonomy: ARCHIVE_TAXONOMY,
        defaultCategories: [...JAHRESAKTE_DEFAULT_CATEGORIES],
        driveEnabled: drive.enabled,
        documents: hits.map((h) => ({
          id: h.id,
          filename: h.filename,
          archiveName: h.archiveName,
          archiveCategory: h.archiveCategory,
          categoryLabel: taxonomyFolderName(h.archiveCategory ?? 9),
          documentType: h.documentType,
          mimeType: h.mimeType,
          uploadedAt: h.uploadedAt,
          confirmedAt: h.confirmedAt,
          deadline: h.deadline,
          yearMatch: h.yearMatch,
        })),
      };
    } catch (err) {
      return sendError(reply, err);
    }
  });

  app.post<{
    Body: {
      year: number;
      documentIds: string[];
      categories?: number[];
      uploadToDrive?: boolean;
    };
  }>("/archive/jahresakte", async (req, reply) => {
    try {
      const { prisma } = await withPrisma(req);
      const year = Number(req.body?.year);
      if (!Number.isInteger(year) || year < 1990 || year > 2100) {
        return reply.status(400).send({ error: "year must be an integer between 1990 and 2100" });
      }
      const documentIds = Array.isArray(req.body?.documentIds)
        ? [...new Set(req.body.documentIds.map(String))].filter(Boolean)
        : [];
      if (documentIds.length === 0) {
        return reply.status(400).send({ error: "documentIds required" });
      }
      const categories = normalizeJahresakteCategories(req.body?.categories);
      const uploadToDrive = Boolean(req.body?.uploadToDrive);
      const sortedIds = [...documentIds].sort();
      const confirmation = await createConfirmation(prisma, {
        action: "jahresakte.export",
        summary: `Jahresakte ${year}: ZIP + PDF index (${documentIds.length} document${
          documentIds.length === 1 ? "" : "s"
        }${uploadToDrive ? ", optional Drive" : ""})`,
        entity: "Jahresakte",
        entityId: `jahresakte:${year}:${sortedIds.join(",")}:${uploadToDrive ? "drive" : "local"}`,
        payload: {
          year,
          documentIds,
          categories,
          uploadToDrive,
        },
      });
      return reply.status(202).send({
        needsConfirm: true,
        confirmation,
        message:
          "Confirm in Needs your confirmation before the Jahresakte ZIP and PDF index are written.",
      });
    } catch (err) {
      return sendError(reply, err);
    }
  });
}
