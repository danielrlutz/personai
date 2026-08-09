"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Sparkles, CheckCircle2, Circle, Users, Target } from "lucide-react";
import { apiGet, type PersonalTodaySummary } from "@/lib/api-client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/shared/EmptyState";
import { ApiLoadError } from "@/components/shared/ApiLoadError";
import { Button } from "@/components/ui/button";

interface PersonalOverviewProps {
  refreshKey?: number;
}

export function PersonalOverview({ refreshKey = 0 }: PersonalOverviewProps) {
  const [summary, setSummary] = useState<PersonalTodaySummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const data = await apiGet<PersonalTodaySummary>("/life/today");
      setSummary(data);
    } catch (err) {
      setSummary(null);
      setError(err instanceof Error ? err.message : "Failed to load personal summary");
    }
  }, []);

  useEffect(() => {
    setLoading(true);
    void load().finally(() => setLoading(false));
  }, [load, refreshKey]);

  if (loading) return <Skeleton className="h-56 rounded-lg" />;

  if (error) {
    return (
      <Card>
        <CardContent className="pt-5">
          <ApiLoadError message={error} onRetry={() => void load()} />
        </CardContent>
      </Card>
    );
  }

  if (!summary) {
    return (
      <Card>
        <CardContent className="pt-5">
          <EmptyState
            icon={Sparkles}
            title="No personal data yet"
            description="Add habits, tasks, and relationship follow-ups under Life."
            action={
              <Button variant="outline" size="sm" asChild>
                <Link href="/life">Open Life</Link>
              </Button>
            }
          />
        </CardContent>
      </Card>
    );
  }

  const empty =
    summary.habitsDueToday === 0 &&
    summary.tasksDueToday.length === 0 &&
    summary.touchpointsDue.length === 0 &&
    summary.activeGoals === 0;

  if (empty) {
    return (
      <Card>
        <CardHeader className="pb-1.5">
          <CardTitle className="flex items-center gap-2 text-base">
            <Sparkles className="h-4 w-4 text-primary" />
            Personal manners
          </CardTitle>
        </CardHeader>
        <CardContent>
          <EmptyState
            icon={Sparkles}
            title="Nothing tracked yet"
            description="Habits, personal tasks, goals, and relationship touchpoints will show here once you add them."
            action={
              <Button variant="outline" size="sm" asChild>
                <Link href="/life">Start in Life</Link>
              </Button>
            }
          />
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader className="pb-1.5">
        <CardTitle className="flex items-center justify-between gap-2 text-base">
          <span className="flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-primary" />
            Personal manners
          </span>
          <Button variant="ghost" size="sm" asChild>
            <Link href="/life">Open Life</Link>
          </Button>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-3">
          <div className="rounded-md bg-surface-container px-3 py-2">
            <p className="text-xs text-muted-foreground">Habits today</p>
            <p className="mt-0.5 text-lg font-medium tabular-nums">
              {summary.habitsCompletedToday}/{summary.habitsDueToday}
            </p>
          </div>
          <div className="rounded-md bg-surface-container px-3 py-2">
            <p className="text-xs text-muted-foreground">Tasks due</p>
            <p className="mt-0.5 text-lg font-medium tabular-nums">{summary.tasksDueToday.length}</p>
          </div>
          <div className="rounded-md bg-surface-container px-3 py-2">
            <p className="text-xs text-muted-foreground">Touchpoints due</p>
            <p className="mt-0.5 text-lg font-medium tabular-nums">{summary.touchpointsDue.length}</p>
          </div>
        </div>

        {summary.habitsPending.length > 0 && (
          <div>
            <p className="mb-1.5 flex items-center gap-1.5 text-xs text-muted-foreground">
              <Circle className="h-3.5 w-3.5" /> Pending habits
            </p>
            <ul className="space-y-1 text-sm">
              {summary.habitsPending.slice(0, 4).map((h) => (
                <li key={h.id} className="truncate">
                  {h.title}
                </li>
              ))}
            </ul>
          </div>
        )}

        {summary.tasksDueToday.length > 0 && (
          <div>
            <p className="mb-1.5 flex items-center gap-1.5 text-xs text-muted-foreground">
              <CheckCircle2 className="h-3.5 w-3.5" /> Tasks due today
            </p>
            <ul className="space-y-1 text-sm">
              {summary.tasksDueToday.slice(0, 4).map((t) => (
                <li key={t.id} className="truncate">
                  {t.title}
                </li>
              ))}
            </ul>
          </div>
        )}

        <div className="flex flex-wrap gap-4 text-xs text-muted-foreground">
          <span className="flex items-center gap-1">
            <Target className="h-3.5 w-3.5" />
            {summary.activeGoals} active goal{summary.activeGoals === 1 ? "" : "s"}
          </span>
          <span className="flex items-center gap-1">
            <Users className="h-3.5 w-3.5" />
            {summary.overdueTasks} overdue task{summary.overdueTasks === 1 ? "" : "s"}
          </span>
        </div>
      </CardContent>
    </Card>
  );
}
