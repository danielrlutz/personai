"use client";

import Link from "next/link";
import { Users } from "lucide-react";
import { DailyBriefing } from "@/components/briefing/DailyBriefing";
import { BudgetOverview } from "@/components/finance/BudgetOverview";
import { QRBillList } from "@/components/finance/QRBillList";
import { LegalTimeline } from "@/components/legal/LegalTimeline";
import { IngestionQueue } from "@/components/ingest/IngestionQueue";
import { ConfirmGate } from "@/components/confirm/ConfirmGate";
import { PersonalOverview } from "@/components/life/PersonalOverview";
import { HabitPanel } from "@/components/life/HabitPanel";
import { Button } from "@/components/ui/button";
import { PageEnter, Stagger, StaggerItem } from "@/components/motion/PageEnter";

export default function DashboardPage() {
  return (
    <PageEnter className="mx-auto max-w-6xl space-y-8">
      <div className="page-header flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <h1 className="page-title">Home</h1>
          <p className="page-subtitle">
            Your morning brief — work and personal life in one calm overview.
          </p>
        </div>
        <Button size="sm" asChild>
          <Link href="/team/">
            <Users className="mr-1.5 h-4 w-4" />
            Open team
          </Link>
        </Button>
      </div>

      <DailyBriefing />
      <ConfirmGate />

      <section className="space-y-4">
        <div className="min-w-0">
          <h2 className="section-title">Business</h2>
          <p className="section-subtitle">
            Finance, legal, and documents for this profile.
          </p>
        </div>
        <Stagger className="grid gap-4 lg:grid-cols-2">
          <StaggerItem>
            <BudgetOverview />
          </StaggerItem>
          <StaggerItem>
            <QRBillList />
          </StaggerItem>
          <StaggerItem>
            <LegalTimeline />
          </StaggerItem>
          <StaggerItem>
            <IngestionQueue />
          </StaggerItem>
        </Stagger>
      </section>

      <section className="space-y-4">
        <div className="min-w-0">
          <h2 className="section-title">Personal</h2>
          <p className="section-subtitle">
            Habits and today&apos;s focus — empty until you track something.
          </p>
        </div>
        <Stagger className="grid gap-4 lg:grid-cols-2">
          <StaggerItem>
            <PersonalOverview />
          </StaggerItem>
          <StaggerItem>
            <HabitPanel compact />
          </StaggerItem>
        </Stagger>
      </section>
    </PageEnter>
  );
}
