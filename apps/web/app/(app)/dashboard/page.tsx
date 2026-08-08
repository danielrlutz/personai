"use client";

import { DailyBriefing } from "@/components/briefing/DailyBriefing";
import { BudgetOverview } from "@/components/finance/BudgetOverview";
import { QRBillList } from "@/components/finance/QRBillList";
import { LegalTimeline } from "@/components/legal/LegalTimeline";
import { IngestionQueue } from "@/components/ingest/IngestionQueue";
import { PersonalOverview } from "@/components/life/PersonalOverview";
import { HabitPanel } from "@/components/life/HabitPanel";

export default function DashboardPage() {
  return (
    <div className="space-y-8">
      <DailyBriefing />

      <section className="space-y-4">
        <div>
          <h2 className="text-lg font-medium tracking-tight">Business</h2>
          <p className="text-sm text-muted-foreground">Finance, legal deadlines, and document ingest.</p>
        </div>
        <div className="grid gap-6 lg:grid-cols-2">
          <BudgetOverview />
          <QRBillList />
        </div>
        <div className="grid gap-6 lg:grid-cols-2">
          <LegalTimeline />
          <IngestionQueue />
        </div>
      </section>

      <section className="space-y-4">
        <div>
          <h2 className="text-lg font-medium tracking-tight">Personal manners</h2>
          <p className="text-sm text-muted-foreground">
            Habits, household tasks, and goals — alongside business in one overview.
          </p>
        </div>
        <div className="grid gap-6 lg:grid-cols-2">
          <PersonalOverview />
          <HabitPanel />
        </div>
      </section>
    </div>
  );
}
