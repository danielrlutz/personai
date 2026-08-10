"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ShieldCheck } from "lucide-react";
import {
  apiGet,
  apiGetBlob,
  apiPatch,
  apiPost,
  type PendingConfirmation,
} from "@/lib/api-client";
import { buildArchiveName, type ArchiveDraft } from "@/lib/archive-naming";
import {
  fristKitProposeBody,
  teamHrefFromConfirmResult,
} from "@/lib/frist-kit";
import { toast } from "@/lib/toast";
import { FristKitButton, FristKitHint } from "./FristKitActions";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ConfirmCarousel } from "./ConfirmCarousel";
import { ConfirmItemCard } from "./ConfirmItemCard";
import { DocumentPreviewModal } from "./DocumentPreviewModal";
import {
  documentIdFromConfirmation,
  draftFromConfirmation,
  type PreviewState,
} from "./confirm-utils";
import { useNarrowViewport } from "./useNarrowViewport";

interface ConfirmGateProps {
  refreshKey?: number;
  onResolved?: (decision: "confirm" | "reject") => void;
  compact?: boolean;
  /** When true, show an honest empty card instead of hiding (Home widget). */
  showEmpty?: boolean;
}

export function ConfirmGate({
  refreshKey = 0,
  onResolved,
  compact,
  showEmpty = false,
}: ConfirmGateProps) {
  const router = useRouter();
  const narrow = useNarrowViewport();
  const [items, setItems] = useState<PendingConfirmation[]>([]);
  const [drafts, setDrafts] = useState<Record<string, ArchiveDraft>>({});
  const [busyId, setBusyId] = useState<string | null>(null);
  const [previewBusyId, setPreviewBusyId] = useState<string | null>(null);
  const [preview, setPreview] = useState<PreviewState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [carouselIndex, setCarouselIndex] = useState(0);
  const [applyEntityToRemaining, setApplyEntityToRemaining] = useState(false);

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
      setCarouselIndex((i) => Math.min(i, Math.max(data.confirmations.length - 1, 0)));
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
    opts?: { busyKey?: string; fallbackName?: string },
  ) => {
    const busyKey = opts?.busyKey ?? documentId;
    setPreviewBusyId(busyKey);
    try {
      const result = await apiGetBlob(`/documents/${documentId}/file`, { silent: true });
      const url = URL.createObjectURL(result.blob);
      setPreview((prev) => {
        if (prev?.url) URL.revokeObjectURL(prev.url);
        return {
          url,
          contentType: result.contentType,
          filename: result.filename || opts?.fallbackName || documentId,
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

  const viewDocument = async (c: PendingConfirmation) => {
    const documentId = documentIdFromConfirmation(c);
    if (!documentId) {
      toast.error("No document linked to this confirmation.");
      return;
    }
    const draft = drafts[c.id];
    await openDocumentPreview(documentId, {
      busyKey: c.id,
      fallbackName: draft ? buildArchiveName(draft) : documentId,
    });
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

  const applyEntityAcrossRemaining = async (
    entity: string,
    remaining: PendingConfirmation[],
    draftsSnapshot: Record<string, ArchiveDraft>,
  ) => {
    const trimmed = entity.trim();
    if (!trimmed || remaining.length === 0) return;

    setDrafts((prev) => {
      const next = { ...prev };
      for (const c of remaining) {
        const d = next[c.id];
        if (d) next[c.id] = { ...d, entity: trimmed };
      }
      return next;
    });

    await Promise.allSettled(
      remaining.map(async (c) => {
        const d = draftsSnapshot[c.id];
        if (!d) return;
        const updated = { ...d, entity: trimmed };
        const archiveName = buildArchiveName(updated);
        await apiPatch(
          `/confirmations/${c.id}`,
          {
            archiveName,
            archiveCategory: updated.archiveCategory,
            summary: `File as ${archiveName} (folder ${updated.archiveCategory})`,
          },
          { silent: true },
        );
      }),
    );

    toast.success(`Entity “${trimmed}” applied to ${remaining.length} remaining.`);
  };

  const queueFristKit = async (c: PendingConfirmation) => {
    const draft = drafts[c.id];
    const body = fristKitProposeBody(c, {
      archiveName: draft ? buildArchiveName(draft) : undefined,
    });
    if (!body) {
      toast.error("No Frist date on this confirm — add a deadline first.");
      return;
    }
    setBusyId(c.id);
    try {
      await apiPost("/legal/frist-kit/propose", body, { silent: true });
      await load();
      toast.success("Frist kit queued — Confirm to create Legal task + stage calendar.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not queue Frist kit");
    } finally {
      setBusyId(null);
    }
  };

  const decide = async (id: string, decision: "confirm" | "reject") => {
    setBusyId(id);
    const idx = items.findIndex((c) => c.id === id);
    const remaining = idx >= 0 ? items.slice(idx + 1) : [];
    const draftsSnapshot = drafts;
    const entityForStack =
      decision === "confirm" && applyEntityToRemaining
        ? draftsSnapshot[id]?.entity?.trim()
        : "";

    try {
      if (decision === "confirm" && draftsSnapshot[id]) {
        await apiPatch(`/confirmations/${id}`, {
          archiveName: buildArchiveName(draftsSnapshot[id]!),
          archiveCategory: draftsSnapshot[id]!.archiveCategory,
        });
      }
      await apiPost(
        `/confirmations/${id}/${decision === "confirm" ? "confirm" : "reject"}`,
        undefined,
        { silent: true },
      );

      if (entityForStack) {
        await applyEntityAcrossRemaining(entityForStack, remaining, draftsSnapshot);
      }

      await load();
      if (idx >= 0) {
        setCarouselIndex(Math.min(idx, Math.max(remaining.length - 1, 0)));
      }
      onResolved?.(decision);
      if (decision === "reject") {
        toast.success("Declined — external systems unchanged; local staging kept.");
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

  const useCarousel = narrow && !compact && items.length > 0;

  if (items.length === 0 && !error) {
    if (!showEmpty) return null;
    return (
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
    );
  }

  return (
    <>
      {preview ? <DocumentPreviewModal preview={preview} onClose={closePreview} /> : null}
      <Card className={compact ? "border-primary/30" : undefined}>
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-base">
            <ShieldCheck className="h-4 w-4 text-primary" />
            Needs your confirmation
            <Badge variant="outline">{items.length}</Badge>
          </CardTitle>
          <CardDescription className="text-xs">
            {useCarousel
              ? "Swipe the stack: View file, edit naming, then Confirm or Decline. Likely duplicates offer Open existing / File anyway — never auto-skipped."
              : "View the file, edit archive naming, then Confirm. Likely already-filed matches offer Open existing or File anyway — never auto-skipped."}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {error ? <p className="text-sm text-destructive">{error}</p> : null}

          {useCarousel ? (
            <ConfirmCarousel
              items={items}
              drafts={drafts}
              index={carouselIndex}
              onIndexChange={setCarouselIndex}
              busyId={busyId}
              previewBusyId={previewBusyId}
              applyEntityToRemaining={applyEntityToRemaining}
              onApplyEntityChange={setApplyEntityToRemaining}
              onDraftChange={(id, draft) =>
                setDrafts((prev) => ({
                  ...prev,
                  [id]: draft,
                }))
              }
              onSaveDraft={(id) => void saveDraft(id)}
              onView={(c) => void viewDocument(c)}
              onOpenExisting={(confirmationId, documentId, archiveName) =>
                void viewExistingDocument(confirmationId, documentId, archiveName)
              }
              onConfirm={(id) => void decide(id, "confirm")}
              onDecline={(id) => void decide(id, "reject")}
            />
          ) : (
            <ul className="space-y-3">
              {items.map((c, i) => {
                const remainingAfter = items.length - i - 1;
                return (
                  <li
                    key={c.id}
                    className="rounded-xl border border-border/80 bg-surface-container/60 px-3 py-3"
                  >
                    <ConfirmItemCard
                      confirmation={c}
                      draft={drafts[c.id] ?? null}
                      busy={busyId === c.id}
                      previewBusy={previewBusyId === c.id}
                      remainingCount={remainingAfter}
                      applyEntityToRemaining={applyEntityToRemaining}
                      onApplyEntityChange={setApplyEntityToRemaining}
                      onDraftChange={(draft) =>
                        setDrafts((prev) => ({
                          ...prev,
                          [c.id]: draft,
                        }))
                      }
                      onSaveDraft={() => void saveDraft(c.id)}
                      onView={() => void viewDocument(c)}
                      onOpenExisting={(documentId, archiveName) =>
                        void viewExistingDocument(c.id, documentId, archiveName)
                      }
                      onConfirm={() => void decide(c.id, "confirm")}
                      onDecline={() => void decide(c.id, "reject")}
                    />
                  </li>
                );
              })}
            </ul>
          )}
        </CardContent>
      </Card>
    </>
  );
}
