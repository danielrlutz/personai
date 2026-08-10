"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { CalendarClock } from "lucide-react";
import { apiGet, apiPost } from "@/lib/api-client";
import { Button } from "@/components/ui/button";
import { FristenCalendarPackButton } from "@/components/legal/FristenCalendarPackButton";

type FristItem = {
  id: string;
  kind: "legal_task" | "document";
  sourceId: string;
  title: string;
  dueDate: string | null;
  status: string;
  overdue: boolean;
};

export function FristenStrip() {
  const [items, setItems] = useState<FristItem[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void apiGet<{ items: FristItem[] }>("/fristen", { silent: true })
      .then((d) => setItems(d.items.slice(0, 5)))
      .catch((err) => setError(err instanceof Error ? err.message : "Could not load Fristen"));
  }, []);

  const markDone = async (item: FristItem) => {
    if (item.kind !== "legal_task") return;
    try {
      await apiPost(`/fristen/tasks/${item.sourceId}/done`);
      setItems((prev) => prev.filter((x) => x.id !== item.id));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not mark done");
    }
  };

  if (error) {
    return <p className="text-sm text-destructive">{error}</p>;
  }

  if (items.length === 0) {
    return (
      <div className="flex items-start gap-3 rounded-2xl border border-border/70 bg-card px-4 py-3.5">
        <CalendarClock className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
        <div>
          <p className="text-sm font-medium">No open Fristen</p>
          <p className="text-xs text-muted-foreground">
            Clear desk. Deadlines appear when archive OCR finds a date or you track a legal task.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-display text-lg tracking-tight">Fristen</h2>
        <div className="flex flex-wrap items-center gap-1">
          <FristenCalendarPackButton />
          <Button variant="ghost" size="sm" asChild>
            <Link href="/legal/">All deadlines</Link>
          </Button>
        </div>
      </div>
      <ul className="divide-y divide-border/60 rounded-2xl border border-border bg-card">
        {items.map((item) => (
          <li key={item.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3">
            <div className="min-w-0">
              <p className="truncate text-sm font-medium">{item.title}</p>
              <p className="text-xs text-muted-foreground">
                {item.dueDate
                  ? new Date(item.dueDate).toLocaleDateString("de-CH")
                  : "No date"}
                {item.overdue ? " · overdue" : ""}
              </p>
            </div>
            {item.kind === "legal_task" ? (
              <Button size="sm" variant="outline" onClick={() => void markDone(item)}>
                Done
              </Button>
            ) : (
              <Button size="sm" variant="ghost" asChild>
                <Link href="/ingest/">Archive</Link>
              </Button>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
