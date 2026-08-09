"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { HardDrive } from "lucide-react";
import { apiGet, type DriveStatus } from "@/lib/api-client";
import { Button } from "@/components/ui/button";

/** Soft-gate banner when Google Drive archive is not linked yet. */
export function DriveLinkBanner() {
  const [drive, setDrive] = useState<DriveStatus | null>(null);

  useEffect(() => {
    void apiGet<DriveStatus>("/archive/drive", { silent: true })
      .then(setDrive)
      .catch(() => setDrive(null));
  }, []);

  if (!drive || drive.linked) return null;

  return (
    <div className="mb-4 flex flex-col gap-3 rounded-2xl border border-border/70 bg-surface-container/80 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex min-w-0 items-start gap-3">
        <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary-container">
          <HardDrive className="h-4 w-4 text-primary-on-container" />
        </span>
        <div className="min-w-0">
          <p className="text-sm font-medium tracking-tight">Link Google Drive to unlock your archive</p>
          <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">
            You can talk with specialists now. They do not have your document archive context until
            Drive is linked. Scanning and filing wait on that link.
          </p>
        </div>
      </div>
      <Button asChild size="sm" className="shrink-0">
        <Link href="/settings/?focus=drive">Link Google Drive</Link>
      </Button>
    </div>
  );
}
