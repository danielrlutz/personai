"use client";

import { AlertCircle, RefreshCw, Upload, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useOutbox, labelForOp, type OutboxOp } from "@/lib/outbox";
import { cn } from "@/lib/utils";

interface OutboxPendingStripProps {
  /** When set, only show these op types (e.g. uploads on Archive). */
  types?: Array<OutboxOp["type"]>;
  /** Hide team-chat here — those surface inside the chat thread. */
  hideTeamChat?: boolean;
  className?: string;
  compact?: boolean;
}

export function OutboxPendingStrip({
  types,
  hideTeamChat = true,
  className,
  compact,
}: OutboxPendingStripProps) {
  const { ops, retry, dismiss } = useOutbox();

  const visible = ops.filter((op) => {
    if (hideTeamChat && op.type === "team-chat") return false;
    if (types && !types.includes(op.type)) return false;
    return true;
  });

  if (visible.length === 0) return null;

  const failed = visible.filter((op) => op.status === "failed").length;
  const busy = visible.filter((op) => op.status === "pending" || op.status === "inflight").length;

  return (
    <div
      className={cn(
        "min-w-0 rounded-lg border border-border/80 bg-surface-container px-3 py-2.5 sm:px-4",
        failed > 0 && "border-destructive/40",
        className,
      )}
      role="status"
    >
      <div className="flex min-w-0 items-start gap-3">
        <span
          className={cn(
            "mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full",
            failed > 0 ? "bg-destructive/15" : "bg-primary-container",
          )}
        >
          {failed > 0 ? (
            <AlertCircle className="h-4 w-4 text-destructive" />
          ) : (
            <Upload className="h-4 w-4 text-primary-on-container" />
          )}
        </span>
        <div className="min-w-0 flex-1 space-y-2">
          <div className="min-w-0">
            <p className="md-label-large truncate">
              {failed > 0
                ? `${failed} pending action${failed === 1 ? "" : "s"} need retry`
                : `${busy} pending action${busy === 1 ? "" : "s"}`}
            </p>
            {!compact ? (
              <p className="text-xs text-muted-foreground">
                Saved on this device — nothing is dropped silently.
              </p>
            ) : null}
          </div>
          <ul className="space-y-1.5">
            {visible.map((op) => (
              <li
                key={op.id}
                className="flex min-w-0 flex-col gap-1.5 rounded-md bg-background/60 px-2.5 py-2 sm:flex-row sm:items-center sm:justify-between"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm" title={labelForOp(op)}>
                    {labelForOp(op)}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {op.status === "inflight"
                      ? "Sending…"
                      : op.status === "pending"
                        ? "Queued"
                        : op.lastError ?? "Failed"}
                  </p>
                </div>
                <div className="flex shrink-0 gap-1.5">
                  {op.status === "failed" ? (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => void retry(op.id)}
                    >
                      <RefreshCw className="h-3.5 w-3.5" />
                      Retry
                    </Button>
                  ) : null}
                  {op.status !== "inflight" ? (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => void dismiss(op.id)}
                      aria-label="Dismiss"
                    >
                      <X className="h-3.5 w-3.5" />
                    </Button>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}
