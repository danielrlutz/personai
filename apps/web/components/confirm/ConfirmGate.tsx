"use client";

import { useCallback, useEffect, useState } from "react";
import { Eye, ShieldCheck, X } from "lucide-react";
import {
  apiGet,
  apiGetBlob,
  apiPatch,
  apiPost,
  type PendingConfirmation,
} from "@/lib/api-client";
import {
  humanizeConfirmationSummary,
  labelForConfirmAction,
} from "@/lib/confirm-labels";
import {
  buildArchiveName,
  draftFromArchivePayload,
  type ArchiveDraft,
} from "@/lib/archive-naming";
import { ARCHIVE_TAXONOMY_CLIENT } from "@/lib/archive-taxonomy";
import { toast } from "@/lib/toast";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  DriveJobPulseStrip,
  trackDriveJobPulse,
} from "@/components/confirm/DriveJobPulse";
import {
  DocumentPreviewModal,
  type DocumentPreviewState,
} from "@/components/shared/DocumentPreviewModal";

interface ConfirmGateProps {
  refreshKey?: number;
  onResolved?: (decision: "confirm" | "reject") => void;
  compact?: boolean;
  /** When true, show an honest empty card instead of hiding (Home widget). */
  showEmpty?: boolean;
}

function payloadRecord(payload: unknown): Record<string, unknown> {
  return payload && typeof payload === "object" ? (payload as Record<string, unknown>) : {};
}

function draftFromConfirmation(c: PendingConfirmation): ArchiveDraft | null {
  if (c.action !== "archive.commit" && c.action !== "ledger.write") return null;
  return draftFromArchivePayload(c.payload);
}

function documentIdFromConfirmation(c: PendingConfirmation): string | null {
  const p = payloadRecord(c.payload);
  if (typeof p.documentId === "string" && p.documentId.trim()) return p.documentId.trim();
  if (c.entity === "Document" && typeof c.entityId === "string" && c.entityId.trim()) {
    return c.entityId.trim();
  }
  return null;
}

export function ConfirmGate({
  refreshKey = 0,
  onResolved,
  compact,
  showEmpty = false,
}: ConfirmGateProps) {
  const [items, setItems] = useState<PendingConfirmation[]>([]);
  const [drafts, setDrafts] = useState<Record<string, ArchiveDraft>>({});
  const [busyId, setBusyId] = useState<string | null>(null);
  const [previewBusyId, setPreviewBusyId] = useState<string | null>(null);
  const [preview, setPreview] = useState<DocumentPreviewState | null>(null);
  const [error, setError] = useState<string | null>(null);
  /** Drive upload ServerJob ids returned by confirm (pulse strip). */
  const [driveJobIds, setDriveJobIds] = useState<string[]>([]);

  const closePreview = useCallback(() => {
    setPreview((prev) => {
      if (prev?.url) URL.revokeObjectURL(prev.url);
      return null;
    });
  }, []);

  useEffect(() => {
    return () => {
      if (preview?.url) URL.revokeObjectURL(preview.url);
    };
  }, [preview?.url]);

  const load = useCallback(async () => {
    try {
      const data = await apiGet<{ confirmations: PendingConfirmation[] }>("/confirmations", {
        silent: true,
      });
      setItems(data.confirmations);
      const next: Record<string, ArchiveDraft> = {};
      for (const c of data.confirmations) {
        const d = draftFromConfirmation(c);
        if (d) next[c.id] = d;
      }
      setDrafts(next);
      setError(null);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to load confirmations";
      setError(message);
      toast.error(message, {
        title: "Couldn't load confirmations",
        sticky: true,
        dedupeKey: `confirm-load:${message}`,
      });
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load, refreshKey]);

  const saveDraft = async (id: string) => {
    const d = drafts[id];
    if (!d) return;
    setBusyId(id);
    try {
      const archiveName = buildArchiveName(d);
      await apiPatch(`/confirmations/${id}`, {
        archiveName,
        archiveCategory: d.archiveCategory,
        summary: `File as ${archiveName} (folder ${d.archiveCategory})`,
      });
      await load();
      toast.success("Naming updated — still not filed until you Confirm.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not update naming");
    } finally {
      setBusyId(null);
    }
  };

  const viewDocument = async (c: PendingConfirmation) => {
    const documentId = documentIdFromConfirmation(c);
    if (!documentId) {
      toast.error("No document linked to this confirmation.");
      return;
    }
    setPreviewBusyId(c.id);
    try {
      const result = await apiGetBlob(`/documents/${documentId}/file`, { silent: true });
      const url = URL.createObjectURL(result.blob);
      const draft = drafts[c.id];
      const fallbackName = draft ? buildArchiveName(draft) : documentId;
      setPreview((prev) => {
        if (prev?.url) URL.revokeObjectURL(prev.url);
        return {
          url,
          contentType: result.contentType,
          filename: result.filename || fallbackName,
          documentId,
        };
      });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not open document", {
        title: "Preview failed",
        sticky: true,
        dedupeKey: `confirm-preview:${documentId}`,
      });
    } finally {
      setPreviewBusyId(null);
    }
  };

  const decide = async (id: string, decision: "confirm" | "reject") => {
    setBusyId(id);
    try {
      if (decision === "confirm" && drafts[id]) {
        await apiPatch(`/confirmations/${id}`, {
          archiveName: buildArchiveName(drafts[id]!),
          archiveCategory: drafts[id]!.archiveCategory,
        });
      }
      const out = await apiPost<{
        driveJob?: ServerJobDto | null;
        async?: boolean;
      }>(
        `/confirmations/${id}/${decision === "confirm" ? "confirm" : "reject"}`,
        undefined,
        { silent: true },
      );
      await load();
      onResolved?.(decision);
      if (decision === "reject") {
        toast.success("Declined — external systems unchanged; local staging kept.");
      } else if (out?.driveJob?.id) {
        trackDriveJobPulse(out.driveJob.id);
        setDriveJobIds((prev) =>
          prev.includes(out.driveJob!.id) ? prev : [out.driveJob!.id, ...prev],
        );
        toast.success("Filed locally — Drive upload continuing in the background.");
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : "Action failed";
      setError(message);
      toast.error(message, {
        title: decision === "confirm" ? "Couldn't confirm" : "Couldn't decline",
        sticky: true,
        dedupeKey: `confirm-decide:${id}:${message}`,
      });
    } finally {
      setBusyId(null);
    }
  };

  const pulseStrip = (
    <DriveJobPulseStrip jobIds={driveJobIds} compact={compact} className="mb-3" />
  );

  if (items.length === 0 && !error) {
    // Mount strip even with empty jobIds so session-stored pulses restore after navigation.
    if (!showEmpty) return pulseStrip;
    return (
      <>
        {pulseStrip}
      <Card className={compact ? "border-primary/30" : undefined}>
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-base">
            <ShieldCheck className="h-4 w-4 text-primary" />
            Needs your confirmation
            <Badge variant="outline">0</Badge>
          </CardTitle>
          <CardDescription className="text-xs">
            Nothing waiting. Archive naming, ledger writes, and similar actions will ask here before
            they touch external systems.
          </CardDescription>
        </CardHeader>
      </Card>
      </>
    );
  }

  return (
    <>
      {preview ? <DocumentPreviewModal preview={preview} onClose={closePreview} /> : null}
      {pulseStrip}
      <Card className={compact ? "border-primary/30" : undefined}>
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-base">
            <ShieldCheck className="h-4 w-4 text-primary" />
            Needs your confirmation
            <Badge variant="outline">{items.length}</Badge>
          </CardTitle>
          <CardDescription className="text-xs">
            View the file, edit archive naming, then Confirm. Confirm writes Drive/ledger; Decline
            leaves external systems unchanged. Calendar proposes stage locally until Google Calendar
            write is wired.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {error ? <p className="text-sm text-destructive">{error}</p> : null}
          <ul className="space-y-3">
            {items.map((c) => {
              const draft = drafts[c.id];
              const documentId = documentIdFromConfirmation(c);
              const archivePreview = draft ? buildArchiveName(draft) : null;
              return (
                <li
                  key={c.id}
                  className="space-y-3 rounded-xl border border-border/80 bg-surface-container/60 px-3 py-3"
                >
                  <div className="min-w-0">
                    <p className="text-xs font-medium tracking-wide text-muted-foreground">
                      {labelForConfirmAction(c.action)}
                    </p>
                    <p className="md-label-large break-words [overflow-wrap:anywhere]">
                      {humanizeConfirmationSummary(c.summary)}
                    </p>
                  </div>

                  {draft ? (
                    <div className="grid gap-2 sm:grid-cols-2">
                      <label className="space-y-1 text-xs text-muted-foreground">
                        Date
                        <Input
                          type="date"
                          value={draft.date}
                          onChange={(e) =>
                            setDrafts((prev) => ({
                              ...prev,
                              [c.id]: { ...draft, date: e.target.value },
                            }))
                          }
                        />
                      </label>
                      <label className="space-y-1 text-xs text-muted-foreground">
                        DocType
                        <Input
                          value={draft.docType}
                          onChange={(e) =>
                            setDrafts((prev) => ({
                              ...prev,
                              [c.id]: { ...draft, docType: e.target.value },
                            }))
                          }
                          placeholder="Invoice"
                        />
                      </label>
                      <label className="space-y-1 text-xs text-muted-foreground sm:col-span-2">
                        Entity
                        <Input
                          value={draft.entity}
                          onChange={(e) =>
                            setDrafts((prev) => ({
                              ...prev,
                              [c.id]: { ...draft, entity: e.target.value },
                            }))
                          }
                          placeholder="Swisscom"
                        />
                      </label>
                      <label className="space-y-1 text-xs text-muted-foreground sm:col-span-2">
                        Category
                        <select
                          className="flex h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                          value={draft.archiveCategory}
                          onChange={(e) =>
                            setDrafts((prev) => ({
                              ...prev,
                              [c.id]: { ...draft, archiveCategory: Number(e.target.value) },
                            }))
                          }
                        >
                          {Object.entries(ARCHIVE_TAXONOMY_CLIENT).map(([n, label]) => (
                            <option key={n} value={n}>
                              {String(n).padStart(2, "0")} · {label}
                            </option>
                          ))}
                        </select>
                      </label>
                      <p className="font-mono text-[11px] text-muted-foreground sm:col-span-2">
                        → {archivePreview}
                        <span className="ml-2 text-[10px] uppercase tracking-wide opacity-70">
                          ({draft.extension.replace(".", "") || "file"})
                        </span>
                      </p>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="sm:col-span-2"
                        disabled={busyId === c.id}
                        onClick={() => void saveDraft(c.id)}
                      >
                        Save naming (still pending)
                      </Button>
                    </div>
                  ) : null}

                  <div className="flex flex-wrap shrink-0 gap-2">
                    {documentId ? (
                      <Button
                        size="sm"
                        variant="secondary"
                        disabled={previewBusyId === c.id || busyId === c.id}
                        onClick={() => void viewDocument(c)}
                      >
                        <Eye className="mr-1 h-3.5 w-3.5" />
                        {previewBusyId === c.id ? "Opening…" : "View file"}
                      </Button>
                    ) : null}
                    <Button
                      size="sm"
                      disabled={busyId === c.id}
                      onClick={() => void decide(c.id, "confirm")}
                    >
                      Confirm
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={busyId === c.id}
                      onClick={() => void decide(c.id, "reject")}
                    >
                      <X className="mr-1 h-3 w-3" />
                      Decline
                    </Button>
                  </div>
                </li>
              );
            })}
          </ul>
        </CardContent>
      </Card>
    </>
  );
}
