"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { HardDrive } from "lucide-react";
import { FileDropzone } from "@/components/ingest/FileDropzone";
import { IngestionQueue } from "@/components/ingest/IngestionQueue";
import { ConfirmGate } from "@/components/confirm/ConfirmGate";
import { OutboxPendingStrip } from "@/components/outbox/OutboxPendingStrip";
import { PageEnter } from "@/components/motion/PageEnter";
import { Button } from "@/components/ui/button";
import { fetchDriveStatus } from "@/lib/drive-status";
import type { DriveStatus } from "@/lib/api-client";

export default function IngestPage() {
  const [refreshKey, setRefreshKey] = useState(0);
  const [drive, setDrive] = useState<DriveStatus | null>(null);

  useEffect(() => {
    void fetchDriveStatus().then(setDrive).catch(() => setDrive(null));
  }, []);

  const linked = Boolean(drive?.linked);

  return (
    <PageEnter className="mx-auto max-w-4xl space-y-6">
      <div className="page-header min-w-0">
        <h1 className="font-display text-3xl tracking-tight sm:text-4xl">Archive</h1>
        <p className="page-subtitle">
          OCR names files locally first. Edit DocType / Entity / category in Needs confirmation —
          Confirm files; Decline keeps staging only (no Drive write).
        </p>
      </div>

      {!linked ? (
        <div className="flex items-start gap-3 rounded-2xl border border-border bg-card px-4 py-4">
          <HardDrive className="mt-0.5 h-5 w-5 shrink-0 text-primary" />
          <div className="space-y-2 text-sm">
            <p className="font-medium">Local archive works without Drive</p>
            <p className="text-muted-foreground">
              Confirm still writes to this profile&apos;s disk. Link Google Drive in Settings when you
              want cloud copies.
            </p>
            <Button asChild size="sm" variant="outline">
              <Link href="/settings/?focus=drive">Drive settings</Link>
            </Button>
          </div>
        </div>
      ) : null}

      <ConfirmGate refreshKey={refreshKey} onResolved={() => setRefreshKey((k) => k + 1)} />
      <FileDropzone onUploaded={() => setRefreshKey((k) => k + 1)} />
      <OutboxPendingStrip types={["ingest-upload"]} hideTeamChat />
      <IngestionQueue refreshKey={refreshKey} />
    </PageEnter>
  );
}
