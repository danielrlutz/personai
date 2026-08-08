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
        "flex items-center justify-between rounded-lg border px-4 py-3",
        locked ? "border-amber-500/30 bg-amber-500/10" : "border-teal-500/30 bg-teal-500/10",
      )}
    >
      <div className="flex items-center gap-3">
        <Cpu className={cn("h-5 w-5", locked ? "text-amber-400" : "text-teal-400")} />
        <div>
          <p className="text-sm font-medium">
            {locked ? "VRAM lock active — competing jobs wait" : "Ingestion queue ready"}
          </p>
          <p className="text-xs text-muted-foreground">
            {queuedCount} job(s) in queue
            {locked && vram?.holder ? ` · Held by ${vram.holder}` : ""}
            {vram?.pausedReason ? ` · ${vram.pausedReason}` : ""}
          </p>
        </div>
      </div>
      <Badge variant={locked ? "warning" : "success"}>{locked ? "Locked" : "Idle"}</Badge>
    </div>
  );
}
