"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { CheckCircle2, Cpu, Loader2, Upload, X } from "lucide-react";
import {
  apiDelete,
  apiGet,
  type IngestQueueResponse,
  type IngestionJob,
} from "@/lib/api-client";
import {
  cancelConfirmMessage,
  formatElapsed,
  LANE_STEPS,
  phaseLabel,
  phaseStepIndex,
  type IngestPhase,
} from "@/lib/ingest-phase";
import { useOutbox, labelForOp } from "@/lib/outbox";
import { toast } from "@/lib/toast";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

function isActiveLaneJob(job: IngestionJob): boolean {
  const phase = job.phase;
  if (
    phase === "queued" ||
    phase === "waiting_vision" ||
    phase === "rasterize" ||
    phase === "ocr" ||
    phase === "split" ||
    phase === "cancelling" ||
    phase === "await_confirm" ||
    phase === "failed"
  ) {
    return true;
  }
  const s = (job.status ?? "").toUpperCase();
  return s === "QUEUED" || s === "PROCESSING" || s === "FAILED";
}

function PhaseTrack({ phase }: { phase: IngestPhase | string | null | undefined }) {
  const idx = phaseStepIndex(phase);
  return (
    <ol className="flex flex-wrap items-center gap-1" aria-label="Ingest phases">
      {LANE_STEPS.map((step, i) => {
        const done = idx > i;
        const current = idx === i;
        return (
          <li key={step.id} className="flex items-center gap-1">
            {i > 0 ? (
              <span
                className={cn(
                  "mx-0.5 h-px w-3 sm:w-4",
                  done || current ? "bg-primary/50" : "bg-border",
                )}
                aria-hidden
              />
            ) : null}
            <span
              className={cn(
                "rounded-md px-1.5 py-0.5 text-[10px] font-medium tracking-wide",
                current && "bg-primary-container text-primary-on-container",
                done && !current && "bg-success/15 text-success",
                !done && !current && "bg-muted/60 text-muted-foreground",
              )}
            >
              {step.label}
            </span>
          </li>
        );
      })}
    </ol>
  );
}

export function ArchiveQueueWidget() {
  const [data, setData] = useState<IngestQueueResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [cancellingId, setCancellingId] = useState<string | null>(null);
  const { ops: uploadOps, retry, dismiss } = useOutbox("ingest-upload");

  const load = useCallback(async () => {
    try {
      const next = await apiGet<IngestQueueResponse>("/ingest/queue", { silent: true });
      setData(next);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load queue");
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const laneJobs = useMemo(
    () => (data?.jobs ?? []).filter(isActiveLaneJob).slice(0, 8),
    [data?.jobs],
  );

  const hasWork =
    laneJobs.length > 0 ||
    uploadOps.length > 0 ||
    Boolean(data?.vram?.holder) ||
    (data?.lane?.awaitConfirmCount ?? 0) > 0;

  useEffect(() => {
    if (!hasWork) return;
    const id = window.setInterval(() => void load(), 3500);
    return () => window.clearInterval(id);
  }, [hasWork, load]);

  const cancelJob = useCallback(
    async (job: IngestionJob) => {
      const ok = window.confirm(
        cancelConfirmMessage({
          filename: job.document.filename,
          status: job.status,
          phase: job.phase,
        }),
      );
      if (!ok) return;
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
        await load();
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Could not cancel");
      } finally {
        setCancellingId(null);
      }
    },
    [load],
  );

  if (error && !data) {
    return <p className="text-sm text-destructive">{error}</p>;
  }

  const vram = data?.vram;
  const visionLocked = Boolean(vram?.holder);
  const lane = data?.lane;

  return (
    <div className="space-y-2.5">
      <div className="flex items-center justify-between gap-2">
        <h2 className="font-display text-lg tracking-tight">Archive queue</h2>
        <Button variant="ghost" size="sm" asChild>
          <Link href="/ingest/">Archive</Link>
        </Button>
      </div>

      <div
        className={cn(
          "space-y-3 rounded-2xl border border-border/70 bg-card/90 px-4 py-3.5 shadow-elev-1",
          visionLocked && "border-warning/35",
        )}
      >
        <div className="flex items-start gap-3">
          <span
            className={cn(
              "mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full",
              visionLocked ? "bg-warning/15" : "bg-primary-container",
            )}
          >
            <Cpu
              className={cn(
                "h-4 w-4",
                visionLocked ? "text-warning" : "text-primary-on-container",
              )}
            />
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <p className="text-sm font-medium">
                {visionLocked
                  ? `Vision lock · ${vram?.holder}`
                  : hasWork
                    ? "Ingest lane"
                    : "Queue clear"}
              </p>
              <Badge variant={visionLocked ? "warning" : "secondary"} className="shrink-0">
                {visionLocked ? "Busy" : hasWork ? "Active" : "Ready"}
              </Badge>
            </div>
            <p className="mt-0.5 text-xs text-muted-foreground">
              {visionLocked
                ? `${vram?.waiting ?? 0} waiting for VRAM · other models stand aside`
                : hasWork
                  ? [
                      lane?.activeCount ? `${lane.activeCount} processing` : null,
                      lane?.awaitConfirmCount
                        ? `${lane.awaitConfirmCount} await confirm`
                        : null,
                      lane?.failedCount ? `${lane.failedCount} failed` : null,
                      uploadOps.length ? `${uploadOps.length} uploading` : null,
                    ]
                      .filter(Boolean)
                      .join(" · ") || "Jobs in flight"
                  : "Drop files on Home or Archive — confirm before Drive write."}
            </p>
          </div>
        </div>

        {hasWork ? <PhaseTrack phase={laneJobs[0]?.phase ?? "queued"} /> : null}

        {!hasWork ? null : (
          <ul className="space-y-2 border-t border-border/50 pt-2.5">
            {uploadOps.map((op) => (
              <li
                key={op.id}
                className="flex min-w-0 items-start justify-between gap-2 rounded-xl bg-surface-container/70 px-2.5 py-2"
              >
                <div className="flex min-w-0 items-start gap-2">
                  <Upload className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                  <div className="min-w-0">
                    <p className="truncate text-sm" title={labelForOp(op)}>
                      {labelForOp(op)}
                    </p>
                    <p className="text-[11px] text-muted-foreground">
                      {op.status === "inflight"
                        ? "Uploading to ingest…"
                        : op.status === "pending"
                          ? "Upload queued on this device"
                          : op.lastError ?? "Upload failed"}
                    </p>
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  <Badge variant="secondary" className="text-[10px]">
                    Upload
                  </Badge>
                  {op.status === "failed" ? (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="h-7 px-2"
                      onClick={() => void retry(op.id)}
                    >
                      Retry
                    </Button>
                  ) : null}
                  {op.status !== "inflight" ? (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="h-7 px-1.5 text-muted-foreground"
                      onClick={() => void dismiss(op.id)}
                      aria-label="Dismiss upload"
                    >
                      <X className="h-3.5 w-3.5" />
                    </Button>
                  ) : null}
                </div>
              </li>
            ))}

            {laneJobs.map((job) => {
              const phase = (job.phase ?? "queued") as IngestPhase;
              const busy = cancellingId === job.id;
              const elapsed = formatElapsed(job.startedAt);
              const detail =
                job.phaseDetail ||
                (phase === "ocr" && job.progressDetail ? job.progressDetail : null);
              const canCancel =
                job.status === "QUEUED" ||
                job.status === "PROCESSING" ||
                job.status === "FAILED" ||
                job.status === "COMPLETED";

              return (
                <li
                  key={job.id}
                  className="flex min-w-0 items-start justify-between gap-2 rounded-xl bg-surface-container/70 px-2.5 py-2"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm" title={job.document.filename}>
                      {job.document.filename}
                    </p>
                    <p className="text-[11px] text-muted-foreground">
                      {phaseLabel(phase)}
                      {detail ? ` ${detail}` : ""}
                      {elapsed && phase !== "await_confirm" && phase !== "failed"
                        ? ` · ${elapsed}`
                        : ""}
                      {job.queuePosition != null && phase === "queued"
                        ? ` · #${job.queuePosition}`
                        : ""}
                    </p>
                    {job.errorMessage && phase === "failed" ? (
                      <p className="mt-0.5 break-words text-[11px] text-destructive">
                        {job.errorMessage}
                      </p>
                    ) : null}
                    {phase === "await_confirm" ? (
                      <p className="mt-0.5 text-[11px] text-muted-foreground">
                        Naming needs your OK before archive / Drive write.
                      </p>
                    ) : null}
                    {phase === "cancelling" ? (
                      <p className="mt-0.5 text-[11px] text-muted-foreground">
                        Cancel requested — removing after current page.
                      </p>
                    ) : null}
                  </div>
                  <div className="flex shrink-0 items-center gap-1">
                    {phase === "await_confirm" ? (
                      <Button variant="ghost" size="sm" className="h-7 px-2" asChild>
                        <Link href="/">Confirm</Link>
                      </Button>
                    ) : null}
                    {canCancel && phase !== "cancelling" ? (
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="h-7 gap-1 px-2 text-muted-foreground"
                        disabled={busy}
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
                    ) : null}
                    <Badge
                      variant={
                        phase === "failed"
                          ? "destructive"
                          : phase === "await_confirm"
                            ? "warning"
                            : phase === "cancelling"
                              ? "secondary"
                              : "default"
                      }
                      className="gap-1 text-[10px]"
                    >
                      {phase === "ocr" || phase === "rasterize" || phase === "split" ? (
                        <Loader2 className="h-3 w-3 animate-spin" />
                      ) : phase === "await_confirm" ? (
                        <CheckCircle2 className="h-3 w-3" />
                      ) : null}
                      {phaseLabel(phase)}
                    </Badge>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
