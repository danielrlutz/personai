"use client";

import { useCallback, useEffect, useState } from "react";
import { Check, Plus, Sparkles, Undo2 } from "lucide-react";
import {
  apiDelete,
  apiGet,
  apiPatch,
  apiPost,
  type Habit,
  type HabitFrequency,
} from "@/lib/api-client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/shared/EmptyState";
import { ApiLoadError } from "@/components/shared/ApiLoadError";

const frequencies: HabitFrequency[] = ["DAILY", "WEEKLY", "CUSTOM"];

interface HabitPanelProps {
  refreshKey?: number;
  onChanged?: () => void;
  compact?: boolean;
}

export function HabitPanel({ refreshKey = 0, onChanged, compact = false }: HabitPanelProps) {
  const [habits, setHabits] = useState<Habit[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [frequency, setFrequency] = useState<HabitFrequency>("DAILY");
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    try {
      const data = await apiGet<{ habits: Habit[] }>("/life/habits");
      setHabits(data.habits);
    } catch (err) {
      setHabits([]);
      setError(err instanceof Error ? err.message : "Failed to load habits");
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
      await apiPost("/life/habits", { title: title.trim(), frequency });
      setTitle("");
      await load();
      onChanged?.();
    } finally {
      setSaving(false);
    }
  };

  const toggleLog = async (habit: Habit) => {
    const done = (habit.logs?.length ?? 0) >= habit.targetCount;
    if (done) {
      await apiDelete(`/life/habits/${habit.id}/log`);
    } else {
      await apiPost(`/life/habits/${habit.id}/log`, {});
    }
    await load();
    onChanged?.();
  };

  const toggleActive = async (habit: Habit) => {
    await apiPatch(`/life/habits/${habit.id}`, { active: !habit.active });
    await load();
    onChanged?.();
  };

  if (loading) return <Skeleton className="h-72 rounded-lg" />;

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-base">
          <Sparkles className="h-4 w-4 text-primary" />
          Habits
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {!compact && (
          <form onSubmit={(e) => void create(e)} className="flex flex-col gap-2 sm:flex-row">
            <Input
              placeholder="New habit"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              required
            />
            <select
              value={frequency}
              onChange={(e) => setFrequency(e.target.value as HabitFrequency)}
              className="flex h-10 rounded-md border border-input bg-muted/30 px-3 text-sm focus-ring"
            >
              {frequencies.map((f) => (
                <option key={f} value={f}>
                  {f}
                </option>
              ))}
            </select>
            <Button type="submit" disabled={saving} className="shrink-0">
              <Plus className="h-4 w-4" />
              Add
            </Button>
          </form>
        )}

        {error ? (
          <ApiLoadError message={error} onRetry={() => void load()} />
        ) : habits.length === 0 ? (
          <EmptyState
            icon={Sparkles}
            title="No habits yet"
            description="Track daily or weekly personal routines — only real entries appear here."
          />
        ) : (
          <ul className="space-y-2">
            {habits
              .filter((h) => (compact ? h.active : true))
              .map((habit) => {
                const count = habit.logs?.length ?? 0;
                const done = count >= habit.targetCount;
                return (
                  <li
                    key={habit.id}
                    className="md-list-row justify-between rounded-md border border-border/60 px-3 py-2.5"
                  >
                    <div className="min-w-0">
                      <p className={`truncate text-sm font-medium ${!habit.active ? "opacity-50" : ""}`}>
                        {habit.title}
                      </p>
                      <div className="mt-1 flex flex-wrap gap-1.5">
                        <Badge variant="outline">{habit.frequency}</Badge>
                        {!habit.active && <Badge variant="secondary">Paused</Badge>}
                        <span className="text-xs text-muted-foreground tabular-nums">
                          {count}/{habit.targetCount} today
                        </span>
                      </div>
                    </div>
                    <div className="flex shrink-0 items-center gap-1">
                      {!compact && (
                        <Button variant="ghost" size="sm" onClick={() => void toggleActive(habit)}>
                          {habit.active ? "Pause" : "Resume"}
                        </Button>
                      )}
                      <Button
                        variant={done ? "secondary" : "default"}
                        size="sm"
                        onClick={() => void toggleLog(habit)}
                        disabled={!habit.active}
                      >
                        {done ? <Undo2 className="h-3.5 w-3.5" /> : <Check className="h-3.5 w-3.5" />}
                        {done ? "Undo" : "Log"}
                      </Button>
                    </div>
                  </li>
                );
              })}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
