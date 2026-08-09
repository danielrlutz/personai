"use client";

import Link from "next/link";
import { Activity, Users } from "lucide-react";
import { ConfirmGate } from "@/components/confirm/ConfirmGate";
import { TriageInbox } from "@/components/home/TriageInbox";
import { FristenStrip } from "@/components/home/FristenStrip";
import { DailyBriefing } from "@/components/briefing/DailyBriefing";
import { Button } from "@/components/ui/button";
import { PageEnter } from "@/components/motion/PageEnter";

/**
 * Home = triage composition (Product) — not a KPI card dashboard (Design).
 * Confirm gate + Fristen sit in the morning flow; Activity is one hop away.
 */
export default function DashboardPage() {
  return (
    <PageEnter className="mx-auto max-w-3xl space-y-10">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0">
          <p className="text-xs font-medium uppercase tracking-[0.12em] text-muted-foreground">
            PersonAI
          </p>
          <h1 className="mt-1 font-display text-3xl tracking-tight text-foreground sm:text-4xl">
            Morning desk
          </h1>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" size="sm" asChild>
            <Link href="/activity/">
              <Activity className="mr-1.5 h-4 w-4" />
              Activity
            </Link>
          </Button>
          <Button size="sm" asChild>
            <Link href="/team/">
              <Users className="mr-1.5 h-4 w-4" />
              Team
            </Link>
          </Button>
        </div>
      </header>

      <TriageInbox />

      <ConfirmGate />

      <FristenStrip />

      <section className="space-y-3 border-t border-border/60 pt-8">
        <h2 className="font-display text-lg tracking-tight">Brief</h2>
        <p className="text-sm text-muted-foreground">
          Snapshot for Zurich morning — regenerate anytime. Not a metric wall.
        </p>
        <DailyBriefing compact />
      </section>
    </PageEnter>
  );
}
