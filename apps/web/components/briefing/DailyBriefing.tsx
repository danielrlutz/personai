"use client";

import { useCallback, useEffect, useState } from "react";
import { RefreshCw } from "lucide-react";
import { apiGet, apiPost, type DailyBriefing } from "@/lib/api-client";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { BriefingNarrative } from "./BriefingNarrative";
import { BriefingActionItems } from "./BriefingActionItems";
import { useUsageMode } from "@/lib/usage-mode";

interface DailyBriefingProps {
  /** Home composition: greeting + narrative + actions — no KPI card grid. */
  compact?: boolean;
}

export function DailyBriefing({ compact = false }: DailyBriefingProps) {
  const { usageMode } = useUsageMode();
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
    return <Skeleton className="h-28 w-full rounded-2xl" />;
  }

  if (error || !briefing) {
    return (
      <div className="rounded-2xl border border-destructive/30 bg-destructive/10 p-5 text-center">
        <p className="text-sm text-destructive">{error ?? "Briefing unavailable"}</p>
        <Button className="mt-3" size="sm" onClick={() => void load()}>
          Retry
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-border bg-card p-5 shadow-elev-1">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            <h3 className="font-display text-2xl tracking-tight">{briefing.snapshot.greeting}</h3>
            <p className="mt-1 text-sm text-muted-foreground">
              {new Date(briefing.briefingDate).toLocaleDateString("de-CH", {
                weekday: "long",
                day: "numeric",
                month: "long",
              })}
            </p>
          </div>
          <Button variant="outline" size="sm" onClick={() => void regenerate()} disabled={regenerating}>
            <RefreshCw className={`h-4 w-4 ${regenerating ? "animate-spin" : ""}`} />
            Refresh
          </Button>
        </div>
      </div>

      {!compact ? (
        <div className="grid gap-4 lg:grid-cols-2">
          <BriefingNarrative initialNarrative={briefing.narrative} tier={briefing.tier} />
          <BriefingActionItems snapshot={briefing.snapshot} usageMode={usageMode} />
        </div>
      ) : (
        <div className="space-y-4">
          <BriefingNarrative initialNarrative={briefing.narrative} tier={briefing.tier} />
          <BriefingActionItems snapshot={briefing.snapshot} usageMode={usageMode} />
        </div>
      )}
    </div>
  );
}
