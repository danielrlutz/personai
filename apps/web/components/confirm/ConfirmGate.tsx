"use client";

import { useCallback, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Eye, ExternalLink, ShieldCheck, X } from "lucide-react";
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
  type ServerJobDto,
} from "@/components/confirm/DriveJobPulse";
import {
  isQrConfirm,
  qrFieldsFromPayload,
  type QrConfirmFields,
} from "@/lib/qr-confirm";
import { QrConfirmCockpit } from "./QrConfirmCockpit";
import { NearDuplicateRadar } from "./NearDuplicateRadar";

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

function qrDraftFromConfirmation(c: PendingConfirmation): QrConfirmFields | null {
  if (!isQrConfirm(c.action, c.payload)) return null;
  return qrFieldsFromPayload(c.action, c.payload);
}

function documentIdFromConfirmation(c: PendingConfirmation): string | null {
  const p = payloadRecord(c.payload);
  if (typeof p.documentId === "string" && p.documentId.trim()) return p.documentId.trim();
  if (c.entity === "Document" && typeof c.entityId === "string" && c.entityId.trim()) {
    return c.entityId.trim();
  }
  return null;
}

type PreviewState = {
  url: string;
  contentType: string;
  filename: string;
  documentId: string;
};

function DocumentPreviewModal({
  preview,
  onClose,
}: {
  preview: PreviewState;
  onClose: () => void;
}) {
  const isImage = preview.contentType.startsWith("image/");
  const isPdf =
    preview.contentType.includes("pdf") || preview.filename.toLowerCase().endsWith(".pdf");

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  if (typeof document === "undefined") return null;

  return createPortal(
    <div
      className="fixed inset-0 z-[80] flex items-center justify-center bg-black/70 p-3 sm:p-6"
      role="dialog"
      aria-modal="true"
      aria-label="Document preview"
      onClick={onClose}
    >
      <div
        className="flex max-h-[92vh] w-full max-w-3xl flex-col overflow-hidden rounded-xl border border-border bg-background shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between gap-2 border-b border-border px-3 py-2">
          <p className="min-w-0 truncate font-mono text-xs text-muted-foreground">
            {preview.filename}
          </p>
          <div className="flex shrink-0 gap-1">
            <Button
              size="sm"
              variant="ghost"
              onClick={() => window.open(preview.url, "_blank", "noopener,noreferrer")}
            >
              <ExternalLink className="mr-1 h-3.5 w-3.5" />
              Open tab
            </Button>
            <Button size="sm" variant="ghost" onClick={onClose} aria-label="Close preview">
              <X className="h-4 w-4" />
            </Button>
          </div>
        </div>
        <div className="min-h-0 flex-1 overflow-auto bg-muted/30">
          {isImage ? (
            <img
              src={preview.url}
              alt={preview.filename}
              className="mx-auto max-h-[80vh] w-auto max-w-full object-contain"
            />
          ) : isPdf ? (
            <iframe
              title={preview.filename}
              src={preview.url}
              className="h-[80vh] w-full border-0 bg-white"
            />
          ) : (
            <div className="space-y-3 p-6 text-sm">
              <p>No in-app preview for this file type ({preview.contentType || "unknown"}).</p>
              <Button
                size="sm"
                onClick={() => window.open(preview.url, "_blank", "noopener,noreferrer")}
              >
                Open in new tab
              </Button>
            </div>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}

export function ConfirmGate({
  refreshKey = 0,
  onResolved,
  compact,
  showEmpty = false,
}: ConfirmGateProps) {
  const [items, setItems] = useState<PendingConfirmation[]>([]);
  const [drafts, setDrafts] = useState<Record<string, ArchiveDraft>>({});
  const [qrDrafts, setQrDrafts] = useState<Record<string, QrConfirmFields>>({});
  const [busyId, setBusyId] = useState<string | null>(null);
  const [previewBusyId, setPreviewBusyId] = useState<string | null>(null);
  const [preview, setPreview] = useState<PreviewState | null>(null);
  const [error, setError] = useState<string | null>(null);
  /** Drive upload ServerJob ids returned by confirm (pulse strip). */
  const [driveJobIds, setDriveJobIds] = useState<string[]>([]);
  /** Confirmation ids with near-duplicate hits (Confirm → File anyway). */
  const [nearDupeIds, setNearDupeIds] = useState<Record<string, boolean>>({});

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
      const nextQr: Record<string, QrConfirmFields> = {};
      for (const c of data.confirmations) {
        const d = draftFromConfirmation(c);
        if (d) next[c.id] = d;
        const qr = qrDraftFromConfirmation(c);
        if (qr) nextQr[c.id] = qr;
      }
      setDrafts(next);
      setQrDrafts(nextQr);
      setNearDupeIds((prev) => {
        const kept: Record<string, boolean> = {};
        for (const c of data.confirmations) {
          if (prev[c.id]) kept[c.id] = true;
        }
        return kept;
      });
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

  const openDocumentPreview = async (
    documentId: string,
    opts: { busyKey: string; fallbackName?: string },
  ) => {
    setPreviewBusyId(opts.busyKey);
    try {
      const result = await apiGetBlob(`/documents/${documentId}/file`, { silent: true });
      const url = URL.createObjectURL(result.blob);
      setPreview((prev) => {
        if (prev?.url) URL.revokeObjectURL(prev.url);
        return {
          url,
          filename: result.filename || opts.fallbackName || documentId,
          contentType: result.contentType,
          documentId,
        };
      });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not open file", {
        title: "Preview failed",
        sticky: true,
        dedupeKey: `confirm-preview:${documentId}`,
      });
    } finally {
      setPreviewBusyId(null);
    }
  };

  const viewDocument = async (c: PendingConfirmation) => {
    const documentId = documentIdFromConfirmation(c);
    if (!documentId) {
      toast.error("No document linked to this confirmation.");
      return;
    }
    await openDocumentPreview(documentId, { busyKey: c.id });
  };

  const viewExistingDocument = async (
    confirmationId: string,
    documentId: string,
    archiveName?: string,
  ) => {
    await openDocumentPreview(documentId, {
      busyKey: confirmationId,
      fallbackName: archiveName || documentId,
    });
  };

  const decide = async (id: string, decision: "confirm" | "reject") => {
    setBusyId(id);
    try {
      if (decision === "confirm") {
        const patch: Record<string, unknown> = {};
        if (drafts[id]) {
          patch.archiveName = buildArchiveName(drafts[id]!);
          patch.archiveCategory = drafts[id]!.archiveCategory;
        }
        const qr = qrDrafts[id];
        if (qr) {
          patch.fileArchive = qr.fileArchive;
          if (items.find((c) => c.id === id)?.action === "qr.mark_paid") {
            patch.writeLedger = qr.writeLedger;
          } else {
            patch.markPaid = qr.markPaid;
          }
        }
        if (Object.keys(patch).length) {
          await apiPatch(`/confirmations/${id}`, patch);
        }
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
            View the file, edit archive naming, then Confirm. QR-Rechnung cards show Zahlteil fields
            and archive / paid→ledger toggles. Likely already-filed matches offer Open existing or
            File anyway — never auto-skipped. Confirm writes Drive/ledger; Decline leaves external
            systems unchanged.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {error ? <p className="text-sm text-destructive">{error}</p> : null}
          <ul className="space-y-3">
            {items.map((c) => {
              const draft = drafts[c.id];
              const qr = qrDrafts[c.id];
              const documentId = documentIdFromConfirmation(c);
              const archivePreview = draft ? buildArchiveName(draft) : null;
              const showArchiveNaming = Boolean(draft) && (!qr || qr.fileArchive);
              const isMarkPaidAction = c.action === "qr.mark_paid";
              return (
                <li
                  key={c.id}
                  className="space-y-3 rounded-xl border border-border/80 bg-surface-container/60 px-3 py-3"
                >
                  <div className="min-w-0">
                    <p className="text-xs font-medium tracking-wide text-muted-foreground">
                      {labelForConfirmAction(c.action, c.payload)}
                    </p>
                    <p className="md-label-large break-words [overflow-wrap:anywhere]">
                      {humanizeConfirmationSummary(c.summary)}
                    </p>
                  </div>

                  {qr ? (
                    <QrConfirmCockpit
                      fields={qr}
                      isMarkPaidAction={isMarkPaidAction}
                      busy={busyId === c.id}
                      onChange={(next) =>
                        setQrDrafts((prev) => ({
                          ...prev,
                          [c.id]: next,
                        }))
                      }
                    />
                  ) : null}

                  {showArchiveNaming && draft ? (
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
                          placeholder="BILL"
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

                  {draft && (c.action === "archive.commit" || c.action === "ledger.write") ? (
                    <NearDuplicateRadar
                      draft={draft}
                      excludeDocumentId={documentId}
                      onHitsChange={(hasHits) =>
                        setNearDupeIds((prev) => ({ ...prev, [c.id]: hasHits }))
                      }
                      onOpenExisting={(id, name) => void viewExistingDocument(c.id, id, name)}
                    />
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
                      {nearDupeIds[c.id] ? "File anyway" : "Confirm"}
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