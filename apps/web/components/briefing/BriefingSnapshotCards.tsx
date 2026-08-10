"use client";

import { Wallet, Scale, HeartPulse, Upload, AlertCircle, Receipt, Sparkles } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatCHF } from "@/lib/utils";
import type { BriefingSnapshot, UsageMode } from "@/lib/api-client";
import { isPersonalFirst } from "@/lib/usage-mode";

interface BriefingSnapshotCardsProps {
  snapshot: BriefingSnapshot;
  usageMode?: UsageMode;
}

function formatBudgetRemaining(value: number | null, templateOnly?: boolean): string {
  if (value == null || templateOnly) return "No spending yet";
  return formatCHF(value);
}

type SnapshotCard = {
  title: string;
  icon: typeof Wallet;
  accent: string;
  items: Array<{ label: string; value: string }>;
};

function CardGrid({ cards, columns }: { cards: SnapshotCard[]; columns: string }) {
  return (
    <div className={`grid gap-3 ${columns}`}>
      {cards.map(({ title, icon: Icon, accent, items }, index) => (
        <Card
          key={title}
          className="animate-in overflow-hidden"
          style={{ animationDelay: `${index * 45}ms` }}
        >
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-sm">
              <Icon className={`h-4 w-4 ${accent}`} />
              {title}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {items.map((item) => (
              <div key={item.label} className="flex min-w-0 items-center justify-between gap-2 text-sm">
                <span className="truncate text-muted-foreground">{item.label}</span>
                <span className="shrink-0 text-right font-semibold tabular-nums tracking-tight">
                  {item.value}
                </span>
              </div>
            ))}
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

export function BriefingSnapshotCards({
  snapshot,
  usageMode = "PERSONAL",
}: BriefingSnapshotCardsProps) {
  const billsToday = snapshot.finance.billsDueToday.length;
  const billsWeek = snapshot.finance.billsDueThisWeek;
  const personal = snapshot.personal;
  const personalFirst = isPersonalFirst(usageMode);

  const financeLegalArchive: SnapshotCard[] = [
    {
      title: "Finance",
      icon: Wallet,
      accent: "text-primary",
      items: [
        {
          label: "Budget remaining",
          value: formatBudgetRemaining(
            snapshot.finance.budgetRemainingChf,
            snapshot.finance.budgetIsTemplateOnly,
          ),
        },
        { label: "Bills due today", value: billsToday === 0 ? "None" : String(billsToday) },
        { label: "Due this week", value: billsWeek === 0 ? "None" : String(billsWeek) },
      ],
    },
    {
      title: "Legal",
      icon: Scale,
      accent: "text-blue-400",
      items: [
        {
          label: "≤36h",
          value: String(snapshot.legal.urgentWithin36h?.length ?? 0),
        },
        { label: "Due today", value: String(snapshot.legal.tasksDueToday.length) },
        { label: "Overdue", value: String(snapshot.legal.overdueTasks) },
        { label: "This week", value: String(snapshot.legal.upcomingThisWeek) },
      ],
    },
    {
      title: "Archive",
      icon: Upload,
      accent: "text-amber-400",
      items: [
        { label: "In queue", value: String(snapshot.ingest.queuedJobs) },
        { label: "Done yesterday", value: String(snapshot.ingest.completedYesterday) },
      ],
    },
  ];

  const medicalCard: SnapshotCard = {
    title: "Medical",
    icon: HeartPulse,
    accent: "text-rose-400",
    items: [
      { label: "Recent entries", value: String(snapshot.medical.recentComplaints) },
      {
        label: "Avg mood (7d)",
        value: snapshot.medical.avgMoodScore7d != null ? `${snapshot.medical.avgMoodScore7d}/10` : "—",
      },
      {
        label: "Trend",
        value:
          snapshot.medical.notableTrend === "sleep_down"
            ? "Sleep ↓"
            : snapshot.medical.notableTrend ?? "—",
      },
    ],
  };

  const personalCards: SnapshotCard[] = personal
    ? [
        {
          title: "Habits",
          icon: Sparkles,
          accent: "text-primary",
          items: [
            {
              label: "Completed today",
              value: `${personal.habitsCompletedToday}/${personal.habitsDueToday}`,
            },
            {
              label: "Pending",
              value:
                personal.habitsPending.length === 0
                  ? personal.habitsDueToday === 0
                    ? "None tracked"
                    : "None"
                  : String(personal.habitsPending.length),
            },
          ],
        },
        {
          title: "Personal tasks",
          icon: Sparkles,
          accent: "text-blue-400",
          items: [
            { label: "Due today", value: String(personal.tasksDueToday.length) },
            {
              label: "Overdue",
              value: personal.overdueTasks === 0 ? "None" : String(personal.overdueTasks),
            },
          ],
        },
        {
          title: "Relationships",
          icon: Sparkles,
          accent: "text-rose-400",
          items: [
            {
              label: "Touchpoints due",
              value:
                personal.touchpointsDue.length === 0
                  ? "None"
                  : String(personal.touchpointsDue.length),
            },
            {
              label: "Active goals",
              value: personal.activeGoals === 0 ? "None" : String(personal.activeGoals),
            },
          ],
        },
        medicalCard,
      ]
    : [medicalCard];

  const lifeBlock = (
    <div className="space-y-3">
      <h3 className="text-xs font-semibold uppercase tracking-[0.08em] text-muted-foreground">
        Life
      </h3>
      {personalCards.length === 0 ? (
        <Card>
          <CardContent className="flex items-center gap-3 p-5">
            <Sparkles className="h-5 w-5 shrink-0 text-muted-foreground" />
            <div className="min-w-0">
              <p className="text-sm font-semibold tracking-tight">
                No personal summary in this briefing yet
              </p>
              <p className="mt-0.5 text-xs text-muted-foreground">
                Add something under Life, then regenerate the briefing.
              </p>
            </div>
          </CardContent>
        </Card>
      ) : (
        <CardGrid cards={personalCards} columns="sm:grid-cols-2 xl:grid-cols-4" />
      )}
    </div>
  );

  const opsCards =
    usageMode === "PERSONAL"
      ? financeLegalArchive.filter((c) => c.title === "Finance" || c.title === "Archive")
      : financeLegalArchive;

  const opsBlock = (
    <div className="space-y-3">
      <h3 className="text-xs font-semibold uppercase tracking-[0.08em] text-muted-foreground">
        {usageMode === "BUSINESS" ? "Business" : "Money & docs"}
      </h3>
      <CardGrid
        cards={opsCards}
        columns={opsCards.length >= 3 ? "sm:grid-cols-2 xl:grid-cols-3" : "sm:grid-cols-2"}
      />
    </div>
  );

  return (
    <div className="space-y-6">
      {personalFirst ? (
        <>
          {lifeBlock}
          {opsBlock}
        </>
      ) : (
        <>
          {opsBlock}
          {lifeBlock}
        </>
      )}

      {billsToday > 0 ? (
        <Card className="border-warning/30 bg-warning/5">
          <CardContent className="flex items-start gap-3 p-5">
            <AlertCircle className="mt-0.5 h-5 w-5 shrink-0 text-warning" />
            <div className="min-w-0">
              <p className="font-semibold tracking-tight text-warning">Bills due today</p>
              <ul className="mt-1.5 space-y-1 text-sm text-muted-foreground">
                {snapshot.finance.billsDueToday.map((bill, i) => (
                  <li key={i} className="truncate">
                    {bill.creditor} — {formatCHF(bill.amount)}
                  </li>
                ))}
              </ul>
            </div>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="flex items-center gap-3 p-5">
            <Receipt className="h-5 w-5 shrink-0 text-muted-foreground" />
            <div className="min-w-0">
              <p className="text-sm font-semibold tracking-tight">No bills due today</p>
              <p className="mt-0.5 text-xs text-muted-foreground">
                {billsWeek === 0
                  ? "No pending QR bills this week — add one under Finance when you need it."
                  : `${billsWeek} pending bill${billsWeek === 1 ? "" : "s"} due later this week.`}
              </p>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
