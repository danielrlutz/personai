"use client";

import { useState } from "react";
import { FileDropzone } from "@/components/ingest/FileDropzone";
import { IngestionQueue } from "@/components/ingest/IngestionQueue";

export default function IngestPage() {
  const [refreshKey, setRefreshKey] = useState(0);

  return (
    <div className="mx-auto max-w-4xl space-y-5">
      <div>
        <h1 className="md-title-large text-[26px] tracking-tight">Document Ingest</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Upload bills, receipts, and records for AI extraction.
        </p>
      </div>
      <FileDropzone onUploaded={() => setRefreshKey((k) => k + 1)} />
      <IngestionQueue refreshKey={refreshKey} />
    </div>
  );
}
