"use client";

import { useState } from "react";
import { LegalTimeline } from "@/components/legal/LegalTimeline";
import { LegalTaskForm } from "@/components/legal/LegalTaskForm";

export default function LegalPage() {
  const [refreshKey, setRefreshKey] = useState(0);

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Legal</h1>
        <p className="mt-1 text-muted-foreground">Deadlines, filings, and compliance tasks.</p>
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
