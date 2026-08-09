import type { PrismaClient } from "@prisma/client";
import { listPendingConfirmations } from "../confirm/confirm-service.js";

export const MEMORY_FACT_INJECT_LIMIT = 20;
export const HISTORY_WINDOW = 20;
export const SESSION_SUMMARY_EVERY_N = 6;
export const CEO_PROFILE_ID = "default";

export type UsageMode = "PERSONAL" | "BUSINESS" | "BOTH";

export type CeoProfileCard = {
  displayName: string | null;
  company: string | null;
  usageMode: UsageMode;
  locale: string | null;
  language: string | null;
  timezone: string | null;
  briefHour: string | null;
  notes: string | null;
};

export type MemoryFactCard = {
  key: string;
  value: string;
  source: string | null;
  specialistId: string | null;
  updatedAt: string;
};

/** Aggregates + small pending lists — never full transaction arrays. */
export type SlimLiveOps = {
  specialist: string;
  finance: {
    categoryCount: number;
    monthlyLimitTotal: number;
    spentThisMonth: number;
    recentTxCount7d: number;
    pendingBills: Array<{
      creditor: string;
      amount: number;
      currency: string;
      dueDate: string | null;
    }>;
  };
  legal: {
    openTaskCount: number;
    tasks: Array<{
      title: string;
      type: string;
      status: string;
      dueDate: string | null;
    }>;
  };
  pendingConfirmations: Array<{
    id: string;
    action: string;
    summary: string;
  }>;
};

export async function ensureCeoProfile(prisma: PrismaClient) {
  return prisma.ceoProfile.upsert({
    where: { id: CEO_PROFILE_ID },
    create: { id: CEO_PROFILE_ID, usageMode: "PERSONAL" },
    update: {},
  });
}

export async function getCeoProfileCard(prisma: PrismaClient): Promise<CeoProfileCard> {
  const row = await ensureCeoProfile(prisma);
  return {
    displayName: row.displayName,
    company: row.company,
    usageMode: row.usageMode,
    locale: row.locale,
    language: row.language,
    timezone: row.timezone,
    briefHour: row.briefHour,
    notes: row.notes,
  };
}

export async function listRecentMemoryFacts(
  prisma: PrismaClient,
  take = MEMORY_FACT_INJECT_LIMIT,
): Promise<MemoryFactCard[]> {
  const rows = await prisma.memoryFact.findMany({
    orderBy: { updatedAt: "desc" },
    take,
  });
  return rows.map((r) => ({
    key: r.key,
    value: r.value,
    source: r.source,
    specialistId: r.specialistId,
    updatedAt: r.updatedAt.toISOString(),
  }));
}

export async function buildSlimLiveOps(
  prisma: PrismaClient,
  specialistId: string,
): Promise<SlimLiveOps> {
  const monthStart = new Date();
  monthStart.setDate(1);
  monthStart.setHours(0, 0, 0, 0);
  const weekAgo = new Date();
  weekAgo.setDate(weekAgo.getDate() - 7);
  weekAgo.setHours(0, 0, 0, 0);

  const categories = await prisma.budgetCategory.findMany({
    select: { monthlyLimit: true },
  });
  const monthlyLimitTotal = categories.reduce((s, c) => s + (c.monthlyLimit ?? 0), 0);

  const [spentAgg, recentTxCount7d, pendingBills, openTaskCount, tasks, pending] =
    await Promise.all([
      prisma.transaction.aggregate({
        where: { type: "EXPENSE", date: { gte: monthStart } },
        _sum: { amount: true },
      }),
      prisma.transaction.count({ where: { date: { gte: weekAgo } } }),
      prisma.qRBill.findMany({
        where: { status: "PENDING" },
        orderBy: { dueDate: "asc" },
        take: 5,
        select: {
          creditorName: true,
          amount: true,
          currency: true,
          dueDate: true,
        },
      }),
      prisma.legalTask.count({
        where: { status: { in: ["TODO", "IN_PROGRESS"] } },
      }),
      prisma.legalTask.findMany({
        where: { status: { in: ["TODO", "IN_PROGRESS"] } },
        orderBy: { dueDate: "asc" },
        take: 5,
        select: { title: true, type: true, status: true, dueDate: true },
      }),
      listPendingConfirmations(prisma),
    ]);

  return {
    specialist: specialistId,
    finance: {
      categoryCount: categories.length,
      monthlyLimitTotal,
      spentThisMonth: spentAgg._sum.amount ?? 0,
      recentTxCount7d,
      pendingBills: pendingBills.map((b) => ({
        creditor: b.creditorName,
        amount: b.amount,
        currency: b.currency,
        dueDate: b.dueDate?.toISOString() ?? null,
      })),
    },
    legal: {
      openTaskCount,
      tasks: tasks.map((t) => ({
        title: t.title,
        type: t.type,
        status: t.status,
        dueDate: t.dueDate?.toISOString() ?? null,
      })),
    },
    pendingConfirmations: pending.map((c: { id: string; action: string; summary: string }) => ({
      id: c.id,
      action: c.action,
      summary: c.summary,
    })),
  };
}

function compactCeoLine(ceo: CeoProfileCard): string {
  const parts: string[] = [`usageMode=${ceo.usageMode}`];
  if (ceo.displayName) parts.push(`name=${ceo.displayName}`);
  if (ceo.company) parts.push(`company=${ceo.company}`);
  if (ceo.locale) parts.push(`locale=${ceo.locale}`);
  if (ceo.language) parts.push(`language=${ceo.language}`);
  if (ceo.timezone) parts.push(`timezone=${ceo.timezone}`);
  if (ceo.briefHour) parts.push(`briefHour=${ceo.briefHour}`);
  if (ceo.notes) parts.push(`notes=${ceo.notes.slice(0, 240)}`);
  return parts.join("; ");
}

function compactFactsBlock(facts: MemoryFactCard[]): string {
  if (facts.length === 0) return "(none)";
  return facts.map((f) => `- ${f.key}: ${f.value}`).join("\n");
}

/** Compact user-care block for team chat / briefing system context. */
export function formatUserCareContext(opts: {
  ceo: CeoProfileCard;
  facts: MemoryFactCard[];
  liveOps: SlimLiveOps;
  sessionSummary?: string | null;
}): string {
  const blocks = [
    `Profile card: ${compactCeoLine(opts.ceo)}`,
    `Memory facts (≤${MEMORY_FACT_INJECT_LIMIT} recent):\n${compactFactsBlock(opts.facts)}`,
    `Live ops (slim JSON):\n${JSON.stringify(opts.liveOps)}`,
  ];
  if (opts.sessionSummary?.trim()) {
    blocks.push(`Session summary:\n${opts.sessionSummary.trim().slice(0, 800)}`);
  }
  return blocks.join("\n\n");
}

/** Compact profile + memory for briefing narrative (no live ops dump). */
export function formatBriefingUserCare(ceo: CeoProfileCard, facts: MemoryFactCard[]): string {
  return `Profile card: ${compactCeoLine(ceo)}\n\nMemory facts (≤${MEMORY_FACT_INJECT_LIMIT} recent):\n${compactFactsBlock(facts)}`;
}

/** Cheap rolling digest — no extra LLM call. */
export async function refreshSessionSummaryIfNeeded(
  prisma: PrismaClient,
  sessionId: string,
): Promise<void> {
  const assistantCount = await prisma.chatMessage.count({
    where: { sessionId, role: "ASSISTANT" },
  });
  if (assistantCount === 0 || assistantCount % SESSION_SUMMARY_EVERY_N !== 0) return;

  const recent = await prisma.chatMessage.findMany({
    where: { sessionId },
    orderBy: { createdAt: "desc" },
    take: 12,
    select: { role: true, content: true },
  });
  const lines = recent
    .reverse()
    .map((m) => {
      const role = m.role === "USER" ? "U" : m.role === "ASSISTANT" ? "A" : "S";
      const text = m.content.replace(/\s+/g, " ").trim().slice(0, 120);
      return `${role}: ${text}`;
    })
    .join(" | ");

  await prisma.chatSession.update({
    where: { id: sessionId },
    data: { sessionSummary: lines.slice(0, 800) },
  });
}
