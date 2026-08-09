"use client";

import { DailyBriefing } from "@/components/briefing/DailyBriefing";

export function MorningBriefWidget() {
  return (
    <section className="space-y-3">
      <h2 className="font-display text-lg tracking-tight">Brief</h2>
      <p className="text-sm text-muted-foreground">
        Snapshot for Zurich morning — regenerate anytime. Not a metric wall.
      </p>
      <DailyBriefing compact />
    </section>
  );
}
