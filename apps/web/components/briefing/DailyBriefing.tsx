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
      <div className="space-y-4">
        <Skeleton className="h-28 w-full rounded-2xl" />
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-32 rounded-2xl" />
          ))}
        </div>
      </div>
    );
  }

  if (error || !briefing) {
    return (
      <div className="rounded-2xl border border-destructive/30 bg-destructive/10 p-6 text-center">
        <p className="text-sm text-destructive">{error ?? "Briefing unavailable"}</p>
        <Button className="mt-4" size="sm" onClick={() => void load()}>
          Retry
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div className="surface-card relative animate-in overflow-hidden p-6 sm:p-7">
        <div
          aria-hidden
          className="pointer-events-none absolute inset-x-0 top-0 h-24 opacity-80"
          style={{
            background:
              "radial-gradient(480px 120px at 12% 0%, hsl(214 89% 51% / 0.12), transparent 70%)",
          }}
        />
        <div className="relative flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            <div className="mb-2 flex items-center gap-2 text-primary">
              <span className="flex h-8 w-8 items-center justify-center rounded-full bg-primary-container">
                <Sun className="h-4 w-4 text-primary-on-container" />
              </span>
              <span className="md-label-large">Daily briefing</span>
            </div>
            <h2 className="truncate text-[1.65rem] font-semibold tracking-tight sm:text-[1.85rem]">
              {briefing.snapshot.greeting}
            </h2>
            <p className="mt-1.5 md-body-medium text-muted-foreground">
              {new Date(briefing.briefingDate).toLocaleDateString("de-CH", {
                weekday: "long",
                day: "numeric",
                month: "long",
                year: "numeric",
              })}
            </p>
          </div>
          <Button variant="outline" size="sm" onClick={() => void regenerate()} disabled={regenerating}>
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
