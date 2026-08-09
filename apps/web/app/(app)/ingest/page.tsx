"use client";

import { useState } from "react";
import { FileDropzone } from "@/components/ingest/FileDropzone";
import { IngestionQueue } from "@/components/ingest/IngestionQueue";
import { ConfirmGate } from "@/components/confirm/ConfirmGate";
import { OutboxPendingStrip } from "@/components/outbox/OutboxPendingStrip";

export default function IngestPage() {
  const [refreshKey, setRefreshKey] = useState(0);

  return (
    <div className="mx-auto max-w-4xl space-y-5">
      <div>
        <h1 className="md-title-large text-[26px] tracking-tight">Archive</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          OCR, proposed names ({`{date}_{DocType}_{Entity}`}), and Fristen — money-adjacent writes wait for confirm.
        </p>
      </div>
      <ConfirmGate refreshKey={refreshKey} onResolved={() => setRefreshKey((k) => k + 1)} />
      <FileDropzone onUploaded={() => setRefreshKey((k) => k + 1)} />
      <OutboxPendingStrip types={["ingest-upload"]} hideTeamChat />
      <IngestionQueue refreshKey={refreshKey} />
    </div>
  );
}
