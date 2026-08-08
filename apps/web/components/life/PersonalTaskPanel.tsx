"use client";

import { useCallback, useEffect, useState } from "react";
import { CheckCircle2, Circle, ListTodo, Plus } from "lucide-react";
import { apiGet, apiPatch, apiPost, type PersonalTask, type PersonalTaskStatus } from "@/lib/api-client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/shared/EmptyState";
import { ApiLoadError } from "@/components/shared/ApiLoadError";
import { formatDate } from "@/lib/utils";

interface PersonalTaskPanelProps {
  refreshKey?: number;
  onChanged?: () => void;
}

export function PersonalTaskPanel({ refreshKey = 0, onChanged }: PersonalTaskPanelProps) {
  const [tasks, setTasks] = useState<PersonalTask[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    try {
      const data = await apiGet<{ tasks: PersonalTask[] }>("/life/tasks");
      setTasks(data.tasks);
    } catch (err) {
      setTasks([]);
      setError(err instanceof Error ? err.message : "Failed to load personal tasks");
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
      await apiPost("/life/tasks", {
        title: title.trim(),
        dueDate: dueDate || undefined,
      });
      setTitle("");
      setDueDate("");
      await load();
      onChanged?.();
    } finally {
      setSaving(false);
    }
  };

  const setStatus = async (task: PersonalTask, status: PersonalTaskStatus) => {
    await apiPatch(`/life/tasks/${task.id}`, { status });
    await load();
    onChanged?.();
  };

  if (loading) return <Skeleton className="h-72 rounded-lg" />;

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-base">
          <ListTodo className="h-4 w-4 text-primary" />
          Personal tasks
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <form onSubmit={(e) => void create(e)} className="grid gap-2 sm:grid-cols-[1fr_auto_auto]">
          <Input
            placeholder="Task title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            required
          />
          <Input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
          <Button type="submit" disabled={saving}>
            <Plus className="h-4 w-4" />
            Add
          </Button>
        </form>

        {error ? (
          <ApiLoadError message={error} onRetry={() => void load()} />
        ) : tasks.length === 0 ? (
          <EmptyState
            icon={ListTodo}
            title="No personal tasks"
            description="Capture personal to-dos here — the list stays empty until you add something real."
          />
        ) : (
          <ul className="space-y-2">
            {tasks.map((task) => (
              <li
                key={task.id}
                className="md-list-row justify-between rounded-md border border-border/60 px-3 py-2.5"
              >
                <div className="flex min-w-0 items-start gap-2.5">
                  <button
                    type="button"
                    className="mt-0.5 shrink-0"
                    onClick={() =>
                      void setStatus(task, task.status === "DONE" ? "TODO" : "DONE")
                    }
                  >
                    {task.status === "DONE" ? (
                      <CheckCircle2 className="h-5 w-5 text-primary" />
                    ) : (
                      <Circle className="h-5 w-5 text-muted-foreground hover:text-primary" />
                    )}
                  </button>
                  <div className="min-w-0">
                    <p
                      className={`truncate text-sm font-medium ${
                        task.status === "DONE" ? "line-through opacity-60" : ""
                      }`}
                    >
                      {task.title}
                    </p>
                    <div className="mt-1 flex flex-wrap items-center gap-1.5">
                      <Badge variant="outline">{task.status}</Badge>
                      {task.dueDate && (
                        <span className="text-xs text-muted-foreground">
                          Due {formatDate(task.dueDate)}
                        </span>
                      )}
                    </div>
                  </div>
                </div>
                {task.status !== "DONE" && task.status !== "CANCELLED" && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => void setStatus(task, "IN_PROGRESS")}
                  >
                    In progress
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
