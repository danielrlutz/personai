"use client";

import { useCallback, useEffect, useState } from "react";
import { Plus, Target } from "lucide-react";
import {
  apiGet,
  apiPatch,
  apiPost,
  type PersonalGoal,
  type PersonalGoalStatus,
} from "@/lib/api-client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/shared/EmptyState";
import { ApiLoadError } from "@/components/shared/ApiLoadError";
import { formatDate } from "@/lib/utils";

const statuses: PersonalGoalStatus[] = ["ACTIVE", "PAUSED", "COMPLETED", "ABANDONED"];

interface GoalPanelProps {
  refreshKey?: number;
  onChanged?: () => void;
}

export function GoalPanel({ refreshKey = 0, onChanged }: GoalPanelProps) {
  const [goals, setGoals] = useState<PersonalGoal[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [targetDate, setTargetDate] = useState("");
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    try {
      const data = await apiGet<{ goals: PersonalGoal[] }>("/life/goals");
      setGoals(data.goals);
    } catch (err) {
      setGoals([]);
      setError(err instanceof Error ? err.message : "Failed to load goals");
    }
  }, []);

  useEffect(() => {
    setLoading(true);
    void load().finally(() => setLoading(false));
  }, [load, refreshKey]);

  const create = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) return;
    setSaving(true);
    try {
      await apiPost("/life/goals", {
        title: title.trim(),
        targetDate: targetDate || undefined,
      });
      setTitle("");
      setTargetDate("");
      await load();
      onChanged?.();
    } finally {
      setSaving(false);
    }
  };

  const updateStatus = async (goal: PersonalGoal, status: PersonalGoalStatus) => {
    await apiPatch(`/life/goals/${goal.id}`, {
      status,
      progress: status === "COMPLETED" ? 100 : goal.progress,
    });
    await load();
    onChanged?.();
  };

  if (loading) return <Skeleton className="h-72 rounded-lg" />;

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-base">
          <Target className="h-4 w-4 text-primary" />
          Goals
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <form onSubmit={(e) => void create(e)} className="grid gap-2 sm:grid-cols-[1fr_auto_auto]">
          <Input
            placeholder="Goal title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            required
          />
          <Input type="date" value={targetDate} onChange={(e) => setTargetDate(e.target.value)} />
          <Button type="submit" disabled={saving}>
            <Plus className="h-4 w-4" />
            Add
          </Button>
        </form>

        {error ? (
          <ApiLoadError message={error} onRetry={() => void load()} />
        ) : goals.length === 0 ? (
          <EmptyState
            icon={Target}
            title="No goals yet"
            description="Define personal goals when you have them — empty means unused, not fictional progress."
          />
        ) : (
          <ul className="space-y-2">
            {goals.map((goal) => (
              <li
                key={goal.id}
                className="rounded-md border border-border/60 px-3 py-2.5"
              >
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{goal.title}</p>
                    <div className="mt-1 flex flex-wrap items-center gap-1.5">
                      <Badge variant="outline">{goal.status}</Badge>
                      <span className="text-xs text-muted-foreground tabular-nums">
                        {Math.round(goal.progress)}%
                      </span>
                      {goal.targetDate && (
                        <span className="text-xs text-muted-foreground">
                          Target {formatDate(goal.targetDate)}
                        </span>
                      )}
                    </div>
                  </div>
                  <select
                    value={goal.status}
                    onChange={(e) =>
                      void updateStatus(goal, e.target.value as PersonalGoalStatus)
                    }
                    className="h-8 rounded-md border border-input bg-muted/30 px-2 text-xs focus-ring"
                  >
                    {statuses.map((s) => (
                      <option key={s} value={s}>
                        {s}
                      </option>
                    ))}
                  </select>
                </div>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
