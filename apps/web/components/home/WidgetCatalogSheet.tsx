"use client";

import { Plus, Minus, LayoutGrid } from "lucide-react";
import {
  WIDGET_CATALOG,
  type HomeLayout,
  type HomeWidgetId,
  type WidgetCatalogEntry,
} from "@/lib/home-layout";
import type { UsageMode } from "@/lib/usage-mode";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

interface WidgetCatalogSheetProps {
  open: boolean;
  onClose: () => void;
  layout: HomeLayout;
  usageMode: UsageMode;
  onAdd: (id: HomeWidgetId) => void;
  onRemove: (id: HomeWidgetId) => void;
}

function CatalogCard({
  entry,
  active,
  onAdd,
  onRemove,
}: {
  entry: WidgetCatalogEntry;
  active: boolean;
  onAdd: () => void;
  onRemove: () => void;
}) {
  return (
    <li className="flex flex-col rounded-2xl border border-border/70 bg-card p-4 shadow-elev-1">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="font-display text-base tracking-tight">{entry.title}</p>
          <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{entry.description}</p>
        </div>
        {active ? <Badge variant="secondary">On Home</Badge> : null}
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        {active ? (
          <Button type="button" size="sm" variant="outline" onClick={onRemove}>
            <Minus className="mr-1.5 h-3.5 w-3.5" />
            Remove
          </Button>
        ) : (
          <Button type="button" size="sm" onClick={onAdd}>
            <Plus className="mr-1.5 h-3.5 w-3.5" />
            Add
          </Button>
        )}
      </div>
    </li>
  );
}

export function WidgetCatalogSheet({
  open,
  onClose,
  layout,
  usageMode,
  onAdd,
  onRemove,
}: WidgetCatalogSheetProps) {
  if (!open) return null;

  const activeIds = new Set(layout.widgets.map((w) => w.id));
  const available = WIDGET_CATALOG.filter((e) => e.availableFor(usageMode));
  const unavailableActive = WIDGET_CATALOG.filter(
    (e) => !e.availableFor(usageMode) && activeIds.has(e.id),
  );

  return (
    <>
      <div
        className="fixed inset-0 z-50 bg-black/55 backdrop-blur-[2px]"
        onClick={onClose}
        aria-hidden
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="widget-catalog-title"
        className={cn(
          "fixed inset-x-0 bottom-0 z-50 flex max-h-[min(88dvh,40rem)] flex-col",
          "rounded-t-3xl border border-border/70 bg-background shadow-elev-3",
          "sm:inset-x-auto sm:left-1/2 sm:top-[max(1rem,8%)] sm:bottom-auto sm:w-[calc(100%-2rem)] sm:max-w-2xl sm:-translate-x-1/2 sm:rounded-3xl",
          "animate-scale-in",
        )}
      >
        <div className="flex shrink-0 items-start justify-between gap-3 border-b border-border/60 px-5 py-4">
          <div className="min-w-0">
            <p className="flex items-center gap-2 text-xs font-medium uppercase tracking-[0.1em] text-muted-foreground">
              <LayoutGrid className="h-3.5 w-3.5" />
              Widget catalog
            </p>
            <h2 id="widget-catalog-title" className="mt-1 font-display text-2xl tracking-tight">
              Customize Home
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Browse widgets, add or remove them, then reorder on the desk.
            </p>
          </div>
          <Button type="button" variant="outline" size="sm" onClick={onClose}>
            Done
          </Button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
          {available.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-border/80 px-4 py-10 text-center">
              <p className="text-sm font-medium">Catalog empty for this usage mode</p>
              <p className="mt-1 text-xs text-muted-foreground">
                Switch Personal / Business / Both in Settings to see more widgets.
              </p>
            </div>
          ) : (
            <ul className="grid gap-3 sm:grid-cols-2">
              {available.map((entry) => (
                <CatalogCard
                  key={entry.id}
                  entry={entry}
                  active={activeIds.has(entry.id)}
                  onAdd={() => onAdd(entry.id)}
                  onRemove={() => onRemove(entry.id)}
                />
              ))}
            </ul>
          )}

          {unavailableActive.length > 0 ? (
            <div className="mt-6 space-y-2">
              <p className="text-xs font-semibold uppercase tracking-[0.06em] text-foreground/65">
                On Home but off for this mode
              </p>
              <ul className="grid gap-3 sm:grid-cols-2">
                {unavailableActive.map((entry) => (
                  <CatalogCard
                    key={entry.id}
                    entry={entry}
                    active
                    onAdd={() => onAdd(entry.id)}
                    onRemove={() => onRemove(entry.id)}
                  />
                ))}
              </ul>
            </div>
          ) : null}
        </div>
      </div>
    </>
  );
}
