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
import {
  isPersonalFirst,
  showsBusinessSection,
  showsPersonalSection,
  useUsageMode,
} from "@/lib/usage-mode";

export default function DashboardPage() {
  const { usageMode } = useUsageMode();
  const personalFirst = isPersonalFirst(usageMode);
  const showPersonal = showsPersonalSection(usageMode);
  const showBusiness = showsBusinessSection(usageMode);

  const lifeSection = showPersonal ? (
    <section className="space-y-4">
      <div className="min-w-0">
        <h2 className="section-title">Life</h2>
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
  ) : null;

  const opsSection = showBusiness ? (
    <section className="space-y-4">
      <div className="min-w-0">
        <h2 className="section-title">{usageMode === "BUSINESS" ? "Business" : "Money & docs"}</h2>
        <p className="section-subtitle">
          {usageMode === "BUSINESS"
            ? "Finance, legal, and documents for this profile."
            : "Finance, legal, and archive when you need them — nothing assumed."}
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
          <IngestionQueue liveUpdates={false} />
        </StaggerItem>
      </Stagger>
    </section>
  ) : (
    <section className="space-y-4">
      <div className="min-w-0">
        <h2 className="section-title">Money & docs</h2>
        <p className="section-subtitle">
          Budgets and documents stay available under Finance and Archive — no company setup required.
        </p>
      </div>
      <Stagger className="grid gap-4 lg:grid-cols-2">
        <StaggerItem>
          <BudgetOverview />
        </StaggerItem>
        <StaggerItem>
          <IngestionQueue liveUpdates={false} />
        </StaggerItem>
      </Stagger>
    </section>
  );

  return (
    <PageEnter className="mx-auto max-w-6xl space-y-8">
      <div className="page-header flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <h1 className="page-title">Home</h1>
          <p className="page-subtitle">
            {usageMode === "BUSINESS"
              ? "Your morning brief — ops first, life when you need it."
              : usageMode === "BOTH"
                ? "Your morning brief — personal life first, with money and docs close by."
                : "Your morning brief — life and health first. Finance stays available without company defaults."}
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

      {personalFirst ? (
        <>
          {lifeSection}
          {opsSection}
        </>
      ) : (
        <>
          {opsSection}
          {lifeSection}
        </>
      )}
    </PageEnter>
  );
}
