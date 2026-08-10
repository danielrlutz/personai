"use client";

import { useEffect, useState } from "react";
import { Copy, Eye, Loader2 } from "lucide-react";
import { apiGet } from "@/lib/api-client";
import type { ArchiveDraft } from "@/lib/archive-naming";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

export type NearDuplicateHit = {
  documentId: string | null;
  archiveName: string;
  archiveCategory: number | null;
  confirmedAt: string | null;
  date: string | null;
  docType: string | null;
  entity: string | null;
  score: number;
  reasons: string[];
  source: "db" | "fs";
  dayDelta: number | null;
};

type NearDuplicateRadarProps = {
  draft: ArchiveDraft;
  excludeDocumentId?: string | null;
  onOpenExisting: (documentId: string, archiveName: string) => void;
  onHitsChange?: (hasHits: boolean) => void;
};

function dayDeltaLabel(delta: number | null): string | null {
  if (delta == null) return null;
  if (delta === 0) return "same day";
  const abs = Math.abs(delta);
  return delta < 0 ? `${abs}d earlier` : `${abs}d later`;
}

export function NearDuplicateRadar({
  draft,
  excludeDocumentId,
  onOpenExisting,
  onHitsChange,
}: NearDuplicateRadarProps) {
  const [hits, setHits] = useState<NearDuplicateHit[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const date = draft.date?.trim() ?? "";
    const docType = draft.docType?.trim() ?? "";
    const entity = draft.entity?.trim() ?? "";
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || (!docType && !entity)) {
      setHits([]);
      onHitsChange?.(false);
      return;
    }

    let cancelled = false;
    const timer = window.setTimeout(() => {
      void (async () => {
        setLoading(true);
        setError(null);
        try {
          const params = new URLSearchParams({
            date,
            docType: docType || "OTHER",
            entity: entity || "Unknown",
            archiveCategory: String(draft.archiveCategory ?? 9),
            windowDays: "7",
          });
          if (excludeDocumentId) params.set("excludeDocumentId", excludeDocumentId);
          const data = await apiGet<{ hits: NearDuplicateHit[]; autoSkip: boolean }>(
            `/archive/near-duplicates?${params.toString()}`,
            { silent: true },
          );
          if (cancelled) return;
          void data.autoSkip;
          setHits(data.hits ?? []);
          onHitsChange?.((data.hits ?? []).length > 0);
        } catch (err) {
          if (cancelled) return;
          setHits([]);
          onHitsChange?.(false);
          setError(err instanceof Error ? err.message : "Radar unavailable");
        } finally {
          if (!cancelled) setLoading(false);
        }
      })();
    }, 320);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [
    draft.date,
    draft.docType,
    draft.entity,
    draft.archiveCategory,
    excludeDocumentId,
    onHitsChange,
  ]);

  if (!loading && !error && hits.length === 0) return null;

  return (
    <div
      className="space-y-2 rounded-lg border border-warning/40 bg-warning/10 px-3 py-2.5"
      role="status"
      aria-live="polite"
    >
      <div className="flex items-center gap-2">
        <Copy className="h-3.5 w-3.5 shrink-0 text-warning" />
        <p className="text-sm font-medium">Already filed?</p>
        {loading ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />
        ) : (
          <Badge variant="warning">{hits.length}</Badge>
        )}
      </div>
      <p className="text-xs text-muted-foreground">
        Likely duplicates in your local archive (Entity / DocType / +/-7 days). Open an existing
        file or file anyway — never auto-skipped.
      </p>
      {error ? <p className="text-xs text-destructive">{error}</p> : null}
      {hits.length > 0 ? (
        <ul className="space-y-2">
          {hits.map((hit) => {
            const delta = dayDeltaLabel(hit.dayDelta);
            return (
              <li
                key={`${hit.documentId ?? "fs"}:${hit.archiveName}`}
                className="flex flex-wrap items-start justify-between gap-2 rounded-md border border-border/60 bg-background/60 px-2.5 py-2"
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate font-mono text-[11px]">{hit.archiveName}</p>
                  <p className="mt-0.5 text-[11px] text-muted-foreground">
                    {hit.reasons[0] ?? "Near match"}
                    {delta ? ` · ${delta}` : ""}
                    {hit.source === "fs" ? " · on disk" : ""}
                    {" · "}
                    score {hit.score}
                  </p>
                </div>
                {hit.documentId ? (
                  <Button
                    size="sm"
                    variant="secondary"
                    className="shrink-0"
                    onClick={() => onOpenExisting(hit.documentId!, hit.archiveName)}
                  >
                    <Eye className="mr-1 h-3.5 w-3.5" />
                    Open existing
                  </Button>
                ) : (
                  <span className="shrink-0 text-[10px] uppercase tracking-wide text-muted-foreground">
                    No preview id
                  </span>
                )}
              </li>
            );
          })}
        </ul>
      ) : null}
    </div>
  );
}
