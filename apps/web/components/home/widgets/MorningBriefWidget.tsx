"use client";

import { DailyBriefing } from "@/components/briefing/DailyBriefing";

export function MorningBriefWidget() {
  return (
    <section className="space-y-3">
      <h2 className="font-display text-lg tracking-tight">Morning desk</h2>
      <p className="text-sm text-muted-foreground">
        A calm Zurich snapshot — regenerate anytime. Confirms and Fristen wait below.
      </p>
      <DailyBriefing compact />
    </section>
  );
}
