"use client";

import { useEffect, useRef } from "react";
import { usePathname } from "next/navigation";
import { getOutbox, useOutbox, type OutboxEvent, type OutboxOp } from "@/lib/outbox";
import { collapseApiFailureMessage } from "@/lib/api-errors";
import { toast } from "@/lib/toast";
import { OutboxPendingStrip } from "./OutboxPendingStrip";

function toastForFailedOp(op: OutboxOp): void {
  // Last line of defense: IndexedDB may still hold triple-wrapped lastError from older builds.
  const message = collapseApiFailureMessage(op.lastError?.trim() || "Operation failed");
  if (op.type === "ingest-upload") {
    const filename = "filename" in op.payload ? String(op.payload.filename) : "file";
    toast.error(message, {
      title: `Upload failed · ${filename}`,
      sticky: true,
      dedupeKey: `outbox:${op.id}:${op.updatedAt}`,
    });
    return;
  }
  toast.error(message, {
    title: "Message failed to send",
    sticky: true,
    dedupeKey: `outbox:${op.id}:${op.updatedAt}`,
  });
}

/** Starts the durable outbox drain loop and shows a Pending/Retry strip for non-chat ops. */
export function OutboxBootstrap() {
  const pathname = usePathname();
  const { hasWork } = useOutbox("ingest-upload");
  // Archive page renders its own strip above the server ingestion queue.
  const hideStrip = pathname?.startsWith("/ingest");
  const seenFailures = useRef(new Set<string>());

  useEffect(() => {
    void getOutbox().whenReady().then(() => getOutbox().drain());
  }, []);

  useEffect(() => {
    return getOutbox().subscribe((event: OutboxEvent) => {
      if (event.kind !== "changed") return;
      for (const op of event.ops) {
        if (op.status !== "failed") continue;
        const key = `${op.id}:${op.updatedAt}`;
        if (seenFailures.current.has(key)) continue;
        seenFailures.current.add(key);
        toastForFailedOp(op);
      }
    });
  }, []);

  if (!hasWork || hideStrip) return null;

  return (
    <div className="shrink-0 border-t border-border/80 bg-background/95 px-3 py-2 backdrop-blur-sm sm:px-6">
      <div className="mx-auto min-w-0 max-w-3xl">
        <OutboxPendingStrip types={["ingest-upload"]} hideTeamChat />
      </div>
    </div>
  );
}
