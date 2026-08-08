"use client";

import { useState } from "react";
import Link from "next/link";
import { FileDown } from "lucide-react";
import { ComplaintForm } from "@/components/medical/ComplaintForm";
import { ComplaintTimeline } from "@/components/medical/ComplaintTimeline";
import { DualAnalysisPanel } from "@/components/medical/DualAnalysisPanel";
import { Button } from "@/components/ui/button";

export default function MedicalPage() {
  const [refreshKey, setRefreshKey] = useState(0);

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Medical</h1>
          <p className="mt-1 text-muted-foreground">Track complaints and dual-framework analysis.</p>
        </div>
        <Button variant="outline" asChild>
          <Link href="/medical/export">
            <FileDown className="mr-2 h-4 w-4" />
            Export report
          </Link>
        </Button>
      </div>
      <div className="grid gap-6 lg:grid-cols-3">
        <div className="lg:col-span-1">
          <ComplaintForm onCreated={() => setRefreshKey((k) => k + 1)} />
        </div>
        <div className="lg:col-span-2 space-y-6">
          <ComplaintTimeline refreshKey={refreshKey} />
          <DualAnalysisPanel key={refreshKey} />
        </div>
      </div>
    </div>
  );
}
