// @ts-nocheck
import { getConfirmation, markConfirmation, parsePayload, } from "./confirm-service.js";
async function applyLedgerWrite(prisma, payload) {
    const kind = String(payload.kind ?? "");
    const documentId = payload.documentId ? String(payload.documentId) : undefined;
    if (kind === "qr_bill") {
        const existing = documentId
            ? await prisma.qRBill.findFirst({ where: { documentId } })
            : null;
        if (existing)
            return existing;
        const bill = await prisma.qRBill.create({
            data: {
                creditorName: String(payload.creditorName ?? "Unknown"),
                iban: String(payload.iban ?? ""),
                amount: Number(payload.amount ?? 0),
                currency: String(payload.currency ?? "CHF"),
                reference: payload.reference ? String(payload.reference) : null,
                dueDate: payload.dueDate ? new Date(String(payload.dueDate)) : null,
                documentId: documentId ?? null,
                status: "PENDING",
            },
        });
        if (documentId) {
            await prisma.document.update({
                where: { id: documentId },
                data: {
                    archiveName: payload.archiveName ? String(payload.archiveName) : undefined,
                    archiveCategory: payload.archiveCategory ? Number(payload.archiveCategory) : undefined,
                    confirmedAt: new Date(),
                    deadline: payload.dueDate ? new Date(String(payload.dueDate)) : undefined,
                },
            });
        }
        return bill;
    }
    if (kind === "transaction") {
        const existing = documentId
            ? await prisma.transaction.findFirst({ where: { documentId } })
            : null;
        if (existing)
            return existing;
        const tx = await prisma.transaction.create({
            data: {
                type: payload.type ?? "EXPENSE",
                amount: Number(payload.amount ?? 0),
                currency: String(payload.currency ?? "CHF"),
                description: String(payload.description ?? "Expense"),
                date: payload.date ? new Date(String(payload.date)) : new Date(),
                documentId: documentId ?? null,
            },
        });
        if (documentId) {
            await prisma.document.update({
                where: { id: documentId },
                data: {
                    archiveName: payload.archiveName ? String(payload.archiveName) : undefined,
                    archiveCategory: payload.archiveCategory ? Number(payload.archiveCategory) : undefined,
                    confirmedAt: new Date(),
                },
            });
        }
        return tx;
    }
    throw new Error(`Unknown ledger write kind: ${kind}`);
}
async function applyArchiveCommit(prisma, payload) {
    const documentId = String(payload.documentId ?? "");
    if (!documentId)
        throw new Error("documentId required");
    const deadline = payload.deadline ? new Date(String(payload.deadline)) : null;
    const doc = await prisma.document.update({
        where: { id: documentId },
        data: {
            archiveName: payload.archiveName ? String(payload.archiveName) : undefined,
            archiveCategory: payload.archiveCategory ? Number(payload.archiveCategory) : undefined,
            deadline,
            confirmedAt: new Date(),
        },
    });
    if (payload.createFristenTask && deadline) {
        await prisma.legalTask.create({
            data: {
                title: `Frist: ${doc.archiveName ?? doc.filename}`,
                description: `From archive document ${doc.id}`,
                type: "DEADLINE",
                status: "TODO",
                dueDate: deadline,
                documentId: doc.id,
            },
        });
    }
    return doc;
}
async function applyQrMarkPaid(prisma, payload) {
    const billId = String(payload.billId ?? "");
    if (!billId)
        throw new Error("billId required");
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
export async function resolveConfirmation(prisma, id, decision) {
    const pending = await getConfirmation(prisma, id);
    if (!pending)
        throw new Error("Confirmation not found");
    if (pending.status !== "pending")
        throw new Error(`Already ${pending.status}`);
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
        case "forge.ship":
        case "medical.export":
        case "career.pdf":
        case "premium.spend":
            result = { acknowledged: true, action: pending.action, payload };
            break;
        default:
            throw new Error(`Unsupported action: ${pending.action}`);
    }
    const updated = await markConfirmation(prisma, id, "confirmed");
    await prisma.auditLog.create({
        data: {
            action: "confirm.accept",
            entity: pending.entity,
            entityId: pending.entityId ?? pending.id,
            metadata: JSON.stringify({ action: pending.action }),
        },
    });
    return { confirmation: updated, result };
}
//# sourceMappingURL=apply-confirmation.js.map