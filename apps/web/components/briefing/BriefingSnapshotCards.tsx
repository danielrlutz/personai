"use client";

import { Wallet, Scale, HeartPulse, Upload, AlertCircle, Receipt, Sparkles } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatCHF } from "@/lib/utils";
import type { BriefingSnapshot } from "@/lib/api-client";

interface BriefingSnapshotCardsProps {
  snapshot: BriefingSnapshot;
}

function formatBudgetRemaining(value: number | null, templateOnly?: boolean): string {
  if (value == null || templateOnly) return "No spending yet";
  return formatCHF(value);
}

export function BriefingSnapshotCards({ snapshot }: BriefingSnapshotCardsProps) {
  const billsToday = snapshot.finance.billsDueToday.length;
  const billsWeek = snapshot.finance.billsDueThisWeek;
  const personal = snapshot.personal;

  const businessCards = [
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
        { label: "Due today", value: String(snapshot.legal.tasksDueToday.length) },
        { label: "Overdue", value: String(snapshot.legal.overdueTasks) },
        { label: "This week", value: String(snapshot.legal.upcomingThisWeek) },
      ],
    },
    {
      title: "Medical",
      icon: HeartPulse,
      accent: "text-rose-400",
      items: [
        { label: "Recent complaints", value: String(snapshot.medical.recentComplaints) },
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
    },
    {
      title: "Ingest",
      icon: Upload,
      accent: "text-amber-400",
      items: [
        { label: "Queued jobs", value: String(snapshot.ingest.queuedJobs) },
        { label: "Completed yesterday", value: String(snapshot.ingest.completedYesterday) },
      ],
    },
  ];

  const personalCards = personal
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
      ]
    : [];

  return (
    <div className="space-y-5">
      <div className="space-y-3">
        <h3 className="text-sm font-medium text-muted-foreground">Business</h3>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {businessCards.map(({ title, icon: Icon, accent, items }) => (
            <Card key={title} className="overflow-hidden">
              <CardHeader className="pb-1.5">
                <CardTitle className="flex items-center gap-2 text-sm">
                  <Icon className={`h-4 w-4 ${accent}`} />
                  {title}
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-1.5">
                {items.map((item) => (
                  <div key={item.label} className="flex items-center justify-between gap-2 text-sm">
                    <span className="text-muted-foreground">{item.label}</span>
                    <span className="text-right font-medium tabular-nums">{item.value}</span>
                  </div>
                ))}
              </CardContent>
            </Card>
          ))}
        </div>
      </div>

      <div className="space-y-3">
        <h3 className="text-sm font-medium text-muted-foreground">Personal manners</h3>
        {personalCards.length === 0 ? (
          <Card>
            <CardContent className="flex items-center gap-3 p-4">
              <Sparkles className="h-5 w-5 shrink-0 text-muted-foreground" />
              <div>
                <p className="text-sm font-medium">Personal pillar not in this briefing yet</p>
                <p className="text-xs text-muted-foreground">
                  Regenerate the briefing after Life data is available for this profile.
                </p>
              </div>
            </CardContent>
          </Card>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {personalCards.map(({ title, icon: Icon, accent, items }) => (
              <Card key={title} className="overflow-hidden">
                <CardHeader className="pb-1.5">
                  <CardTitle className="flex items-center gap-2 text-sm">
                    <Icon className={`h-4 w-4 ${accent}`} />
                    {title}
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-1.5">
                  {items.map((item) => (
                    <div key={item.label} className="flex items-center justify-between gap-2 text-sm">
                      <span className="text-muted-foreground">{item.label}</span>
                      <span className="text-right font-medium tabular-nums">{item.value}</span>
                    </div>
                  ))}
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>

      {billsToday > 0 ? (
        <Card className="border-warning/30 bg-warning/5">
          <CardContent className="flex items-start gap-3 p-4">
            <AlertCircle className="mt-0.5 h-5 w-5 shrink-0 text-warning" />
            <div>
              <p className="font-medium text-warning">Bills due today</p>
              <ul className="mt-1 space-y-1 text-sm text-muted-foreground">
                {snapshot.finance.billsDueToday.map((bill, i) => (
                  <li key={i}>
                    {bill.creditor} — {formatCHF(bill.amount)}
                  </li>
                ))}
              </ul>
            </div>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="flex items-center gap-3 p-4">
            <Receipt className="h-5 w-5 shrink-0 text-muted-foreground" />
            <div>
              <p className="text-sm font-medium">No bills due today</p>
              <p className="text-xs text-muted-foreground">
                {billsWeek === 0
                  ? "No pending QR bills this week — ingest a bill or add one under Finance."
                  : `${billsWeek} pending bill${billsWeek === 1 ? "" : "s"} due later this week.`}
              </p>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
