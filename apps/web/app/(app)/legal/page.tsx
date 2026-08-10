"use client";

import { useState } from "react";
import { LegalTimeline } from "@/components/legal/LegalTimeline";
import { LegalTaskForm } from "@/components/legal/LegalTaskForm";
import { FristenCalendarPackButton } from "@/components/legal/FristenCalendarPackButton";

export default function LegalPage() {
  const [refreshKey, setRefreshKey] = useState(0);

  return (
    <div className="space-y-8">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Legal</h1>
          <p className="mt-1 text-muted-foreground">
            Deadlines and filings you choose to track — nothing is seeded for you.
          </p>
        </div>
        <FristenCalendarPackButton label="Stage + download .ics" />
      </div>
      <div className="grid gap-6 lg:grid-cols-3">
        <div className="lg:col-span-1">
          <LegalTaskForm onCreated={() => setRefreshKey((k) => k + 1)} />
        </div>
        <div className="lg:col-span-2">
          <LegalTimeline key={refreshKey} />
        </div>
      </div>
    </div>
  );
}
