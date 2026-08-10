"use client";

import { useState } from "react";
import { FolderTree, Loader2 } from "lucide-react";
import {
  apiGet,
  apiPost,
  type TaxonomyHealthPreferResult,
  type TaxonomyHealthReport,
} from "@/lib/api-client";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

type Props = {
  linked: boolean;
  disabled?: boolean;
};

export function DriveTaxonomyHealth({ linked, disabled }: Props) {
  const [report, setReport] = useState<TaxonomyHealthReport | null>(null);
  const [busy, setBusy] = useState(false);
  const [preferBusy, setPreferBusy] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  const scan = async () => {
    setBusy(true);
    setNote(null);
    try {
      const next = await apiGet<TaxonomyHealthReport>("/archive/drive/taxonomy-health");
      setReport(next);
      setNote(next.note);
    } catch (err) {
      setNote(err instanceof Error ? err.message : "Taxonomy health scan failed");
    } finally {
      setBusy(false);
    }
  };

  const preferForever = async (category: number, folderId: string, folderName: string) => {
    const key = `${category}:${folderId}`;
    setPreferBusy(key);
    setNote(null);
    try {
      const result = await apiPost<TaxonomyHealthPreferResult>(
        "/archive/drive/taxonomy-health/prefer",
        { category, folderId },
      );
      setReport(result.report);
      setNote(
        `Preferred “${folderName}” for category ${String(category).padStart(2, "0")} forever. Drive folders were not deleted.`,
      );
    } catch (err) {
      setNote(err instanceof Error ? err.message : "Could not save folder preference");
    } finally {
      setPreferBusy(null);
    }
  };

  return (
    <div className="space-y-3 rounded-lg border border-border/70 bg-muted/20 p-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0 space-y-1">
          <p className="flex items-center gap-2 text-sm font-medium text-foreground">
            <FolderTree className="h-4 w-4 text-primary" />
            Taxonomy health
          </p>
          <p className="text-xs text-muted-foreground">
            Scan for duplicate category folders (e.g.{" "}
            <span className="font-mono">01_Official</span> vs{" "}
            <span className="font-mono">1. Official Documents</span>). Suggest a winner and
            prefer it forever — PersonAI never deletes Drive folders.
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          className="shrink-0"
          onClick={() => void scan()}
          disabled={disabled || busy || !linked}
        >
          {busy ? (
            <>
              <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
              Scanning…
            </>
          ) : (
            "Scan folder map"
          )}
        </Button>
      </div>

      {report ? (
        <div className="space-y-3">
          <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
            <Badge variant="outline">{report.childFolderCount} folders under root</Badge>
            <Badge variant={report.issues.length ? "default" : "outline"}>
              {report.issues.length
                ? `${report.issues.length} duplicate group${report.issues.length === 1 ? "" : "s"}`
                : "No duplicates"}
            </Badge>
          </div>

          {report.issues.length === 0 ? (
            <p className="text-xs text-muted-foreground">{report.note}</p>
          ) : (
            <ul className="space-y-3">
              {report.issues.map((issue) => {
                const candidates = [issue.suggested, ...issue.duplicates];
                return (
                  <li
                    key={issue.category}
                    className="space-y-2 rounded-md border border-border/60 bg-background/60 p-3"
                  >
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-medium">
                        {String(issue.category).padStart(2, "0")}_{issue.label}
                      </span>
                      {issue.cachedMatchesSuggested ? (
                        <Badge variant="outline">Preferred cached</Badge>
                      ) : issue.cachedFolderId ? (
                        <Badge variant="outline">Cache differs</Badge>
                      ) : null}
                    </div>
                    <p className="text-xs text-muted-foreground">{issue.reason}</p>
                    <ul className="space-y-2">
                      {candidates.map((folder) => {
                        const isSuggested = folder.id === issue.suggested.id;
                        const busyKey = `${issue.category}:${folder.id}`;
                        const isCached = issue.cachedFolderId === folder.id;
                        return (
                          <li
                            key={folder.id}
                            className="flex flex-wrap items-center justify-between gap-2 text-sm"
                          >
                            <div className="min-w-0">
                              <p className="truncate font-mono text-xs sm:text-sm">
                                {folder.name}
                                {isSuggested ? (
                                  <span className="ml-2 font-sans text-xs text-primary">
                                    suggested
                                  </span>
                                ) : null}
                              </p>
                              <p className="text-xs text-muted-foreground">
                                {folder.fileCount} item{folder.fileCount === 1 ? "" : "s"}
                                {folder.isPersonAiStyle ? " · PersonAI style" : " · legacy/human"}
                              </p>
                            </div>
                            <Button
                              size="sm"
                              variant={isSuggested ? "default" : "outline"}
                              disabled={disabled || preferBusy !== null || isCached}
                              onClick={() =>
                                void preferForever(issue.category, folder.id, folder.name)
                              }
                            >
                              {preferBusy === busyKey ? (
                                <>
                                  <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                                  Saving…
                                </>
                              ) : isCached ? (
                                "Using forever"
                              ) : (
                                "Prefer forever"
                              )}
                            </Button>
                          </li>
                        );
                      })}
                    </ul>
                  </li>
                );
              })}
            </ul>
          )}

          {report.mappings.some((m) => m.folderId) ? (
            <details className="text-xs text-muted-foreground">
              <summary className="cursor-pointer select-none">Full folder map</summary>
              <ul className="mt-2 space-y-1 font-mono">
                {report.mappings.map((m) => (
                  <li key={m.category}>
                    {String(m.category).padStart(2, "0")}_{m.label}:{" "}
                    {m.folderName ?? m.folderId ?? "—"}
                    {m.source ? ` (${m.source})` : ""}
                    {m.hasDuplicates ? " · dupes" : ""}
                  </li>
                ))}
              </ul>
            </details>
          ) : null}
        </div>
      ) : null}

      {note ? <p className="text-xs text-muted-foreground">{note}</p> : null}
    </div>
  );
}
