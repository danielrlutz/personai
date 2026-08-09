"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Upload } from "lucide-react";
import { apiGet, type IngestionJob } from "@/lib/api-client";
import { Button } from "@/components/ui/button";

export function ArchiveQueueWidget() {
  const [jobs, setJobs] = useState<IngestionJob[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void apiGet<{ jobs: IngestionJob[] }>("/ingest/queue", { silent: true })
      .then((d) => setJobs(d.jobs ?? []))
      .catch((err) => setError(err instanceof Error ? err.message : "Could not load queue"));
  }, []);

  if (error) {
    return <p className="text-sm text-destructive">{error}</p>;
  }

  const pending = jobs.filter((j) => {
    const s = (j.status ?? "").toUpperCase();
    return s === "QUEUED" || s === "PENDING" || s === "PROCESSING" || s === "RUNNING";
  });
  const failed = jobs.filter((j) => (j.status ?? "").toUpperCase() === "FAILED");

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <h2 className="font-display text-lg tracking-tight">Archive queue</h2>
        <Button variant="ghost" size="sm" asChild>
          <Link href="/ingest/">Archive</Link>
        </Button>
      </div>
      <div className="flex items-start gap-3 rounded-2xl border border-border/70 bg-card px-4 py-3.5">
        <Upload className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
        <div>
          {pending.length === 0 && failed.length === 0 ? (
            <>
              <p className="text-sm font-medium">Queue clear</p>
              <p className="text-xs text-muted-foreground">
                Drop files on Home or Archive when you have something to file.
              </p>
            </>
          ) : (
            <>
              <p className="text-sm font-medium">
                {pending.length} in progress
                {failed.length ? ` · ${failed.length} failed` : ""}
              </p>
              <p className="text-xs text-muted-foreground">
                Naming still needs your confirmation before Drive write.
              </p>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
