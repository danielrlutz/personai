"use client";

import { Wallet, Scale, HeartPulse, Upload, AlertCircle } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatCHF } from "@/lib/utils";
import type { BriefingSnapshot } from "@/lib/api-client";

interface BriefingSnapshotCardsProps {
  snapshot: BriefingSnapshot;
}

export function BriefingSnapshotCards({ snapshot }: BriefingSnapshotCardsProps) {
  const cards = [
    {
      title: "Finance",
      icon: Wallet,
      accent: "text-teal-400",
      items: [
        { label: "Budget remaining", value: formatCHF(snapshot.finance.budgetRemainingChf) },
        { label: "Bills due today", value: String(snapshot.finance.billsDueToday.length) },
        { label: "Due this week", value: String(snapshot.finance.billsDueThisWeek) },
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
        { label: "Trend", value: snapshot.medical.notableTrend ?? "Stable" },
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

  return (
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
      {cards.map(({ title, icon: Icon, accent, items }) => (
        <Card key={title} className="overflow-hidden">
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-base">
              <Icon className={`h-4 w-4 ${accent}`} />
              {title}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {items.map((item) => (
              <div key={item.label} className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">{item.label}</span>
                <span className="font-medium">{item.value}</span>
              </div>
            ))}
          </CardContent>
        </Card>
      ))}

      {snapshot.finance.billsDueToday.length > 0 && (
        <Card className="sm:col-span-2 xl:col-span-4 border-amber-500/30 bg-amber-500/5">
          <CardContent className="flex items-start gap-3 p-4">
            <AlertCircle className="mt-0.5 h-5 w-5 text-amber-400" />
            <div>
              <p className="font-medium text-amber-200">Bills due today</p>
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
      )}
    </div>
  );
}
