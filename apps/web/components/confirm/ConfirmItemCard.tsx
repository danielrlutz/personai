"use client";

import { useCallback, useState } from "react";
import { Eye, Flag, X } from "lucide-react";
import type { PendingConfirmation } from "@/lib/api-client";
import {
  humanizeConfirmationSummary,
  labelForConfirmAction,
} from "@/lib/confirm-labels";
import { buildArchiveName, type ArchiveDraft } from "@/lib/archive-naming";
import { ARCHIVE_TAXONOMY_CLIENT } from "@/lib/archive-taxonomy";
import {
  labelForReinspectStatus,
  reinspectStatusFromPayload,
  type ReinspectStatus,
} from "@/lib/reinspect-status";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { documentIdFromConfirmation } from "./confirm-utils";
import { NearDuplicateRadar } from "./NearDuplicateRadar";

function badgeVariantForReinspect(
  status: ReinspectStatus,
): "warning" | "secondary" | "success" | "destructive" {
  switch (status) {
    case "flagged":
      return "warning";
    case "reinspecting":
      return "secondary";
    case "ready":
      return "success";
    case "failed":
      return "destructive";
  }
}

function flagButtonLabel(status: ReinspectStatus | null): string {
  if (status === "flagged" || status === "reinspecting") return "Closer inspection…";
  if (status === "ready" || status === "failed") return "Flag again";
  return "Flag for closer inspection";
}

export interface ConfirmItemCardProps {
  confirmation: PendingConfirmation;
  draft: ArchiveDraft | null;
  busy: boolean;
  previewBusy: boolean;
  /** Remaining items after this one (for “same Entity” affordance). */
  remainingCount?: number;
  applyEntityToRemaining?: boolean;
  onApplyEntityChange?: (value: boolean) => void;
  onDraftChange: (draft: ArchiveDraft) => void;
  onSaveDraft: () => void;
  onView: () => void;
  /** Open an already-filed document (near-duplicate radar). */
  onOpenExisting?: (documentId: string, archiveName?: string) => void;
  onConfirm: () => void;
  onDecline: () => void;
  /** Flag incomplete confirm for neighbor OCR + higher-tier refine. */
  onFlagReinspect?: () => void;
  /** Tighter actions layout for carousel. */
  stackActions?: boolean;
}

export function ConfirmItemCard({
  confirmation: c,
  draft,
  busy,
  previewBusy,
  remainingCount = 0,
  applyEntityToRemaining = false,
  onApplyEntityChange,
  onDraftChange,
  onSaveDraft,
  onView,
  onOpenExisting,
  onConfirm,
  onDecline,
  onFlagReinspect,
  stackActions = false,
}: ConfirmItemCardProps) {
  const documentId = documentIdFromConfirmation(c);
  const archivePreview = draft ? buildArchiveName(draft) : null;
  const showApplyEntity =
    Boolean(draft) && remainingCount > 0 && typeof onApplyEntityChange === "function";
  const entityHint = draft?.entity?.trim() || "this Entity";
  const [hasNearDupes, setHasNearDupes] = useState(false);
  const onHitsChange = useCallback((hasHits: boolean) => {
    setHasNearDupes(hasHits);
  }, []);
  const reinspectStatus = reinspectStatusFromPayload(c.payload);
  const reinspectBusy =
    reinspectStatus === "flagged" || reinspectStatus === "reinspecting";
  const actionsDisabled = busy || reinspectBusy;

  return (
    <div className="space-y-3">
      <div className="min-w-0">
        <p className="flex flex-wrap items-center gap-2 text-xs font-medium tracking-wide text-muted-foreground">
          {labelForConfirmAction(c.action, c.payload)}
          {reinspectStatus ? (
            <Badge variant={badgeVariantForReinspect(reinspectStatus)}>
              {labelForReinspectStatus(reinspectStatus)}
            </Badge>
          ) : null}
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
              onChange={(e) => onDraftChange({ ...draft, date: e.target.value })}
            />
          </label>
          <label className="space-y-1 text-xs text-muted-foreground">
            DocType
            <Input
              value={draft.docType}
              onChange={(e) => onDraftChange({ ...draft, docType: e.target.value })}
              placeholder="Invoice"
            />
          </label>
          <label className="space-y-1 text-xs text-muted-foreground sm:col-span-2">
            Entity
            <Input
              value={draft.entity}
              onChange={(e) => onDraftChange({ ...draft, entity: e.target.value })}
              placeholder="Swisscom"
            />
          </label>
          <label className="space-y-1 text-xs text-muted-foreground sm:col-span-2">
            Category
            <select
              className="flex h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
              value={draft.archiveCategory}
              onChange={(e) =>
                onDraftChange({ ...draft, archiveCategory: Number(e.target.value) })
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
            disabled={busy}
            onClick={onSaveDraft}
          >
            Save naming (still pending)
          </Button>
        </div>
      ) : null}

      {draft && (c.action === "archive.commit" || c.action === "ledger.write") ? (
        <NearDuplicateRadar
          draft={draft}
          excludeDocumentId={documentId}
          onHitsChange={onHitsChange}
          onOpenExisting={(id, name) => {
            if (onOpenExisting) onOpenExisting(id, name);
            else onView();
          }}
        />
      ) : null}

      {showApplyEntity ? (
        <label className="flex cursor-pointer items-start gap-2.5 rounded-lg border border-border/70 bg-background/50 px-3 py-2.5 text-sm">
          <input
            type="checkbox"
            className="mt-1 h-4 w-4 shrink-0 accent-primary"
            checked={applyEntityToRemaining}
            onChange={(e) => onApplyEntityChange?.(e.target.checked)}
          />
          <span className="min-w-0 leading-snug">
            <span className="font-medium">Same Entity for remaining</span>
            <span className="mt-0.5 block text-xs text-muted-foreground">
              Apply “{entityHint}” to {remainingCount} more pending
              {remainingCount === 1 ? " item" : " items"} after Confirm.
            </span>
          </span>
        </label>
      ) : null}

      <div
        className={
          stackActions
            ? "flex flex-col gap-2"
            : "flex flex-wrap shrink-0 gap-2"
        }
      >
        {documentId ? (
          <Button
            size={stackActions ? "default" : "sm"}
            variant="secondary"
            className={stackActions ? "w-full" : undefined}
            disabled={previewBusy || actionsDisabled}
            onClick={onView}
          >
            <Eye className="mr-1 h-3.5 w-3.5" />
            {previewBusy ? "Opening…" : "View file"}
          </Button>
        ) : null}
        {documentId && onFlagReinspect ? (
          <Button
            size={stackActions ? "default" : "sm"}
            variant="ghost"
            className={stackActions ? "w-full" : undefined}
            disabled={actionsDisabled}
            onClick={onFlagReinspect}
          >
            <Flag className="mr-1 h-3.5 w-3.5" />
            {flagButtonLabel(reinspectStatus)}
          </Button>
        ) : null}
        <div className={stackActions ? "grid grid-cols-2 gap-2" : "contents"}>
          <Button
            size={stackActions ? "default" : "sm"}
            disabled={actionsDisabled}
            onClick={onConfirm}
          >
            {hasNearDupes ? "File anyway" : "Confirm"}
          </Button>
          <Button
            size={stackActions ? "default" : "sm"}
            variant="outline"
            disabled={actionsDisabled}
            onClick={onDecline}
          >
            <X className="mr-1 h-3 w-3" />
            Decline
          </Button>
        </div>
      </div>
    </div>
  );
}
