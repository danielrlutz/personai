"use client";

import Link from "next/link";
import { Users } from "lucide-react";
import { DailyBriefing } from "@/components/briefing/DailyBriefing";
import { BudgetOverview } from "@/components/finance/BudgetOverview";
import { QRBillList } from "@/components/finance/QRBillList";
import { LegalTimeline } from "@/components/legal/LegalTimeline";
import { IngestionQueue } from "@/components/ingest/IngestionQueue";
import { ConfirmGate } from "@/components/confirm/ConfirmGate";
import { Button } from "@/components/ui/button";

export default function DashboardPage() {
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="md-title-large text-[26px] tracking-tight">Home</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Morning brief, pending confirms, and ops snapshot.
          </p>
        </div>
        <Button size="sm" asChild>
          <Link href="/team">
            <Users className="mr-2 h-4 w-4" />
            Open team
          </Link>
        </Button>
      </div>

      <DailyBriefing />
      <ConfirmGate />

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
