"use client";

import { useState } from "react";
import { FileDropzone } from "@/components/ingest/FileDropzone";
import { IngestionQueue } from "@/components/ingest/IngestionQueue";
import { ConfirmGate } from "@/components/confirm/ConfirmGate";
import { OutboxPendingStrip } from "@/components/outbox/OutboxPendingStrip";
import { PageEnter } from "@/components/motion/PageEnter";

export default function IngestPage() {
  const [refreshKey, setRefreshKey] = useState(0);

  return (
    <PageEnter className="mx-auto max-w-4xl space-y-6">
      <div className="page-header min-w-0">
        <h1 className="page-title">Archive</h1>
        <p className="page-subtitle">
          Scan documents, suggest file names, and catch deadlines. Payments wait for your OK.
        </p>
        <details className="mt-3 max-w-xl rounded-xl border border-border/70 bg-surface-container/50 px-3.5 py-2.5 text-sm">
          <summary className="cursor-pointer select-none font-medium text-foreground/90">
            How naming works
          </summary>
          <div className="mt-2 space-y-2 text-muted-foreground">
            <p>
              Suggested names look like{" "}
              <span className="font-mono text-xs text-foreground/80">
                2026-08-09_Bill_Swisscom
              </span>{" "}
              — date, document type, then who it is from or about.
            </p>
            <p>
              When a due date is found, a deadline (Frist) can be queued for Legal. Amounts that
              would change your ledger still need confirmation below.
            </p>
          </div>
        </details>
      </div>
      <ConfirmGate refreshKey={refreshKey} onResolved={() => setRefreshKey((k) => k + 1)} />
      <FileDropzone onUploaded={() => setRefreshKey((k) => k + 1)} />
      <OutboxPendingStrip types={["ingest-upload"]} hideTeamChat />
      <IngestionQueue refreshKey={refreshKey} />
    </PageEnter>
  );
}
