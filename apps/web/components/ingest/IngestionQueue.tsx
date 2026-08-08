"use client";

import { useCallback, useEffect, useState } from "react";
import { FileText, Loader2, CheckCircle2, XCircle, Clock } from "lucide-react";
import { apiGet, streamSSE, type IngestionJob } from "@/lib/api-client";
import { formatRelative } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/shared/EmptyState";
import { QueueStatusBanner } from "./QueueStatusBanner";

const statusConfig = {
  QUEUED: { icon: Clock, variant: "secondary" as const, label: "Queued" },
  PROCESSING: { icon: Loader2, variant: "default" as const, label: "Processing" },
  COMPLETED: { icon: CheckCircle2, variant: "success" as const, label: "Completed" },
  FAILED: { icon: XCircle, variant: "destructive" as const, label: "Failed" },
};

interface IngestionQueueProps {
  refreshKey?: number;
}

export function IngestionQueue({ refreshKey }: IngestionQueueProps) {
  const [jobs, setJobs] = useState<IngestionJob[]>([]);
  const [vram, setVram] = useState<{
    holder: string | null;
    waiting: number;
    pausedReason: string | null;
  }>();
  const [loading, setLoading] = useState(true);

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
      try {
        const data = await apiGet<{ jobs: IngestionJob[]; vram?: typeof vram }>("/ingest/queue");
        if (mounted) {
          applyQueue(data);
          setLoading(false);
        }
        abort = await streamSSE("/ingest/queue/stream", {
          onEvent: (event, payload) => {
            if (event === "queue" && typeof payload === "object" && payload) {
              applyQueue(payload as { jobs: IngestionJob[]; vram?: typeof vram });
            }
          },
        });
      } catch {
        if (mounted) setLoading(false);
      }
    };

    void init();
    return () => {
      mounted = false;
      abort?.();
    };
  }, [applyQueue, refreshKey]);

  const queuedCount = jobs.filter((j) => j.status === "QUEUED" || j.status === "PROCESSING").length;

  if (loading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-16 rounded-lg" />
        <Skeleton className="h-64 rounded-lg" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <QueueStatusBanner vram={vram} queuedCount={queuedCount} />

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Ingestion queue</CardTitle>
        </CardHeader>
        <CardContent>
          {jobs.length === 0 ? (
            <EmptyState
              icon={FileText}
              title="No ingestion jobs"
              description="Upload documents to start extracting data."
            />
          ) : (
            <ul className="divide-y divide-border">
              {jobs.map((job) => {
                const config = statusConfig[job.status];
                const Icon = config.icon;
                return (
                  <li key={job.id} className="flex items-center justify-between py-4 first:pt-0 last:pb-0">
                    <div className="flex items-center gap-3">
                      <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-muted/30">
                        <FileText className="h-5 w-5 text-muted-foreground" />
                      </div>
                      <div>
                        <p className="text-sm font-medium">{job.document.filename}</p>
                        <p className="text-xs text-muted-foreground">
                          {(job.document.fileSize / 1024).toFixed(1)} KB · {formatRelative(job.createdAt)}
                        </p>
                        {job.errorMessage && (
                          <p className="mt-1 text-xs text-red-400">{job.errorMessage}</p>
                        )}
                      </div>
                    </div>
                    <Badge variant={config.variant} className="gap-1">
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
