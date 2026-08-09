"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Activity } from "lucide-react";
import { apiGet } from "@/lib/api-client";
import { labelForConfirmAction } from "@/lib/confirm-labels";
import { Button } from "@/components/ui/button";

type AuditLog = {
  id: string;
  action: string;
  createdAt: string;
};

export function ActivityRecentWidget() {
  const [logs, setLogs] = useState<AuditLog[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void apiGet<{ logs: AuditLog[] }>("/activity?limit=6", { silent: true })
      .then((d) => setLogs(d.logs))
      .catch((err) => setError(err instanceof Error ? err.message : "Could not load activity"));
  }, []);

  if (error) {
    return <p className="text-sm text-destructive">{error}</p>;
  }

  if (logs.length === 0) {
    return (
      <div className="flex items-start gap-3 rounded-2xl border border-border/70 bg-card px-4 py-3.5">
        <Activity className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
        <div>
          <p className="text-sm font-medium">No activity yet</p>
          <p className="text-xs text-muted-foreground">
            Confirms, archive writes, and triage show up here when they happen.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <h2 className="font-display text-lg tracking-tight">Activity</h2>
        <Button variant="ghost" size="sm" asChild>
          <Link href="/activity/">Full trail</Link>
        </Button>
      </div>
      <ul className="divide-y divide-border/60 rounded-2xl border border-border bg-card">
        {logs.map((log) => (
          <li key={log.id} className="flex flex-wrap items-baseline justify-between gap-2 px-4 py-2.5">
            <p className="truncate text-sm font-medium">{labelForConfirmAction(log.action)}</p>
            <time className="shrink-0 text-xs text-muted-foreground">
              {new Date(log.createdAt).toLocaleString("de-CH", {
                day: "2-digit",
                month: "short",
                hour: "2-digit",
                minute: "2-digit",
              })}
            </time>
          </li>
        ))}
      </ul>
    </div>
  );
}
