"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { HardDrive } from "lucide-react";
import { apiGet, type DriveStatus } from "@/lib/api-client";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

export function DriveStatusWidget() {
  const [drive, setDrive] = useState<DriveStatus | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void apiGet<DriveStatus>("/archive/drive", { silent: true })
      .then(setDrive)
      .catch((err) => setError(err instanceof Error ? err.message : "Could not load Drive status"));
  }, []);

  if (error) {
    return <p className="text-sm text-destructive">{error}</p>;
  }

  if (!drive) {
    return <p className="text-sm text-muted-foreground">Checking Drive…</p>;
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <h2 className="font-display text-lg tracking-tight">Google Drive</h2>
        <Button variant="ghost" size="sm" asChild>
          <Link href="/settings/?focus=drive">Settings</Link>
        </Button>
      </div>
      <div className="flex items-start gap-3 rounded-2xl border border-border/70 bg-card px-4 py-3.5">
        <HardDrive className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
        <div className="min-w-0 space-y-1.5">
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-sm font-medium">
              {drive.linked ? "Archive linked" : "Drive not linked"}
            </p>
            <Badge variant={drive.linked ? "default" : "outline"}>
              {drive.mode === "none" ? "not configured" : drive.mode}
            </Badge>
          </div>
          <p className="text-xs text-muted-foreground">
            {drive.message ||
              (drive.linked
                ? `${drive.folderCount} taxonomy folders indexed.`
                : "Specialists work without archive context until you link Drive.")}
          </p>
          {!drive.linked ? (
            <Button size="sm" className="mt-1" asChild>
              <Link href="/settings/?focus=drive">Link Google Drive</Link>
            </Button>
          ) : null}
        </div>
      </div>
    </div>
  );
}
