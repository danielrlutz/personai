import type { PrismaClient } from "@prisma/client";
import { config } from "../config.js";
import { buildKnowledgeInjection } from "../archive/drive-knowledge/index.js";
import { resolveOllamaHost, streamChat } from "../ollama/client.js";
import { vramLock } from "../ollama/vram-lock.js";
import { getActiveProfileId } from "../db/prisma-singleton.js";
import { buildPersonalTodaySummary, type PersonalTodaySummary } from "../life/life-service.js";
import {
  formatBriefingUserCare,
  getCeoProfileCard,
  listRecentMemoryFacts,
  type CeoProfileCard,
  type MemoryFactCard,
} from "../memory/user-care.js";

export type BriefingSnapshot = {
  greeting: string;
  finance: {
    /** Remaining budget when real spend exists; null when limits are unused templates. */
    budgetRemainingChf: number | null;
    /** True when category limits exist but no expenses/transactions this month. */
    budgetIsTemplateOnly: boolean;
    monthlyLimitChf: number;
    spentThisMonthChf: number;
    billsDueToday: Array<{ creditor: string; amount: number }>;
    billsDueThisWeek: number;
    recentTransactions: number;
  };
  legal: {
    tasksDueToday: Array<{ title: string; type: string }>;
    overdueTasks: number;
    upcomingThisWeek: number;
  };
  medical: {
    recentComplaints: number;
    avgMoodScore7d: number | null;
    notableTrend: string | null;
  };
  ingest: {
    queuedJobs: number;
    completedYesterday: number;
  };
  /** Personal manners / Life pillar — habits, goals, touchpoints (honest empty when unused). */
  personal: PersonalTodaySummary;
  /** Compact CEO card + bounded memory facts for narrative context. */
  userCare: {
    ceo: CeoProfileCard;
    memoryFacts: MemoryFactCard[];
  };
};

function startOfDay(d = new Date()): Date {
  // Use local calendar day at noon to avoid UTC date rollover in SQLite/JSON
  const x = new Date(d.getFullYear(), d.getMonth(), d.getDate(), 12, 0, 0, 0);
  return x;
}

function endOfDay(d = new Date()): Date {
  const x = new Date(d);
  x.setHours(23, 59, 59, 999);
  return x;
}

function addDays(d: Date, n: number): Date {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}

function greetingForNow(): string {
  const h = new Date().getHours();
  if (h < 11) return "Guten Morgen";
  if (h < 17) return "Guten Tag";
  return "Guten Abend";
}

export async function buildSnapshot(prisma: PrismaClient): Promise<BriefingSnapshot> {
  const todayStart = startOfDay();
  const todayEnd = endOfDay();
  const weekEnd = endOfDay(addDays(todayStart, 7));
  const yesterdayStart = startOfDay(addDays(todayStart, -1));
  const weekAgo = startOfDay(addDays(todayStart, -7));

  const categories = await prisma.budgetCategory.findMany({ include: { transactions: true } });
  let spent = 0;
  let limit = 0;
  const monthStart = new Date();
  monthStart.setDate(1);
  monthStart.setHours(0, 0, 0, 0);
  for (const cat of categories) {
    limit += cat.monthlyLimit ?? 0;
    spent += cat.transactions
      .filter((t) => t.type === "EXPENSE" && t.date >= monthStart)
      .reduce((s, t) => s + t.amount, 0);
  }

  const billsDueToday = await prisma.qRBill.findMany({
    where: {
      status: "PENDING",
      dueDate: { gte: todayStart, lte: todayEnd },
    },
  });

  const billsDueThisWeek = await prisma.qRBill.count({
    where: {
      status: "PENDING",
      dueDate: { gte: todayStart, lte: weekEnd },
    },
  });

  const recentTransactions = await prisma.transaction.count({
    where: { date: { gte: weekAgo } },
  });

  const monthExpenseCount = await prisma.transaction.count({
    where: { type: "EXPENSE", date: { gte: monthStart } },
  });

  // Do not present seed template limits (e.g. 4700 CHF) as "budget remaining".
  const budgetIsTemplateOnly = spent === 0 && monthExpenseCount === 0 && limit > 0;

  const tasksDueToday = await prisma.legalTask.findMany({
    where: {
      status: { in: ["TODO", "IN_PROGRESS"] },
      dueDate: { gte: todayStart, lte: todayEnd },
    },
  });

  const overdueTasks = await prisma.legalTask.count({
    where: {
      status: { in: ["TODO", "IN_PROGRESS"] },
      dueDate: { lt: todayStart },
    },
  });

  const upcomingThisWeek = await prisma.legalTask.count({
    where: {
      status: { in: ["TODO", "IN_PROGRESS"] },
      dueDate: { gte: todayStart, lte: weekEnd },
    },
  });

  const complaints = await prisma.complaintLog.findMany({
    where: { occurredAt: { gte: weekAgo } },
  });
  const moodScores = complaints.map((c) => c.moodScore).filter((m): m is number => m != null);
  const avgMood =
    moodScores.length > 0 ? moodScores.reduce((a, b) => a + b, 0) / moodScores.length : null;
  const sleepScores = complaints.map((c) => c.sleepHours).filter((s): s is number => s != null);
  const avgSleep =
    sleepScores.length > 0 ? sleepScores.reduce((a, b) => a + b, 0) / sleepScores.length : null;

  const queuedJobs = await prisma.ingestionJob.count({ where: { status: "QUEUED" } });
  const completedYesterday = await prisma.ingestionJob.count({
    where: {
      status: "COMPLETED",
      completedAt: { gte: yesterdayStart, lt: todayStart },
    },
  });

  const personal = await buildPersonalTodaySummary(prisma);
  const [ceo, memoryFacts] = await Promise.all([
    getCeoProfileCard(prisma),
    listRecentMemoryFacts(prisma),
  ]);

  return {
    greeting: greetingForNow(),
    userCare: { ceo, memoryFacts },
    finance: {
      budgetRemainingChf: budgetIsTemplateOnly ? null : Math.round((limit - spent) * 100) / 100,
      budgetIsTemplateOnly,
      monthlyLimitChf: Math.round(limit * 100) / 100,
      spentThisMonthChf: Math.round(spent * 100) / 100,
      billsDueToday: billsDueToday.map((b) => ({
        creditor: b.creditorName,
        amount: b.amount,
      })),
      billsDueThisWeek,
      recentTransactions,
    },
    legal: {
      tasksDueToday: tasksDueToday.map((t) => ({ title: t.title, type: t.type })),
      overdueTasks,
      upcomingThisWeek,
    },
    medical: {
      recentComplaints: complaints.length,
      avgMoodScore7d: avgMood != null ? Math.round(avgMood * 10) / 10 : null,
      notableTrend: avgSleep != null && avgSleep < 6 ? "sleep_down" : null,
    },
    ingest: {
      queuedJobs,
      completedYesterday,
    },
    personal,
  };
}

function snapshotNeedsRefresh(raw: string): boolean {
  try {
    const parsed = JSON.parse(raw) as Partial<BriefingSnapshot>;
    // Refresh cached snapshots that still expose template limits as "remaining",
    // that predate the Personal manners pillar, or that lack user-care memory.
    return (
      parsed.finance?.budgetIsTemplateOnly === undefined ||
      !parsed.personal ||
      !parsed.userCare
    );
  } catch {
    return true;
  }
}

export async function getOrCreateTodayBriefing(prisma: PrismaClient) {
  const day = startOfDay();
  let briefing = await prisma.dailyBriefing.findUnique({ where: { briefingDate: day } });
  if (!briefing) {
    const snapshot = await buildSnapshot(prisma);
    briefing = await prisma.dailyBriefing.create({
      data: {
        briefingDate: day,
        status: "PENDING",
        snapshot: JSON.stringify(snapshot),
      },
    });
  } else if (snapshotNeedsRefresh(briefing.snapshot)) {
    const snapshot = await buildSnapshot(prisma);
    briefing = await prisma.dailyBriefing.update({
      where: { id: briefing.id },
      data: { snapshot: JSON.stringify(snapshot) },
    });
  }
  return briefing;
}

export async function regenerateBriefing(prisma: PrismaClient) {
  const day = startOfDay();
  const snapshot = await buildSnapshot(prisma);
  return prisma.dailyBriefing.upsert({
    where: { briefingDate: day },
    create: {
      briefingDate: day,
      status: config.licenseTier === "pro" ? "GENERATING" : "READY",
      snapshot: JSON.stringify(snapshot),
      generatedAt: new Date(),
    },
    update: {
      status: config.licenseTier === "pro" ? "GENERATING" : "READY",
      snapshot: JSON.stringify(snapshot),
      narrative: null,
      generatedAt: new Date(),
    },
  });
}

export async function* streamBriefingNarrative(
  prisma: PrismaClient,
  signal?: AbortSignal,
): AsyncGenerator<string> {
  if (config.licenseTier !== "pro") {
    throw new Error("AI briefing narrative requires Pro license");
  }

  const briefing = await getOrCreateTodayBriefing(prisma);
  await prisma.dailyBriefing.update({
    where: { id: briefing.id },
    data: { status: "GENERATING" },
  });

  const [ceo, facts] = await Promise.all([
    getCeoProfileCard(prisma),
    listRecentMemoryFacts(prisma),
  ]);
  const knowledgeBlock = await buildKnowledgeInjection({
    profileId: getActiveProfileId(),
    query: "morning brief deadlines invoices fristen documents plans",
    charBudget: 1000,
    topK: 4,
  });
  const userCareBlock = formatBriefingUserCare(ceo, facts, knowledgeBlock);

  const release = await vramLock.acquire("REASONING");
  let full = "";
  try {
    const host = await resolveOllamaHost();
    const mode = ceo.usageMode;
    const scopeHint =
      mode === "PERSONAL"
        ? "Fokus: persönliches Leben (Habits, Tasks, Touchpoints, Goals, Medical). Finanzen nur kurz wenn Daten vorhanden — keine MWST/Unternehmens-Annahmen."
        : mode === "BUSINESS"
          ? "Fokus: Finanzen, Legal, Archive/Ingest. Persönliches nur wenn Daten vorhanden."
          : "Decke Life/Personal und Finanzen/Legal/Archive ab — ohne anzunehmen, dass die Person ein Unternehmen führt, ausser usageMode/Daten legen das nahe.";
    const system = `Du bist ein persönlicher Assistent für Personen in der Schweiz (de-CH) — privat, geschäftlich, oder beides (siehe usageMode).
Schreibe eine kurze, klare Tagesbriefing-Zusammenfassung auf Deutsch (de-CH).
Maximal 3 Absätze. Sei konkret und handlungsorientiert. Keine medizinische Diagnose.
${scopeHint}
Nur mit Daten aus dem Snapshot, nichts erfinden. Keine erfundenen Fristen, MWST-Quartale oder Compliance-Pflichten.
Wenn budgetIsTemplateOnly true ist, erwähne kein verfügbares Budget / Restbudget — die Kategorie-Limits sind nur Vorlagen.
Wenn personal-Felder leer/null/0 sind, sage ehrlich, dass dort noch nichts erfasst ist.
Nutze die Profil-Karte und Memory-Facts nur als kompakten Kontext (Name/Locale/usageMode/bekannte Fakten) — erfinde nichts dazu.

${userCareBlock}`;

    for await (const token of streamChat({
      host,
      model: config.reasoningModel,
      messages: [
        { role: "system", content: system },
        {
          role: "user",
          content: `Erstelle das Tagesbriefing (usageMode=${mode}) aus diesem Snapshot:\n${briefing.snapshot}`,
        },
      ],
      signal,
    })) {
      full += token;
      yield token;
    }

    await prisma.dailyBriefing.update({
      where: { id: briefing.id },
      data: {
        narrative: full,
        status: "READY",
        generatedAt: new Date(),
      },
    });
  } catch (err) {
    await prisma.dailyBriefing.update({
      where: { id: briefing.id },
      data: { status: "FAILED" },
    });
    throw err;
  } finally {
    await release();
  }
}
