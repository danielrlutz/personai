"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";
import { getOutbox, useOutbox } from "@/lib/outbox";
import { OutboxPendingStrip } from "./OutboxPendingStrip";

/** Starts the durable outbox drain loop and shows a Pending/Retry strip for non-chat ops. */
export function OutboxBootstrap() {
  const pathname = usePathname();
  const { hasWork } = useOutbox("ingest-upload");
  // Archive page renders its own strip above the server ingestion queue.
  const hideStrip = pathname?.startsWith("/ingest");

  useEffect(() => {
    void getOutbox().whenReady().then(() => getOutbox().drain());
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
