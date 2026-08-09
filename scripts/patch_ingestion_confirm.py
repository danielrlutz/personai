from pathlib import Path
import re

iw = Path("apps/server/src/ollama/ingestion-worker.ts")
wt = iw.read_text(encoding="utf-8")
if "createConfirmation" in wt:
    print("already patched")
    raise SystemExit(0)

if 'from "../confirm/confirm-service.js"' not in wt:
    wt = wt.replace(
        'import { vramLock } from "./vram-lock.js";\n',
        'import { vramLock } from "./vram-lock.js";\n'
        'import { createConfirmation } from "../confirm/confirm-service.js";\n'
        'import {\n'
        '  suggestArchiveCategory,\n'
        '  suggestArchiveName,\n'
        '} from "../specialists/roster.js";\n',
    )

pat = re.compile(
    r"    const docType = String\(structured\.documentType \?\? \"OTHER\"\);[\s\S]*?"
    r"    await prisma\.ingestionJob\.update\(\{\n"
    r"      where: \{ id: jobId \},\n"
    r"      data: \{ status: \"COMPLETED\", completedAt: new Date\(\), pausedReason: null \},\n"
    r"    \}\);",
)
m = pat.search(wt)
if not m:
    raise SystemExit("block not found")

new = r'''    const docType = String(structured.documentType ?? "OTHER");
    const entity = String(
      structured.creditorName ?? structured.vendor ?? structured.provider ?? "Unknown",
    );
    const archiveName = suggestArchiveName({
      date: structured.date ? String(structured.date) : null,
      documentType: docType,
      entity,
    });
    const archiveCategory = suggestArchiveCategory(docType);
    const deadline = structured.dueDate ? new Date(String(structured.dueDate)) : null;

    const docUpdate: {
      documentType?: "BILL" | "MEDICAL_RECORD" | "LEGAL" | "CONTRACT" | "RECEIPT" | "OTHER";
      archiveName: string;
      archiveCategory: number;
      deadline: Date | null;
    } = { archiveName, archiveCategory, deadline };
    if (["BILL", "MEDICAL_RECORD", "LEGAL", "CONTRACT", "RECEIPT", "OTHER"].includes(docType)) {
      docUpdate.documentType = docType as
        | "BILL"
        | "MEDICAL_RECORD"
        | "LEGAL"
        | "CONTRACT"
        | "RECEIPT"
        | "OTHER";
    }
    await prisma.document.update({
      where: { id: job.documentId },
      data: docUpdate,
    });

    if (structured.amount && structured.iban) {
      await createConfirmation(prisma, {
        action: "ledger.write",
        summary: `Commit QR bill ${entity} · ${structured.amount} ${structured.currency ?? "CHF"} → archive ${archiveName}`,
        entity: "Document",
        entityId: job.documentId,
        payload: {
          kind: "qr_bill",
          documentId: job.documentId,
          creditorName: entity,
          iban: String(structured.iban),
          amount: Number(structured.amount),
          currency: String(structured.currency ?? "CHF"),
          reference: structured.reference ? String(structured.reference) : null,
          dueDate: structured.dueDate ? String(structured.dueDate) : null,
          archiveName,
          archiveCategory,
        },
      });
    } else if (structured.amount && structured.vendor) {
      await createConfirmation(prisma, {
        action: "ledger.write",
        summary: `Commit expense ${entity} · ${structured.amount} ${structured.currency ?? "CHF"} → archive ${archiveName}`,
        entity: "Document",
        entityId: job.documentId,
        payload: {
          kind: "transaction",
          documentId: job.documentId,
          type: "EXPENSE",
          amount: Number(structured.amount),
          currency: String(structured.currency ?? "CHF"),
          description: entity,
          date: structured.date ? String(structured.date) : new Date().toISOString(),
          archiveName,
          archiveCategory,
        },
      });
    } else {
      await createConfirmation(prisma, {
        action: "archive.commit",
        summary: `Archive as ${archiveName} (cat ${archiveCategory})${deadline ? ` · Frist ${deadline.toISOString().slice(0, 10)}` : ""}`,
        entity: "Document",
        entityId: job.documentId,
        payload: {
          documentId: job.documentId,
          archiveName,
          archiveCategory,
          deadline: deadline ? deadline.toISOString() : null,
          createFristenTask: Boolean(deadline),
        },
      });
    }

    await prisma.ingestionJob.update({
      where: { id: jobId },
      data: { status: "COMPLETED", completedAt: new Date(), pausedReason: null },
    });'''

iw.write_text(wt[: m.start()] + new + wt[m.end() :], encoding="utf-8")
print("ingestion patched OK")
