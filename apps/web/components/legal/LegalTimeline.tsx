"use client";

import { useEffect, useState } from "react";
import { Scale, CheckCircle2, Circle } from "lucide-react";
import { apiGet, apiPatch, type LegalTask } from "@/lib/api-client";
import { formatDate } from "@/lib/utils";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/shared/EmptyState";

const statusVariant = {
  TODO: "secondary" as const,
  IN_PROGRESS: "default" as const,
  DONE: "success" as const,
  BLOCKED: "destructive" as const,
};

export function LegalTimeline() {
  const [tasks, setTasks] = useState<LegalTask[]>([]);
  const [loading, setLoading] = useState(true);

  const load = () => apiGet<{ tasks: LegalTask[] }>("/legal/tasks").then((data) => setTasks(data.tasks));

  useEffect(() => {
    void load().finally(() => setLoading(false));
  }, []);

  const toggleDone = async (task: LegalTask) => {
    const next = task.status === "DONE" ? "TODO" : "DONE";
    await apiPatch(`/legal/tasks/${task.id}`, { status: next });
    await load();
  };

  if (loading) return <Skeleton className="h-96 rounded-lg" />;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Legal timeline</CardTitle>
      </CardHeader>
      <CardContent>
        {tasks.length === 0 ? (
          <EmptyState icon={Scale} title="No legal tasks" description="Add deadlines, filings, and compliance items." />
        ) : (
          <div className="relative space-y-0">
            <div className="absolute left-[15px] top-2 bottom-2 w-px bg-border" />
            {tasks.map((task) => (
              <div key={task.id} className="relative flex gap-4 pb-6 last:pb-0">
                <button
                  type="button"
                  onClick={() => void toggleDone(task)}
                  className="relative z-10 mt-1 shrink-0"
                >
                  {task.status === "DONE" ? (
                    <CheckCircle2 className="h-8 w-8 text-teal-400" />
                  ) : (
                    <Circle className="h-8 w-8 text-muted-foreground hover:text-teal-400" />
                  )}
                </button>
                <div className="flex-1 rounded-lg border border-border bg-muted/10 p-4">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div>
                      <p className={`font-medium ${task.status === "DONE" ? "line-through opacity-60" : ""}`}>
                        {task.title}
                      </p>
                      {task.description && (
                        <p className="mt-1 text-sm text-muted-foreground">{task.description}</p>
                      )}
                    </div>
                    <div className="flex gap-2">
                      <Badge variant="outline">{task.type}</Badge>
                      <Badge variant={statusVariant[task.status]}>{task.status}</Badge>
                    </div>
                  </div>
                  {task.dueDate && (
                    <p className="mt-2 text-xs text-muted-foreground">Due {formatDate(task.dueDate)}</p>
                  )}
                  {task.status !== "DONE" && task.status !== "BLOCKED" && (
                    <Button variant="ghost" size="sm" className="mt-2 h-7 px-2 text-xs" onClick={() => void apiPatch(`/legal/tasks/${task.id}`, { status: "IN_PROGRESS" }).then(load)}>
                      Mark in progress
                    </Button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
