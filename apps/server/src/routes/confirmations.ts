// @ts-nocheck
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import React from "react";
import { renderToBuffer } from "@react-pdf/renderer";
import { profileDir, profileExportsDir } from "../config.js";
import { guessMime } from "../archive/commit.js";
import { ARCHIVE_TAXONOMY } from "../specialists/roster.js";
import { createConfirmation, listPendingConfirmations } from "../confirm/confirm-service.js";
import { resolveConfirmation } from "../confirm/apply-confirmation.js";
import { CareerDocument } from "../export/career-document.js";
import { getServerJob, serializeServerJob } from "../jobs/server-jobs.js";
import { sendError, withPrisma } from "./helpers.js";

function isPathInside(parent, child) {
  const resolvedParent = path.resolve(parent);
  const resolvedChild = path.resolve(child);
  const rel = path.relative(resolvedParent, resolvedChild);
  return Boolean(rel) && !rel.startsWith("..") && !path.isAbsolute(rel);
}

function contentDisposition(filename, inline = true) {
  const safe = String(filename || "document").replace(/[^\w.\-ÄÖÜäöüéèêà ]+/g, "_");
  const type = inline ? "inline" : "attachment";
  return `${type}; filename="${safe}"`;
}

export async function registerConfirmationRoutes(app) {
    app.get("/confirmations", async (req, reply) => {
        try {
            const { prisma } = await withPrisma(req);
            const pending = await listPendingConfirmations(prisma);
            return {
                confirmations: pending.map((c) => ({
                    ...c,
                    payload: JSON.parse(c.payload || "{}"),
                })),
            };
        }
        catch (err) {
            return sendError(reply, err);
        }
    });
    app.post("/confirmations/:id/confirm", async (req, reply) => {
        try {
            const { prisma } = await withPrisma(req);
            const out = await resolveConfirmation(prisma, req.params.id, "confirm");
            // Local confirm barrier is done; Drive upload (if any) continues as ServerJob.
            if (out?.async && out?.driveJob) {
                return reply.status(202).send(out);
            }
            return out;
        }
        catch (err) {
            return sendError(reply, err);
        }
    });
    app.post("/confirmations/:id/reject", async (req, reply) => {
        try {
            const { prisma } = await withPrisma(req);
            return await resolveConfirmation(prisma, req.params.id, "reject");
        }
        catch (err) {
            return sendError(reply, err);
        }
    });
    /** Poll durable ServerJob status (Drive upload / ensure) — keyed by profile, not browser tab. */
    app.get("/jobs/:id", async (req, reply) => {
        try {
            const { prisma } = await withPrisma(req);
            const job = await getServerJob(prisma, req.params.id);
            if (!job) return reply.status(404).send({ error: "Job not found" });
            return { job: serializeServerJob(job) };
        }
        catch (err) {
            return sendError(reply, err);
        }
    });
    /** Edit archive naming / category on a pending confirm before approve (US-2.x). */
    app.patch("/confirmations/:id", async (req, reply) => {
        try {
            const { prisma } = await withPrisma(req);
            const pending = await prisma.pendingConfirmation.findUnique({
                where: { id: req.params.id },
            });
            if (!pending) return reply.status(404).send({ error: "Confirmation not found" });
            if (pending.status !== "pending") {
                return reply.status(400).send({ error: `Already ${pending.status}` });
            }
            const body = req.body ?? {};
            const payload = JSON.parse(pending.payload || "{}");
            if (typeof body.archiveName === "string" && body.archiveName.trim()) {
                payload.archiveName = body.archiveName.trim();
                const ext = path.extname(payload.archiveName);
                if (ext) payload.sourceExtension = ext.toLowerCase();
            }
            if (body.archiveCategory != null && !Number.isNaN(Number(body.archiveCategory))) {
                payload.archiveCategory = Number(body.archiveCategory);
            }
            if (typeof body.summary === "string" && body.summary.trim()) {
                // allow explicit summary override
            }
            const archiveName = payload.archiveName ?? "document";
            const archiveCategory = payload.archiveCategory ?? 9;
            const summary =
                typeof body.summary === "string" && body.summary.trim()
                    ? body.summary.trim()
                    : pending.action === "archive.commit" || pending.action === "ledger.write"
                        ? `File as ${archiveName} (folder ${archiveCategory})`
                        : pending.summary;
            const updated = await prisma.pendingConfirmation.update({
                where: { id: pending.id },
                data: {
                    payload: JSON.stringify(payload),
                    summary,
                },
            });
            return {
                confirmation: {
                    ...updated,
                    payload,
                },
            };
        }
        catch (err) {
            return sendError(reply, err);
        }
    });
    app.get("/archive/documents", async (req, reply) => {
        try {
            const { prisma } = await withPrisma(req);
            const documents = await prisma.document.findMany({
                orderBy: { uploadedAt: "desc" },
                take: 100,
                include: {
                    extractions: { orderBy: { createdAt: "desc" }, take: 1 },
                    jobs: { orderBy: { createdAt: "desc" }, take: 1 },
                },
            });
            return { documents, taxonomy: ARCHIVE_TAXONOMY };
        }
        catch (err) {
            return sendError(reply, err);
        }
    });
    /**
     * Stream document bytes for in-app preview / open-in-tab.
     * Scoped to the unlocked profile DB + files under that profile's data dir.
     */
    app.get("/documents/:id/file", async (req, reply) => {
        try {
            const { profileId, prisma } = await withPrisma(req);
            const doc = await prisma.document.findUnique({ where: { id: req.params.id } });
            if (!doc) return reply.status(404).send({ error: "Document not found" });
            const storagePath = path.resolve(doc.storagePath);
            const root = path.resolve(profileDir(profileId));
            if (!isPathInside(root, storagePath)) {
                return reply.status(403).send({ error: "Document path outside profile" });
            }
            try {
                await fsp.access(storagePath);
            }
            catch {
                return reply.status(404).send({ error: "Document file missing on disk" });
            }
            const filename = doc.archiveName || doc.filename || path.basename(storagePath);
            const mime = doc.mimeType || guessMime(storagePath, null);
            const inline = String(req.query?.download ?? "") !== "1";
            reply.header("Content-Type", mime);
            reply.header("Content-Disposition", contentDisposition(filename, inline));
            reply.header("Cache-Control", "private, no-store");
            return reply.send(fs.createReadStream(storagePath));
        }
        catch (err) {
            return sendError(reply, err);
        }
    });
    app.post("/career/pdf", async (req, reply) => {
        try {
            const { profileId, prisma } = await withPrisma(req);
            if (!req.body.title?.trim() || !Array.isArray(req.body.sections)) {
                return reply.status(400).send({ error: "title and sections are required" });
            }
            if (!req.body.confirmed) {
                const confirmation = await createConfirmation(prisma, {
                    action: "career.pdf",
                    summary: `Generate career PDF: ${req.body.title}`,
                    entity: "CareerPdf",
                    payload: {
                        title: req.body.title,
                        subtitle: req.body.subtitle,
                        sections: req.body.sections,
                    },
                });
                return reply.status(202).send({
                    needsConfirm: true,
                    confirmation,
                    message: "Confirm before generating the career PDF.",
                });
            }
            const pdfData = {
                title: req.body.title,
                subtitle: req.body.subtitle,
                sections: req.body.sections,
                generatedAt: new Date().toISOString().slice(0, 10),
            };
            const doc = React.createElement(CareerDocument, { data: pdfData });
            const buffer = await renderToBuffer(doc);
            const exportsDir = profileExportsDir(profileId);
            fs.mkdirSync(exportsDir, { recursive: true });
            const filename = `career-${Date.now()}.pdf`;
            const storagePath = path.join(exportsDir, filename);
            await fsp.writeFile(storagePath, buffer);
            await prisma.auditLog.create({
                data: {
                    action: "career.pdf",
                    entity: "CareerPdf",
                    metadata: JSON.stringify({ title: req.body.title, storagePath }),
                },
            });
            reply.header("Content-Type", "application/pdf");
            reply.header("Content-Disposition", `attachment; filename="${filename}"`);
            return reply.send(buffer);
        }
        catch (err) {
            return sendError(reply, err, 500);
        }
    });
}
//# sourceMappingURL=confirmations.js.map