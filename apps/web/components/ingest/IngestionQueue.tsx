"use client";

import { useCallback, useEffect, useState } from "react";
import { FileText, Loader2, CheckCircle2, XCircle, Clock } from "lucide-react";
import { apiGet, streamSSE, type IngestionJob } from "@/lib/api-client";
import { formatRelative } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/shared/EmptyState";
import { ApiLoadError } from "@/components/shared/ApiLoadError";
import { QueueStatusBanner } from "./QueueStatusBanner";

const statusConfig = {
  QUEUED: { icon: Clock, variant: "secondary" as const, label: "Queued" },
  PROCESSING: { icon: Loader2, variant: "default" as const, label: "Processing" },
  COMPLETED: { icon: CheckCircle2, variant: "success" as const, label: "Completed" },
  FAILED: { icon: XCircle, variant: "destructive" as const, label: "Failed" },
};

interface IngestionQueueProps {
  refreshKey?: number;
  /** Live SSE updates — off on Home to avoid background stream noise. */
  liveUpdates?: boolean;
}

export function IngestionQueue({ refreshKey, liveUpdates = true }: IngestionQueueProps) {
  const [jobs, setJobs] = useState<IngestionJob[]>([]);
  const [vram, setVram] = useState<{
    holder: string | null;
    waiting: number;
    pausedReason: string | null;
  }>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);

  const applyQueue = useCallback(
    (data: {
      jobs: IngestionJob[];
      vram?: { holder: string | null; waiting: number; pausedReason: string | null };
    }) => {
      setJobs(data.jobs);
      if (data.vram) setVram(data.vram);
    },
    [],
  );

  useEffect(() => {
    let abort: (() => void) | undefined;
    let mounted = true;

    const init = async () => {
      setError(null);
      setLoading(true);
      try {
        const data = await apiGet<{ jobs: IngestionJob[]; vram?: typeof vram }>("/ingest/queue");
        if (!mounted) return;
        applyQueue(data);
        setLoading(false);

        if (!liveUpdates) return;

        try {
          abort = await streamSSE("/ingest/queue/stream", {
            silent: true,
            onEvent: (event, payload) => {
              if (event === "queue" && typeof payload === "object" && payload) {
                applyQueue(payload as { jobs: IngestionJob[]; vram?: typeof vram });
              }
            },
          });
        } catch {
          // GET snapshot is enough when live stream is unavailable.
        }
      } catch (err) {
        if (mounted) {
          setJobs([]);
          setError(err instanceof Error ? err.message : "Failed to load document queue");
          setLoading(false);
        }
      }
    };

    void init();
    return () => {
      mounted = false;
      abort?.();
    };
  }, [applyQueue, liveUpdates, refreshKey, reloadToken]);

  const queuedCount = jobs.filter((j) => j.status === "QUEUED" || j.status === "PROCESSING").length;

  if (loading) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-14 rounded-lg" />
        <Skeleton className="h-52 rounded-lg" />
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <QueueStatusBanner vram={vram} queuedCount={queuedCount} />

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Document queue</CardTitle>
        </CardHeader>
        <CardContent>
          {error ? (
            <ApiLoadError message={error} onRetry={() => setReloadToken((n) => n + 1)} />
          ) : jobs.length === 0 ? (
            <EmptyState
              icon={FileText}
              title="Queue is empty"
              description="Drop a PDF or image above to extract Swiss QR bills, payments, and records."
            />
          ) : (
            <ul>
              {jobs.map((job) => {
                const config = statusConfig[job.status];
                const Icon = config.icon;
                return (
                  <li
                    key={job.id}
                    className="md-list-row flex-col items-stretch justify-between gap-2 px-0 py-2.5 sm:flex-row sm:items-center"
                  >
                    <div className="flex min-w-0 items-center gap-3">
                      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-surface-container-high">
                        <FileText className="h-4 w-4 text-muted-foreground" />
                      </div>
                      <div className="min-w-0">
                        <p className="md-label-large truncate" title={job.document.filename}>
                          {job.document.filename}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {(job.document.fileSize / 1024).toFixed(1)} KB · {formatRelative(job.createdAt)}
                        </p>
                        {job.errorMessage && (
                          <p className="mt-0.5 break-words text-xs text-destructive">
                            {job.errorMessage}
                          </p>
                        )}
                      </div>
                    </div>
                    <Badge variant={config.variant} className="w-fit shrink-0 gap-1">
                      <Icon className={`h-3 w-3 ${job.status === "PROCESSING" ? "animate-spin" : ""}`} />
                      {config.label}
                    </Badge>
                  </li>
                );
              })}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
