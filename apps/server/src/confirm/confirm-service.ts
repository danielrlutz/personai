// @ts-nocheck
export async function createConfirmation(prisma, input) {
    return prisma.pendingConfirmation.create({
        data: {
            action: input.action,
            summary: input.summary,
            payload: JSON.stringify(input.payload),
            entity: input.entity,
            entityId: input.entityId,
            status: "pending",
        },
    });
}
export async function listPendingConfirmations(prisma) {
    return prisma.pendingConfirmation.findMany({
        where: { status: "pending" },
        orderBy: { createdAt: "desc" },
        take: 50,
    });
}
export async function getConfirmation(prisma, id) {
    return prisma.pendingConfirmation.findUnique({ where: { id } });
}
export async function markConfirmation(prisma, id, status) {
    return prisma.pendingConfirmation.update({
        where: { id },
        data: { status, resolvedAt: new Date() },
    });
}
export function parsePayload(raw) {
    try {
        return JSON.parse(raw);
    }
    catch {
        return {};
    }
}
//# sourceMappingURL=confirm-service.js.map