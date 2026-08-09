#!/usr/bin/env python3
"""Restore pocket-team sources from dist JS, patch schema/index, leave tree ready to commit."""
from __future__ import annotations

import re
import shutil
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def copy_js_as_ts(src: Path, dst: Path) -> None:
    dst.parent.mkdir(parents=True, exist_ok=True)
    body = src.read_text(encoding="utf-8")
    dst.write_text("// @ts-nocheck\n" + body, encoding="utf-8")
    print(f"restored {dst.relative_to(ROOT)} ({dst.stat().st_size} bytes)")


def patch_schema() -> None:
    schema = ROOT / "apps/server/prisma/schema.prisma"
    st = schema.read_text(encoding="utf-8")
    if "PendingConfirmation" in st:
        print("schema already patched")
        return
    st = st.replace(
        """enum AdvisorPersona {
  CFO
  COUNSEL
  COMBINED
}

enum ExportStatus {
  DRAFT
  GENERATED
  FAILED
}
""",
        """enum ExportStatus {
  DRAFT
  GENERATED
  FAILED
}

enum ConfirmationStatus {
  pending
  confirmed
  rejected
  expired
}
""",
    )
    st = st.replace(
        """model Document {
  id           String               @id @default(cuid())
  filename     String
  mimeType     String
  documentType DocumentType         @default(OTHER)
  storagePath  String
  fileSize     Int
  sha256       String?
  uploadedAt   DateTime             @default(now())
  jobs         IngestionJob[]
  extractions  DocumentExtraction[]
  transaction  Transaction?
  qrBill       QRBill?
  complaint    ComplaintLog?
}
""",
        """model Document {
  id              String               @id @default(cuid())
  filename        String
  mimeType        String
  documentType    DocumentType         @default(OTHER)
  storagePath     String
  fileSize        Int
  sha256          String?
  archiveName     String?
  archiveCategory Int?
  deadline        DateTime?
  confirmedAt     DateTime?
  uploadedAt      DateTime             @default(now())
  jobs            IngestionJob[]
  extractions     DocumentExtraction[]
  transaction     Transaction?
  qrBill          QRBill?
  complaint       ComplaintLog?
}
""",
    )
    st = st.replace(
        """model ChatSession {
  id        String         @id @default(cuid())
  title     String?
  persona   AdvisorPersona @default(COMBINED)
  model     String         @default("deepseek-r1:8b")
  messages  ChatMessage[]
  createdAt DateTime       @default(now())
  updatedAt DateTime       @updatedAt
}

model ChatMessage {
""",
        """model ChatSession {
  id        String   @id @default(cuid())
  title     String?
  persona   String   @default("secretary")
  model     String   @default("deepseek-r1:8b")
  messages  ChatMessage[]
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
}

model PendingConfirmation {
  id         String             @id @default(cuid())
  action     String
  summary    String
  payload    String
  entity     String?
  entityId   String?
  status     ConfirmationStatus @default(pending)
  createdAt  DateTime           @default(now())
  resolvedAt DateTime?

  @@index([status, createdAt])
}

model ChatMessage {
""",
    )
    schema.write_text(st, encoding="utf-8")
    print("schema patched")


def patch_index() -> None:
    idx = ROOT / "apps/server/src/routes/index.ts"
    it = idx.read_text(encoding="utf-8")
    if "registerTeamRoutes" not in it:
        it = it.replace(
            'import { registerLifeRoutes } from "./life.js";\n',
            'import { registerLifeRoutes } from "./life.js";\n'
            'import { registerTeamRoutes } from "./team.js";\n'
            'import { registerConfirmationRoutes } from "./confirmations.js";\n'
            'import { createConfirmation } from "../confirm/confirm-service.js";\n',
        )
        it = it.replace(
            "  await registerLifeRoutes(app);\n",
            "  await registerLifeRoutes(app);\n"
            "  await registerTeamRoutes(app);\n"
            "  await registerConfirmationRoutes(app);\n",
        )

    if 'persona?: "CFO" | "COUNSEL" | "COMBINED"' in it:
        start = it.find('persona?: "CFO" | "COUNSEL" | "COMBINED"')
        start = it.rfind("  app.post<", 0, start)
        end = it.find("  // Briefing", start)
        if start >= 0 and end > start:
            it = (
                it[:start]
                + "  // /advisor/chat/stream and /team/chat/stream registered in team.ts\n\n"
                + it[end:]
            )

    old_qr = '''  app.patch<{ Params: { id: string }; Body: { status?: "PENDING" | "PAID" | "OVERDUE" | "CANCELLED" } }>(
    "/finance/qr-bills/:id",
    async (req, reply) => {
      try {
        const { prisma } = await withPrisma(req);
        const bill = await prisma.qRBill.update({
          where: { id: req.params.id },
          data: {
            status: req.body.status,
            paidAt: req.body.status === "PAID" ? new Date() : undefined,
          },
        });
        return bill;
      } catch (err) {
        return sendError(reply, err);
      }
    },
  );'''
    new_qr = '''  app.patch<{
    Params: { id: string };
    Body: { status?: "PENDING" | "PAID" | "OVERDUE" | "CANCELLED"; confirmed?: boolean };
  }>("/finance/qr-bills/:id", async (req, reply) => {
    try {
      const { prisma } = await withPrisma(req);
      if (req.body.status === "PAID" && !req.body.confirmed) {
        const bill = await prisma.qRBill.findUnique({ where: { id: req.params.id } });
        if (!bill) return reply.status(404).send({ error: "QR bill not found" });
        const confirmation = await createConfirmation(prisma, {
          action: "qr.mark_paid",
          summary: `Mark paid + ledger: ${bill.creditorName} · ${bill.amount} ${bill.currency}`,
          entity: "QRBill",
          entityId: bill.id,
          payload: { billId: bill.id, writeLedger: true },
        });
        return reply.status(202).send({
          needsConfirm: true,
          confirmation,
          message: "Confirm before marking paid and writing the ledger.",
        });
      }
      const bill = await prisma.qRBill.update({
        where: { id: req.params.id },
        data: {
          status: req.body.status,
          paidAt: req.body.status === "PAID" ? new Date() : undefined,
        },
      });
      return bill;
    } catch (err) {
      return sendError(reply, err);
    }
  });'''
    if old_qr in it:
        it = it.replace(old_qr, new_qr)

    med_old = '''  }>("/medical/export", async (req, reply) => {
    try {
      const { profileId, prisma } = await withPrisma(req);
      const profile = getActiveProfile();'''
    med_new = '''  }>("/medical/export", async (req, reply) => {
    try {
      const { profileId, prisma } = await withPrisma(req);
      if (!(req.body as { confirmed?: boolean }).confirmed) {
        const confirmation = await createConfirmation(prisma, {
          action: "medical.export",
          summary: `Export medical report: ${req.body.title} (${req.body.complaintIds?.length ?? 0} complaints)`,
          entity: "MedicalExport",
          payload: {
            title: req.body.title,
            dateRangeFrom: req.body.dateRangeFrom,
            dateRangeTo: req.body.dateRangeTo,
            complaintIds: req.body.complaintIds,
            analysisIds: req.body.analysisIds ?? [],
          },
        });
        return reply.status(202).send({
          needsConfirm: true,
          confirmation,
          message: "Confirm before generating the medical PDF export.",
        });
      }
      const profile = getActiveProfile();'''
    if med_old in it:
        it = it.replace(med_old, med_new)

    if "teamChat" not in it:
        it = it.replace(
            """      dualMedicalAnalysis: config.licenseTier === "pro",
    },
  }));
}""",
            """      dualMedicalAnalysis: config.licenseTier === "pro",
      teamChat: config.licenseTier === "pro",
      careerPdf: config.licenseTier === "pro",
    },
  }));
}""",
        )

    idx.write_text(it, encoding="utf-8")
    print("index patched", "registerTeamRoutes" in it, "qr.mark_paid" in it)


def patch_ingestion() -> None:
    iw = ROOT / "apps/server/src/ollama/ingestion-worker.ts"
    wt = iw.read_text(encoding="utf-8")
    if "createConfirmation" in wt:
        print("ingestion already patched")
        return
    # Prefer restored worker from dist if available
    dist = ROOT / "apps/server/dist/ollama/ingestion-worker.js"
    if dist.exists() and "createConfirmation" in dist.read_text(encoding="utf-8"):
        copy_js_as_ts(dist, iw)
        print("ingestion restored from dist")
        return
    print("WARN: ingestion not patched from dist")


def main() -> None:
    pairs = [
        ("apps/server/dist/specialists/roster.js", "apps/server/src/specialists/roster.ts"),
        ("apps/server/dist/confirm/confirm-service.js", "apps/server/src/confirm/confirm-service.ts"),
        ("apps/server/dist/confirm/apply-confirmation.js", "apps/server/src/confirm/apply-confirmation.ts"),
        ("apps/server/dist/routes/team.js", "apps/server/src/routes/team.ts"),
        ("apps/server/dist/routes/confirmations.js", "apps/server/src/routes/confirmations.ts"),
        ("apps/server/dist/export/career-document.js", "apps/server/src/export/career-document.tsx"),
    ]
    for src, dst in pairs:
        copy_js_as_ts(ROOT / src, ROOT / dst)
    patch_schema()
    patch_index()
    patch_ingestion()
    # Keep restore script for audit; integration test rewritten next
    print("RESTORE_OK")


if __name__ == "__main__":
    main()
