"use client";

import { Cpu } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

interface VramState {
  holder: string | null;
  waiting: number;
  pausedReason: string | null;
}

interface QueueStatusBannerProps {
  vram?: VramState;
  queuedCount: number;
}

export function QueueStatusBanner({ vram, queuedCount }: QueueStatusBannerProps) {
  const locked = Boolean(vram?.holder);

  return (
    <div
      className={cn(
        "surface-card flex items-center justify-between gap-3 px-4 py-3",
        locked && "border-warning/40",
      )}
    >
      <div className="flex min-w-0 items-center gap-3">
        <span
          className={cn(
            "flex h-10 w-10 shrink-0 items-center justify-center rounded-full",
            locked ? "bg-warning/15" : "bg-primary-container",
          )}
        >
          <Cpu className={cn("h-5 w-5", locked ? "text-warning" : "text-primary-on-container")} />
        </span>
        <div className="min-w-0">
          <p className="md-label-large truncate">
            {locked ? "Scanner busy — other jobs wait their turn" : "Ready for new documents"}
          </p>
          <p className="md-body-medium truncate text-muted-foreground">
            {queuedCount === 1 ? "1 document in queue" : `${queuedCount} documents in queue`}
            {locked && vram?.holder ? ` · In use by ${vram.holder}` : ""}
            {vram?.pausedReason ? ` · ${vram.pausedReason}` : ""}
          </p>
        </div>
      </div>
      <Badge variant={locked ? "warning" : "secondary"} className="shrink-0">
        {locked ? "Busy" : "Ready"}
      </Badge>
    </div>
  );
}
