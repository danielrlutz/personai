// @ts-nocheck
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import React from "react";
import { renderToBuffer } from "@react-pdf/renderer";
import {
  getConfirmation,
  markConfirmation,
  parsePayload,
} from "./confirm-service.js";
import { commitDocumentToArchive } from "../archive/commit.js";
import { getActiveProfileId } from "../db/prisma-singleton.js";
import { profileExportsDir } from "../config.js";
import { getActiveProfile } from "../profiles/registry.js";
import { MedicalReportDocument } from "../export/medical-report.js";
import { safeDate, safeDateOrNow, safeFiniteNumberOr } from "../lib/safe-data.js";
import {
  enqueueServerJob,
  serializeServerJob,
  SERVER_JOB_DRIVE_UPLOAD,
} from "../jobs/server-jobs.js";
import { buildFristKitPayload } from "../legal/frist-kit.js";

async function fileDocumentToArchive(prisma, documentId, payload) {
  const doc = await prisma.document.findUnique({ where: { id: documentId } });
  if (!doc) throw new Error("Document not found");
  const archiveName = String(payload.archiveName ?? doc.archiveName ?? doc.filename);
  const archiveCategory = Number(payload.archiveCategory ?? doc.archiveCategory ?? 9);
  const profileId = getActiveProfileId();
  // Local archive is the confirm barrier; Drive continues as a ServerJob.
  const archived = await commitDocumentToArchive({
    profileId,
    sourcePath: doc.storagePath,
    archiveName,
    archiveCategory,
    mimeType: doc.mimeType,
    deferDrive: true,
  });
  let driveJob = null;
  if (archived.driveDeferred) {
    driveJob = await enqueueServerJob(prisma, {
      type: SERVER_JOB_DRIVE_UPLOAD,
      documentId,
      payload: {
        localPath: archived.localPath,
        name: path.basename(archived.localPath),
        mimeType: doc.mimeType,
        archiveCategory: archived.archiveCategory,
        documentId,
      },
    });
  }
  const deadline =
    safeDate(payload.dueDate) ?? safeDate(payload.deadline) ?? undefined;
  await prisma.document.update({
    where: { id: documentId },
    data: {
      archiveName: archived.archiveName,
      archiveCategory: archived.archiveCategory,
      confirmedAt: new Date(),
      ...(deadline !== undefined ? { deadline } : {}),
    },
  });
  await prisma.auditLog.create({
    data: {
      action: "archive.write",
      entity: "Document",
      entityId: documentId,
      metadata: JSON.stringify({
        localPath: archived.localPath,
        folder: archived.folderLabel,
        driveFileId: archived.drive?.fileId ?? null,
        driveFolderId: archived.drive?.folderId ?? null,
        driveError: archived.driveError,
        driveDeferred: archived.driveDeferred,
        driveJobId: driveJob?.id ?? null,
      }),
    },
  });
  return {
    doc,
    archived,
    driveJob: driveJob ? serializeServerJob(driveJob) : null,
  };
}

async function applyLedgerWrite(prisma, payload) {
  const kind = String(payload.kind ?? "");
  const documentId = payload.documentId ? String(payload.documentId) : undefined;
  let driveJob = null;
  if (kind === "qr_bill") {
    const existing = documentId
      ? await prisma.qRBill.findFirst({ where: { documentId } })
      : null;
    if (existing) {
      if (documentId) {
        const filed = await fileDocumentToArchive(prisma, documentId, payload);
        driveJob = filed.driveJob;
      }
      return { bill: existing, driveJob };
    }
    const bill = await prisma.qRBill.create({
      data: {
        creditorName: String(payload.creditorName ?? "Unknown"),
        iban: String(payload.iban ?? ""),
        amount: safeFiniteNumberOr(payload.amount, 0),
        currency: String(payload.currency ?? "CHF"),
        reference: payload.reference ? String(payload.reference) : null,
        dueDate: safeDate(payload.dueDate),
        documentId: documentId ?? null,
        status: "PENDING",
      },
    });
    if (documentId) {
      const filed = await fileDocumentToArchive(prisma, documentId, payload);
      driveJob = filed.driveJob;
    }
    return { bill, driveJob };
  }
  if (kind === "transaction") {
    const existing = documentId
      ? await prisma.transaction.findFirst({ where: { documentId } })
      : null;
    if (existing) {
      if (documentId) {
        const filed = await fileDocumentToArchive(prisma, documentId, payload);
        driveJob = filed.driveJob;
      }
      return { transaction: existing, driveJob };
    }
    const tx = await prisma.transaction.create({
      data: {
        type: payload.type ?? "EXPENSE",
        amount: safeFiniteNumberOr(payload.amount, 0),
        currency: String(payload.currency ?? "CHF"),
        description: String(payload.description ?? "Expense"),
        date: safeDateOrNow(payload.date),
        documentId: documentId ?? null,
      },
    });
    if (documentId) {
      const filed = await fileDocumentToArchive(prisma, documentId, payload);
      driveJob = filed.driveJob;
    }
    return { transaction: tx, driveJob };
  }
  throw new Error(`Unknown ledger write kind: ${kind}`);
}

async function applyArchiveCommit(prisma, payload) {
  const documentId = String(payload.documentId ?? "");
  if (!documentId) throw new Error("documentId required");
  const deadline = safeDate(payload.deadline);
  const { doc, archived, driveJob } = await fileDocumentToArchive(prisma, documentId, {
    ...payload,
    deadline: deadline ? deadline.toISOString() : null,
  });
  if (payload.createFristenTask && deadline) {
    await prisma.legalTask.create({
      data: {
        title: `Deadline (Frist): ${archived.archiveName ?? doc.filename}`,
        description: `From archive document ${doc.id}`,
        type: "DEADLINE",
        status: "TODO",
        dueDate: deadline,
        documentId: doc.id,
      },
    });
  }
  return { document: doc, archived, driveJob };
}

async function applyQrMarkPaid(prisma, payload) {
  const billId = String(payload.billId ?? "");
  if (!billId) throw new Error("billId required");
  const bill = await prisma.qRBill.update({
    where: { id: billId },
    data: { status: "PAID", paidAt: new Date() },
  });
  if (payload.writeLedger !== false) {
    const existing = bill.documentId
      ? await prisma.transaction.findFirst({ where: { documentId: bill.documentId } })
      : null;
    if (!existing) {
      await prisma.transaction.create({
        data: {
          type: "EXPENSE",
          amount: bill.amount,
          currency: bill.currency,
          description: `QR paid: ${bill.creditorName}`,
          date: new Date(),
          documentId: bill.documentId,
        },
      });
    }
  }
  return bill;
}

async function applyMedicalExport(prisma, payload) {
  const profileId = getActiveProfileId();
  if (!profileId) throw new Error("No active profile");
  const profile = getActiveProfile();
  const complaintIds = Array.isArray(payload.complaintIds) ? payload.complaintIds.map(String) : [];
  const analysisIds = Array.isArray(payload.analysisIds) ? payload.analysisIds.map(String) : [];
  const title = String(payload.title ?? "Medical Report");
  const fromDate = safeDateOrNow(payload.dateRangeFrom);
  const toDate = safeDateOrNow(payload.dateRangeTo);

  const complaints = await prisma.complaintLog.findMany({
    where: { id: { in: complaintIds } },
    orderBy: { occurredAt: "asc" },
  });
  const analyses = await prisma.medicalAnalysis.findMany({
    where: { id: { in: analysisIds } },
  });

  const exportRec = await prisma.medicalExport.create({
    data: {
      title,
      dateRangeFrom: fromDate,
      dateRangeTo: toDate,
      complaintIds: JSON.stringify(complaintIds),
      analysisIds: JSON.stringify(analysisIds),
      status: "DRAFT",
    },
  });

  const pdfData = {
    profileName: profile?.name ?? "Patient",
    title,
    dateFrom: fromDate.toISOString().slice(0, 10),
    dateTo: toDate.toISOString().slice(0, 10),
    complaints: complaints.map((c) => ({
      title: c.title,
      category: c.category,
      severity: c.severity,
      description: c.description,
      occurredAt: c.occurredAt.toISOString().slice(0, 10),
      moodScore: c.moodScore,
      sleepHours: c.sleepHours,
    })),
    analyses: analyses.map((a) => ({
      framework: a.framework,
      result: a.result,
      disclaimer: a.disclaimer,
    })),
  };

  const doc = React.createElement(MedicalReportDocument, { data: pdfData });
  const buffer = await renderToBuffer(doc);
  const exportsDir = profileExportsDir(profileId);
  fs.mkdirSync(exportsDir, { recursive: true });
  const storagePath = path.join(exportsDir, `${exportRec.id}.pdf`);
  await fsp.writeFile(storagePath, buffer);

  const updated = await prisma.medicalExport.update({
    where: { id: exportRec.id },
    data: {
      storagePath,
      status: "GENERATED",
      generatedAt: new Date(),
    },
  });

  return { export: updated, storagePath };
}

function monthKey(d = new Date()) {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

async function applyPremiumInference(prisma, payload) {
  const key = `premium.usage.${monthKey()}`;
  const row = await prisma.setting.findUnique({ where: { key } });
  const prev = row ? Number(JSON.parse(row.value).used ?? 0) : 0;
  const used = prev + 1;
  await prisma.setting.upsert({
    where: { key },
    create: { key, value: JSON.stringify({ used, updatedAt: new Date().toISOString() }) },
    update: { value: JSON.stringify({ used, updatedAt: new Date().toISOString() }) },
  });
  await prisma.auditLog.create({
    data: {
      action: "premium.inference",
      entity: "PremiumUsage",
      metadata: JSON.stringify({ used, reason: payload?.reason ?? null }),
    },
  });
  return { used, acknowledged: true };
}

/** Stage a calendar event locally until Google Calendar OAuth write is wired. */
export async function stageCalendarEvent(prisma, payload) {
  const event = {
    title: String(payload.title ?? "Event"),
    start: String(payload.start ?? ""),
    end: payload.end ? String(payload.end) : null,
    description: payload.description ? String(payload.description) : null,
    stagedAt: new Date().toISOString(),
  };
  const key = "calendar.staged_events";
  const row = await prisma.setting.findUnique({ where: { key } });
  const prev = row ? JSON.parse(row.value) : [];
  const list = Array.isArray(prev) ? prev : [];
  list.unshift(event);
  await prisma.setting.upsert({
    where: { key },
    create: { key, value: JSON.stringify(list.slice(0, 100)) },
    update: { value: JSON.stringify(list.slice(0, 100)) },
  });
  await prisma.auditLog.create({
    data: {
      action: "calendar.event_staged",
      entity: "CalendarEvent",
      metadata: JSON.stringify(event),
    },
  });
  return { staged: true, event };
}

async function applyCalendarEvent(prisma, payload) {
  return stageCalendarEvent(prisma, payload);
}

async function applyLegalFristKit(prisma, payload) {
  const built = buildFristKitPayload(payload);
  const dueDate = safeDate(built.deadline);
  if (!dueDate) throw new Error("Frist kit requires a valid deadline");

  let task = built.documentId
    ? await prisma.legalTask.findFirst({
        where: {
          documentId: built.documentId,
          type: "DEADLINE",
          status: { in: ["TODO", "IN_PROGRESS", "BLOCKED"] },
          dueDate,
        },
      })
    : null;

  if (!task) {
    task = await prisma.legalTask.create({
      data: {
        title: built.title,
        description: built.description,
        type: "DEADLINE",
        status: "TODO",
        dueDate,
        documentId: built.documentId,
      },
    });
  }

  const calendar = await stageCalendarEvent(prisma, {
    title: built.title,
    start: dueDate.toISOString(),
    end: null,
    description: [
      built.description,
      built.documentId ? `document:${built.documentId}` : null,
      "source:legal.frist_kit",
      "google_write:not_wired",
    ]
      .filter(Boolean)
      .join("\n"),
  });

  await prisma.auditLog.create({
    data: {
      action: "legal.frist_kit",
      entity: "LegalTask",
      entityId: task.id,
      metadata: JSON.stringify({
        documentId: built.documentId,
        deadline: built.deadline,
        teamHref: built.teamHref,
        calendarStaged: Boolean(calendar?.staged),
      }),
    },
  });

  return {
    task,
    calendar,
    teamHref: built.teamHref,
    checklist: built.checklist,
    deadline: built.deadline,
  };
}
export async function resolveConfirmation(prisma, id, decision) {
  const pending = await getConfirmation(prisma, id);
  if (!pending) throw new Error("Confirmation not found");
  if (pending.status !== "pending") throw new Error(`Already ${pending.status}`);
  if (decision === "reject") {
    const updated = await markConfirmation(prisma, id, "rejected");
    await prisma.auditLog.create({
      data: {
        action: "confirm.reject",
        entity: pending.entity,
        entityId: pending.entityId ?? pending.id,
        metadata: JSON.stringify({ action: pending.action }),
      },
    });
    return { confirmation: updated, result: null };
  }
  const payload = parsePayload(pending.payload);
  let result = null;
  switch (pending.action) {
    case "ledger.write":
      result = await applyLedgerWrite(prisma, payload);
      break;
    case "archive.commit":
      result = await applyArchiveCommit(prisma, payload);
      break;
    case "qr.mark_paid":
      result = await applyQrMarkPaid(prisma, payload);
      break;
    case "medical.export":
      result = await applyMedicalExport(prisma, payload);
      break;
    case "career.pdf":
      // CareerPdfPanel re-requests /career/pdf with confirmed:true after gate approve.
      result = { acknowledged: true, action: pending.action, payload };
      break;
    case "forge.ship":
    case "premium.spend":
      result = { acknowledged: true, action: pending.action, payload };
      break;
    case "premium.inference":
      result = await applyPremiumInference(prisma, payload);
      break;
    case "calendar.event":
      result = await applyCalendarEvent(prisma, payload);
      break;
    case "legal.frist_kit":
      result = await applyLegalFristKit(prisma, payload);
      break;
    case "memory.fact": {
      const key = String(payload.key ?? "").trim();
      const value = String(payload.value ?? "").trim();
      if (!key || !value) throw new Error("memory.fact requires key and value");
      result = await prisma.memoryFact.upsert({
        where: { key },
        create: {
          key: key.slice(0, 120),
          value: value.slice(0, 2000),
          source: String(payload.source ?? "session-distill").slice(0, 80),
          specialistId: payload.specialistId ? String(payload.specialistId) : null,
        },
        update: {
          value: value.slice(0, 2000),
          source: String(payload.source ?? "session-distill").slice(0, 80),
          specialistId: payload.specialistId ? String(payload.specialistId) : null,
        },
      });
      break;
    }
    default:
      throw new Error(`Unsupported action: ${pending.action}`);
  }
  const updated = await markConfirmation(prisma, id, "confirmed");
  const driveJob =
    result && typeof result === "object" && result.driveJob ? result.driveJob : null;
  await prisma.auditLog.create({
    data: {
      action: "confirm.accept",
      entity: pending.entity,
      entityId: pending.entityId ?? pending.id,
      metadata: JSON.stringify({
        action: pending.action,
        driveJobId: driveJob?.id ?? null,
      }),
    },
  });
  return {
    confirmation: updated,
    result,
    driveJob,
    async: Boolean(driveJob),
  };
}
