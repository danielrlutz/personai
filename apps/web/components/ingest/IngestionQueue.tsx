"use client";

import { useCallback, useEffect, useState } from "react";
import { FileText, Loader2, CheckCircle2, XCircle, Clock, X } from "lucide-react";
import {
  apiDelete,
  apiGet,
  streamSSE,
  type IngestQueueResponse,
  type IngestionJob,
} from "@/lib/api-client";
import { cancelConfirmMessage, formatElapsed, phaseLabel } from "@/lib/ingest-phase";
import { formatRelative } from "@/lib/utils";
import { toast } from "@/lib/toast";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
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

function canCancel(status: IngestionJob["status"]): boolean {
  return status === "QUEUED" || status === "FAILED" || status === "PROCESSING" || status === "COMPLETED";
}

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
  const [cancellingId, setCancellingId] = useState<string | null>(null);

  const applyQueue = useCallback((data: IngestQueueResponse) => {
    setJobs(data.jobs);
    if (data.vram) setVram(data.vram);
  }, []);

  useEffect(() => {
    let abort: (() => void) | undefined;
    let mounted = true;

    const init = async () => {
      setError(null);
      setLoading(true);
      try {
        const data = await apiGet<IngestQueueResponse>("/ingest/queue");
        if (!mounted) return;
        applyQueue(data);
        setLoading(false);

        if (!liveUpdates) return;

        try {
          abort = await streamSSE("/ingest/queue/stream", {
            silent: true,
            onEvent: (event, payload) => {
              if (event === "queue" && typeof payload === "object" && payload) {
                applyQueue(payload as IngestQueueResponse);
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

  const cancelJob = useCallback(async (job: IngestionJob) => {
    if (
      !window.confirm(
        cancelConfirmMessage({
          filename: job.document.filename,
          status: job.status,
          phase: job.phase,
        }),
      )
    ) {
      return;
    }
    setCancellingId(job.id);
    try {
      const result = await apiDelete<{
        ok: boolean;
        mode: "removed" | "cancelling";
        documentDeleted: boolean;
      }>(`/ingest/jobs/${job.id}`);
      if (result.mode === "cancelling") {
        toast.success("Cancel requested — finishes current OCR page, then removes.");
      } else {
        toast.success(
          result.documentDeleted
            ? "Removed — unconfirmed upload discarded. Drive archives untouched."
            : "Removed from queue. Confirmed archives kept.",
        );
      }
      setJobs((prev) => (result.mode === "removed" ? prev.filter((j) => j.id !== job.id) : prev));
      setReloadToken((n) => n + 1);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not remove from queue");
    } finally {
      setCancellingId(null);
    }
  }, []);

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
                const busy = cancellingId === job.id;
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
                          {(job.document.fileSize / 1024).toFixed(1)} KB ·{" "}
                          {formatRelative(job.createdAt)}
                          {job.phase
                            ? ` · ${phaseLabel(job.phase)}${
                                job.phaseDetail ? ` ${job.phaseDetail}` : ""
                              }`
                            : ""}
                          {job.status === "PROCESSING" && formatElapsed(job.startedAt)
                            ? ` · ${formatElapsed(job.startedAt)}`
                            : ""}
                        </p>
                        {job.errorMessage && (
                          <p className="mt-0.5 break-words text-xs text-destructive">
                            {job.errorMessage}
                          </p>
                        )}
                        {(job.phase === "cancelling" ||
                          job.pausedReason === "cancel_requested") && (
                          <p className="mt-0.5 text-xs text-muted-foreground">
                            Cancelling — finishes current OCR page, then removes. Drive archives
                            stay.
                          </p>
                        )}
                        {job.phase === "waiting_vision" && (
                          <p className="mt-0.5 text-xs text-muted-foreground">
                            Waiting for vision VRAM lock…
                          </p>
                        )}
                        {job.phase === "await_confirm" && (
                          <p className="mt-0.5 text-xs text-muted-foreground">
                            Awaiting your naming confirm before archive write.
                          </p>
                        )}
                      </div>
                    </div>
                    <div className="flex shrink-0 items-center gap-2 self-end sm:self-auto">
                      {canCancel(job.status) && (
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="h-8 gap-1 px-2 text-muted-foreground"
                          disabled={
                            busy ||
                            job.pausedReason === "cancel_requested" ||
                            job.phase === "cancelling"
                          }
                          onClick={() => void cancelJob(job)}
                          aria-label={`Cancel ${job.document.filename}`}
                          title="Cancel — spells out what is discarded vs kept"
                        >
                          {busy ? (
                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          ) : (
                            <X className="h-3.5 w-3.5" />
                          )}
                          Cancel
                        </Button>
                      )}
                      <Badge
                        variant={
                          job.phase === "await_confirm"
                            ? "warning"
                            : job.phase === "failed"
                              ? "destructive"
                              : config.variant
                        }
                        className="w-fit gap-1"
                      >
                        <Icon
                          className={`h-3 w-3 ${
                            job.status === "PROCESSING" && job.phase !== "cancelling"
                              ? "animate-spin"
                              : ""
                          }`}
                        />
                        {job.phase && job.phase !== "queued" && job.phase !== "done"
                          ? phaseLabel(job.phase)
                          : config.label}
                      </Badge>
                    </div>
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
