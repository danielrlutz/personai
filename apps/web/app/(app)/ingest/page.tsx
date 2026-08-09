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
          OCR, proposed names ({`{date}_{DocType}_{Entity}`}), and Fristen — money-adjacent writes wait
          for confirm.
        </p>
      </div>
      <ConfirmGate refreshKey={refreshKey} onResolved={() => setRefreshKey((k) => k + 1)} />
      <FileDropzone onUploaded={() => setRefreshKey((k) => k + 1)} />
      <OutboxPendingStrip types={["ingest-upload"]} hideTeamChat />
      <IngestionQueue refreshKey={refreshKey} />
    </PageEnter>
  );
}
