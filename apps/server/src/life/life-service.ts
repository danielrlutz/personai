import type { PrismaClient } from "@prisma/client";

export function startOfDay(d = new Date()): Date {
  // Local calendar day at noon to avoid UTC date rollover in SQLite/JSON
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 12, 0, 0, 0);
}

export function endOfDay(d = new Date()): Date {
  const x = new Date(d);
  x.setHours(23, 59, 59, 999);
  return x;
}

export type PersonalTodaySummary = {
  habitsDueToday: number;
  habitsCompletedToday: number;
  habitsPending: Array<{ id: string; title: string }>;
  tasksDueToday: Array<{ id: string; title: string }>;
  overdueTasks: number;
  touchpointsDue: Array<{ id: string; contactName: string }>;
  activeGoals: number;
  recentNotes: number;
  latestMetrics: Array<{ key: string; value: number; unit: string | null; recordedAt: string }>;
};

export async function buildPersonalTodaySummary(prisma: PrismaClient): Promise<PersonalTodaySummary> {
  const todayStart = startOfDay();
  const todayEnd = endOfDay();
  const weekAgo = startOfDay(new Date(todayStart.getTime() - 7 * 24 * 60 * 60 * 1000));

  const activeHabits = await prisma.habit.findMany({
    where: { active: true },
    include: {
      logs: {
        where: { loggedAt: { gte: todayStart, lte: todayEnd } },
      },
    },
    orderBy: { title: "asc" },
  });

  const habitsPending = activeHabits
    .filter((h) => h.logs.length < h.targetCount)
    .map((h) => ({ id: h.id, title: h.title }));

  const habitsCompletedToday = activeHabits.filter((h) => h.logs.length >= h.targetCount).length;

  const tasksDueToday = await prisma.personalTask.findMany({
    where: {
      status: { in: ["TODO", "IN_PROGRESS"] },
      dueDate: { gte: todayStart, lte: todayEnd },
    },
    orderBy: { dueDate: "asc" },
  });

  const overdueTasks = await prisma.personalTask.count({
    where: {
      status: { in: ["TODO", "IN_PROGRESS"] },
      dueDate: { lt: todayStart },
    },
  });

  const touchpointsDue = await prisma.relationshipTouchpoint.findMany({
    where: {
      OR: [{ nextDueAt: { lte: todayEnd } }, { nextDueAt: null, lastContactedAt: null }],
    },
    orderBy: { nextDueAt: "asc" },
    take: 20,
  });

  const activeGoals = await prisma.personalGoal.count({
    where: { status: "ACTIVE" },
  });

  const recentNotes = await prisma.personalNote.count({
    where: { updatedAt: { gte: weekAgo } },
  });

  const latestMetricsRaw = await prisma.lifestyleMetric.findMany({
    orderBy: { recordedAt: "desc" },
    take: 40,
  });
  const seenKeys = new Set<string>();
  const latestMetrics: PersonalTodaySummary["latestMetrics"] = [];
  for (const m of latestMetricsRaw) {
    if (seenKeys.has(m.key)) continue;
    seenKeys.add(m.key);
    latestMetrics.push({
      key: m.key,
      value: m.value,
      unit: m.unit,
      recordedAt: m.recordedAt.toISOString(),
    });
    if (latestMetrics.length >= 5) break;
  }

  return {
    habitsDueToday: activeHabits.length,
    habitsCompletedToday,
    habitsPending,
    tasksDueToday: tasksDueToday.map((t) => ({ id: t.id, title: t.title })),
    overdueTasks,
    touchpointsDue: touchpointsDue.map((t) => ({ id: t.id, contactName: t.contactName })),
    activeGoals,
    recentNotes,
    latestMetrics,
  };
}
