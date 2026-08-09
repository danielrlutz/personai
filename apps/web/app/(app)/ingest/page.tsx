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
  const [driveReady, setDriveReady] = useState(false);

  useEffect(() => {
    void fetchDriveStatus()
      .then(setDrive)
      .finally(() => setDriveReady(true));
  }, []);

  const linked = Boolean(drive?.linked);
  const driveLoading = !driveReady;

  return (
    <PageEnter className="mx-auto max-w-4xl space-y-6">
      <div className="page-header min-w-0">
        <h1 className="page-title">Archive</h1>
        <p className="page-subtitle">
          Scan a whole mailbox PDF, split/OCR/name/file with confirms. Payments wait for your OK.
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
              Court / Gerichtsunterlagen go to Legal (08). Behörden stay Official (01). Amounts that
              would change your ledger still need confirmation below.
            </p>
          </div>
        </details>
      </div>
      {driveLoading ? (
        <p className="text-sm text-muted-foreground">Checking Google Drive link…</p>
      ) : !linked ? (
        <div className="rounded-2xl border border-border/70 bg-surface-container/60 px-4 py-5">
          <div className="flex items-start gap-3">
            <HardDrive className="mt-0.5 h-5 w-5 shrink-0 text-primary" />
            <div className="space-y-3">
              <p className="text-sm font-medium tracking-tight">
                Archive filing needs Google Drive linked
              </p>
              <p className="text-sm text-muted-foreground">
                Sign in is done — next link Drive in Settings. Until then, use Pocket team for
                personal advice (specialists will say they lack archive context).
              </p>
              <Button asChild size="sm">
                <Link href="/settings/?focus=drive">Open Drive settings</Link>
              </Button>
            </div>
          </div>
        </div>
      ) : (
        <>
          <ConfirmGate refreshKey={refreshKey} onResolved={() => setRefreshKey((k) => k + 1)} />
          <FileDropzone onUploaded={() => setRefreshKey((k) => k + 1)} />
          <OutboxPendingStrip types={["ingest-upload"]} hideTeamChat />
          <IngestionQueue refreshKey={refreshKey} />
        </>
      )}
    </PageEnter>
  );
}
