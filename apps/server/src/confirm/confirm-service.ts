// @ts-nocheck
import { createHash } from "node:crypto";

function fingerprintPayload(action, payload) {
  const raw = typeof payload === "string" ? payload : JSON.stringify(payload ?? {});
  return createHash("sha256").update(`${action}:${raw}`).digest("hex").slice(0, 24);
}

/**
 * Create a pending confirmation, or return the existing pending twin.
 * Prevents MEDICAL.EXPORT spam from repeated clicks / double-submits.
 */
export async function createConfirmation(prisma, input) {
  const entityId =
    input.entityId ??
    (input.dedupeKey ? String(input.dedupeKey) : fingerprintPayload(input.action, input.payload));

  if (entityId) {
    const existing = await prisma.pendingConfirmation.findFirst({
      where: {
        status: "pending",
        action: input.action,
        entityId,
      },
      orderBy: { createdAt: "desc" },
    });
    if (existing) {
      return prisma.pendingConfirmation.update({
        where: { id: existing.id },
        data: {
          summary: input.summary,
          payload: JSON.stringify(input.payload),
          entity: input.entity,
        },
      });
    }
  }

  return prisma.pendingConfirmation.create({
    data: {
      action: input.action,
      summary: input.summary,
      payload: JSON.stringify(input.payload),
      entity: input.entity,
      entityId,
      status: "pending",
    },
  });
}

/** Collapse identical pending rows (same action+summary) keeping the newest. */
export async function collapseDuplicatePending(prisma) {
  const pending = await prisma.pendingConfirmation.findMany({
    where: { status: "pending" },
    orderBy: { createdAt: "desc" },
  });
  const seen = new Set();
  let collapsed = 0;
  for (const row of pending) {
    const key = `${row.action}::${row.summary}::${row.entityId ?? ""}`;
    if (seen.has(key)) {
      await prisma.pendingConfirmation.update({
        where: { id: row.id },
        data: { status: "expired", resolvedAt: new Date() },
      });
      collapsed += 1;
    } else {
      seen.add(key);
    }
  }
  return collapsed;
}

export async function listPendingConfirmations(prisma) {
  await collapseDuplicatePending(prisma);
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
  } catch {
    return {};
  }
}
