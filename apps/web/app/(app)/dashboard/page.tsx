"use client";

import { DailyBriefing } from "@/components/briefing/DailyBriefing";
import { BudgetOverview } from "@/components/finance/BudgetOverview";
import { QRBillList } from "@/components/finance/QRBillList";
import { LegalTimeline } from "@/components/legal/LegalTimeline";
import { IngestionQueue } from "@/components/ingest/IngestionQueue";

export default function DashboardPage() {
  return (
    <div className="space-y-5">
      <DailyBriefing />

      <div className="grid gap-4 lg:grid-cols-2">
        <BudgetOverview />
        <QRBillList />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <LegalTimeline />
        <IngestionQueue />
      </div>
    </div>
  );
}
