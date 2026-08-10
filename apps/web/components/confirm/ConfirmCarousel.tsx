"use client";

import { useEffect } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { ChevronLeft, ChevronRight } from "lucide-react";
import type { PendingConfirmation } from "@/lib/api-client";
import type { ArchiveDraft } from "@/lib/archive-naming";
import { easeHospitality } from "@/lib/motion";
import { Button } from "@/components/ui/button";
import { ConfirmItemCard } from "./ConfirmItemCard";

export interface ConfirmCarouselProps {
  items: PendingConfirmation[];
  drafts: Record<string, ArchiveDraft>;
  index: number;
  onIndexChange: (index: number) => void;
  busyId: string | null;
  previewBusyId: string | null;
  applyEntityToRemaining: boolean;
  onApplyEntityChange: (value: boolean) => void;
  onDraftChange: (id: string, draft: ArchiveDraft) => void;
  onSaveDraft: (id: string) => void;
  onView: (c: PendingConfirmation) => void;
  onOpenExisting?: (confirmationId: string, documentId: string, archiveName?: string) => void;
  onConfirm: (id: string) => void;
  onDecline: (id: string) => void;
}

export function ConfirmCarousel({
  items,
  drafts,
  index,
  onIndexChange,
  busyId,
  previewBusyId,
  applyEntityToRemaining,
  onApplyEntityChange,
  onDraftChange,
  onSaveDraft,
  onView,
  onOpenExisting,
  onConfirm,
  onDecline,
}: ConfirmCarouselProps) {
  const reduce = useReducedMotion();
  const safeIndex = Math.min(Math.max(index, 0), Math.max(items.length - 1, 0));
  const current = items[safeIndex];
  const remainingAfter = Math.max(items.length - safeIndex - 1, 0);

  useEffect(() => {
    if (safeIndex !== index) onIndexChange(safeIndex);
  }, [safeIndex, index, onIndexChange]);

  if (!current) return null;

  const go = (delta: number) => {
    const next = Math.min(Math.max(safeIndex + delta, 0), items.length - 1);
    if (next !== safeIndex) onIndexChange(next);
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs font-medium tabular-nums text-muted-foreground">
          {safeIndex + 1} of {items.length}
        </p>
        <div className="flex items-center gap-1">
          <Button
            size="icon"
            variant="ghost"
            className="h-8 w-8"
            disabled={safeIndex <= 0}
            aria-label="Previous confirmation"
            onClick={() => go(-1)}
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <Button
            size="icon"
            variant="ghost"
            className="h-8 w-8"
            disabled={safeIndex >= items.length - 1}
            aria-label="Next confirmation"
            onClick={() => go(1)}
          >
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
      </div>

      <div className="relative overflow-hidden">
        {/* Stack depth cue */}
        {remainingAfter > 0 ? (
          <>
            <div
              aria-hidden
              className="pointer-events-none absolute inset-x-3 top-2 h-full rounded-xl border border-border/40 bg-surface-container/40"
            />
            {remainingAfter > 1 ? (
              <div
                aria-hidden
                className="pointer-events-none absolute inset-x-5 top-4 h-full rounded-xl border border-border/30 bg-surface-container/30"
              />
            ) : null}
          </>
        ) : null}

        <AnimatePresence mode="wait" initial={false}>
          <motion.div
            key={current.id}
            className="relative touch-pan-y rounded-xl border border-border/80 bg-surface-container/60 px-3 py-3"
            drag={reduce ? false : "x"}
            dragConstraints={{ left: 0, right: 0 }}
            dragElastic={0.18}
            onDragEnd={(_, info) => {
              if (info.offset.x < -72 || info.velocity.x < -500) go(1);
              else if (info.offset.x > 72 || info.velocity.x > 500) go(-1);
            }}
            initial={reduce ? { opacity: 0 } : { opacity: 0, x: 28 }}
            animate={{ opacity: 1, x: 0 }}
            exit={reduce ? { opacity: 0 } : { opacity: 0, x: -28 }}
            transition={{ duration: 0.28, ease: easeHospitality }}
          >
            <ConfirmItemCard
              confirmation={current}
              draft={drafts[current.id] ?? null}
              busy={busyId === current.id}
              previewBusy={previewBusyId === current.id}
              remainingCount={remainingAfter}
              applyEntityToRemaining={applyEntityToRemaining}
              onApplyEntityChange={onApplyEntityChange}
              onDraftChange={(d) => onDraftChange(current.id, d)}
              onSaveDraft={() => onSaveDraft(current.id)}
              onView={() => onView(current)}
              onOpenExisting={(documentId, archiveName) =>
                onOpenExisting?.(current.id, documentId, archiveName)
              }
              onConfirm={() => onConfirm(current.id)}
              onDecline={() => onDecline(current.id)}
              stackActions
            />
            {items.length > 1 ? (
              <p className="mt-3 text-center text-[11px] text-muted-foreground">
                Swipe to browse · Confirm or Decline advances the stack
              </p>
            ) : null}
          </motion.div>
        </AnimatePresence>
      </div>
    </div>
  );
}
