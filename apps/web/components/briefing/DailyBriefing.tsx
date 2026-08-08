"use client";

import { useCallback, useEffect, useState } from "react";
import { RefreshCw, Sun } from "lucide-react";
import { apiGet, apiPost, type DailyBriefing } from "@/lib/api-client";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { BriefingSnapshotCards } from "./BriefingSnapshotCards";
import { BriefingNarrative } from "./BriefingNarrative";
import { BriefingActionItems } from "./BriefingActionItems";

export function DailyBriefing() {
  const [briefing, setBriefing] = useState<DailyBriefing | null>(null);
  const [loading, setLoading] = useState(true);
  const [regenerating, setRegenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const data = await apiGet<DailyBriefing>("/briefing/today");
      setBriefing(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load briefing");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const regenerate = async () => {
    setRegenerating(true);
    try {
      const data = await apiPost<DailyBriefing>("/briefing/generate");
      setBriefing(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to regenerate");
    } finally {
      setRegenerating(false);
    }
  };

  if (loading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-28 w-full rounded-lg" />
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-40 rounded-lg" />
          ))}
        </div>
      </div>
    );
  }

  if (error || !briefing) {
    return (
      <div className="rounded-lg border border-destructive/30 bg-destructive/10 p-6 text-center">
        <p className="text-destructive">{error ?? "Briefing unavailable"}</p>
        <Button className="mt-4" onClick={() => void load()}>
          Retry
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="surface-card animate-in p-6 sm:p-8">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <div className="mb-2 flex items-center gap-2 text-primary">
              <Sun className="h-5 w-5" />
              <span className="md-label-large">Daily briefing</span>
            </div>
            <h1 className="md-title-large text-[28px] tracking-tight">
              {briefing.snapshot.greeting}
            </h1>
            <p className="mt-2 md-body-medium text-muted-foreground">
              {new Date(briefing.briefingDate).toLocaleDateString("de-CH", {
                weekday: "long",
                day: "numeric",
                month: "long",
                year: "numeric",
              })}
            </p>
          </div>
          <Button variant="outline" onClick={() => void regenerate()} disabled={regenerating}>
            <RefreshCw className={`h-4 w-4 ${regenerating ? "animate-spin" : ""}`} />
            Refresh snapshot
          </Button>
        </div>
      </div>

      <BriefingSnapshotCards snapshot={briefing.snapshot} />

      <div className="grid gap-4 lg:grid-cols-2">
        <BriefingNarrative initialNarrative={briefing.narrative} tier={briefing.tier} />
        <BriefingActionItems snapshot={briefing.snapshot} />
      </div>
    </div>
  );
}
