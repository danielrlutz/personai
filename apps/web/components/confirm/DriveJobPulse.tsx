"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { CloudUpload, ExternalLink, RefreshCw, X } from "lucide-react";
import { apiGet, apiPost } from "@/lib/api-client";
import { toast } from "@/lib/toast";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const STORAGE_KEY = "personai.drive-job-pulses";
const POLL_MS = 1600;
const DONE_AUTO_DISMISS_MS = 8000;

export type ServerJobDto = {
  id: string;
  type: string;
  status: "QUEUED" | "PROCESSING" | "COMPLETED" | "FAILED" | string;
  documentId?: string | null;
  payload?: { name?: string; archiveCategory?: number } | null;
  result?: { webViewLink?: string; name?: string; skipped?: boolean } | null;
  errorMessage?: string | null;
  attempts?: number;
};

function readPulseIds(): string[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((id): id is string => typeof id === "string" && id.length > 0);
  } catch {
    return [];
  }
}

function writePulseIds(ids: string[]) {
  if (typeof window === "undefined") return;
  const unique = [...new Set(ids)].slice(0, 20);
  if (unique.length === 0) sessionStorage.removeItem(STORAGE_KEY);
  else sessionStorage.setItem(STORAGE_KEY, JSON.stringify(unique));
}

/** Persist a Drive upload job id so the pulse survives in-tab navigation. */
export function trackDriveJobPulse(jobId: string) {
  if (!jobId) return;
  const next = [jobId, ...readPulseIds().filter((id) => id !== jobId)];
  writePulseIds(next);
}

function dismissDriveJobPulse(jobId: string) {
  writePulseIds(readPulseIds().filter((id) => id !== jobId));
}

function statusLabel(status: string): string {
  switch (status) {
    case "QUEUED":
      return "Queued";
    case "PROCESSING":
      return "Uploading…";
    case "COMPLETED":
      return "Done";
    case "FAILED":
      return "Failed";
    default:
      return status;
  }
}

function DriveJobPulseRow({
  jobId,
  onDismiss,
  onFailedChange,
}: {
  jobId: string;
  onDismiss: (jobId: string) => void;
  onFailedChange: (jobId: string, failed: boolean) => void;
}) {
  const [job, setJob] = useState<ServerJobDto | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [retrying, setRetrying] = useState(false);

  const poll = useCallback(async () => {
    try {
      const data = await apiGet<{ job: ServerJobDto }>(`/jobs/${jobId}`, { silent: true });
      setJob(data.job);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load Drive job");
    }
  }, [jobId]);

  useEffect(() => {
    void poll();
  }, [poll]);

  useEffect(() => {
    if (!job) return;
    if (job.status === "COMPLETED" || job.status === "FAILED") return;
    const t = window.setInterval(() => void poll(), POLL_MS);
    return () => window.clearInterval(t);
  }, [job, poll]);

  useEffect(() => {
    if (job?.status !== "COMPLETED") return;
    const t = window.setTimeout(() => onDismiss(jobId), DONE_AUTO_DISMISS_MS);
    return () => window.clearTimeout(t);
  }, [job?.status, jobId, onDismiss]);

  const failed = job?.status === "FAILED" || Boolean(error);
  useEffect(() => {
    onFailedChange(jobId, failed);
  }, [failed, jobId, onFailedChange]);

  const retry = async () => {
    setRetrying(true);
    try {
      const data = await apiPost<{ job: ServerJobDto }>(`/jobs/${jobId}/retry`, undefined, {
        silent: true,
      });
      setJob(data.job);
      setError(null);
      toast.success("Drive upload queued again.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Retry failed", {
        title: "Couldn't retry Drive upload",
        sticky: true,
        dedupeKey: `drive-job-retry:${jobId}`,
      });
    } finally {
      setRetrying(false);
    }
  };

  const status = job?.status ?? "QUEUED";
  const done = status === "COMPLETED";
  const name =
    (typeof job?.payload?.name === "string" && job.payload.name) ||
    (typeof job?.result?.name === "string" && job.result.name) ||
    "Archive file";
  const webViewLink =
    job?.result && typeof job.result.webViewLink === "string" ? job.result.webViewLink : null;

  return (
    <li
      className={cn(
        "flex min-w-0 flex-col gap-1.5 rounded-md bg-background/60 px-2.5 py-2 sm:flex-row sm:items-center sm:justify-between",
        failed && "border border-destructive/30",
      )}
    >
      <div className="min-w-0">
        <p className="truncate text-sm" title={name}>
          {name}
        </p>
        <p className="text-xs text-muted-foreground">
          {error
            ? error
            : failed
              ? job?.errorMessage || "Drive upload failed"
              : done
                ? job?.result?.skipped
                  ? "Done — Drive not enabled"
                  : "Done — in Google Drive"
                : `${statusLabel(status)} · Drive courier`}
        </p>
      </div>
      <div className="flex shrink-0 flex-wrap gap-1.5">
        {webViewLink ? (
          <Button size="sm" variant="outline" asChild>
            <a href={webViewLink} target="_blank" rel="noopener noreferrer">
              <ExternalLink className="h-3.5 w-3.5" />
              Drive
            </a>
          </Button>
        ) : null}
        <Button size="sm" variant="ghost" asChild>
          <Link href="/activity/">Activity</Link>
        </Button>
        {failed ? (
          <Button size="sm" variant="outline" disabled={retrying} onClick={() => void retry()}>
            <RefreshCw className={cn("h-3.5 w-3.5", retrying && "animate-spin")} />
            Retry
          </Button>
        ) : null}
        {done || failed ? (
          <Button
            size="sm"
            variant="ghost"
            onClick={() => onDismiss(jobId)}
            aria-label="Dismiss Drive pulse"
          >
            <X className="h-3.5 w-3.5" />
          </Button>
        ) : null}
      </div>
    </li>
  );
}

interface DriveJobPulseStripProps {
  /** Extra job ids from this session (e.g. just returned by confirm). */
  jobIds?: string[];
  className?: string;
  compact?: boolean;
}

/**
 * Post-confirm Drive courier strip — polls GET /jobs/:id for drive.upload ServerJobs.
 * Confirm is the seal; this strip is the receipt (QUEUED → Done / Failed).
 */
export function DriveJobPulseStrip({ jobIds = [], className, compact }: DriveJobPulseStripProps) {
  const [ids, setIds] = useState<string[]>([]);
  const [failedIds, setFailedIds] = useState<Set<string>>(() => new Set());

  useEffect(() => {
    const stored = readPulseIds();
    const merged = [...new Set([...jobIds, ...stored])];
    writePulseIds(merged);
    setIds(merged);
  }, [jobIds]);

  const onDismiss = useCallback((jobId: string) => {
    dismissDriveJobPulse(jobId);
    setIds((prev) => prev.filter((id) => id !== jobId));
    setFailedIds((prev) => {
      if (!prev.has(jobId)) return prev;
      const next = new Set(prev);
      next.delete(jobId);
      return next;
    });
  }, []);

  const onFailedChange = useCallback((jobId: string, failed: boolean) => {
    setFailedIds((prev) => {
      const has = prev.has(jobId);
      if (failed === has) return prev;
      const next = new Set(prev);
      if (failed) next.add(jobId);
      else next.delete(jobId);
      return next;
    });
  }, []);

  if (ids.length === 0) return null;

  const failedCount = failedIds.size;

  return (
    <div
      className={cn(
        "min-w-0 rounded-lg border border-border/80 bg-surface-container px-3 py-2.5 sm:px-4",
        failedCount > 0 && "border-destructive/40",
        className,
      )}
      role="status"
      aria-live="polite"
    >
      <div className="flex min-w-0 items-start gap-3">
        <span
          className={cn(
            "mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full",
            failedCount > 0 ? "bg-destructive/15" : "bg-primary-container",
          )}
        >
          <CloudUpload
            className={cn(
              "h-4 w-4",
              failedCount > 0 ? "text-destructive" : "text-primary-on-container",
            )}
          />
        </span>
        <div className="min-w-0 flex-1 space-y-2">
          <div className="min-w-0">
            <p className="md-label-large truncate">
              {failedCount > 0
                ? `${failedCount} Drive upload${failedCount === 1 ? "" : "s"} need retry`
                : `Drive upload${ids.length === 1 ? "" : "s"} in flight`}
            </p>
            {!compact ? (
              <p className="text-xs text-muted-foreground">
                Local filing is done — Drive continues on the server. Close the tab if you like.
              </p>
            ) : null}
          </div>
          <ul className="space-y-1.5">
            {ids.map((id) => (
              <DriveJobPulseRow
                key={id}
                jobId={id}
                onDismiss={onDismiss}
                onFailedChange={onFailedChange}
              />
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}
