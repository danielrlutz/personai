"use client";

import { useCallback, useEffect, useState } from "react";
import { ChevronDown, ChevronUp, LayoutGrid, Pencil, RotateCcw, X } from "lucide-react";
import {
  addWidget,
  catalogEntry,
  defaultHomeLayout,
  loadHomeLayout,
  moveWidget,
  persistHomeLayout,
  removeWidget,
  type HomeLayout,
  type HomeWidgetId,
} from "@/lib/home-layout";
import { useUsageMode } from "@/lib/usage-mode";
import { Button } from "@/components/ui/button";
import { PageEnter } from "@/components/motion/PageEnter";
import { WidgetCatalogSheet } from "./WidgetCatalogSheet";
import { renderHomeWidget } from "./widgets";
import { cn } from "@/lib/utils";

export function HomeDashboard() {
  const { usageMode, loading: modeLoading } = useUsageMode();
  const [layout, setLayout] = useState<HomeLayout>(() => defaultHomeLayout("PERSONAL"));
  const [ready, setReady] = useState(false);
  const [editing, setEditing] = useState(false);
  const [catalogOpen, setCatalogOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void loadHomeLayout(usageMode).then((next) => {
      if (!cancelled) {
        setLayout(next);
        setReady(true);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [usageMode]);

  const commit = useCallback(async (next: HomeLayout) => {
    setLayout(next);
    await persistHomeLayout(next);
  }, []);

  const openCustomize = () => {
    setCatalogOpen(true);
    setEditing(true);
  };

  return (
    <PageEnter className="mx-auto w-full max-w-3xl space-y-6 sm:space-y-8">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0">
          <p className="text-xs font-medium uppercase tracking-[0.12em] text-muted-foreground">
            PersonAI
          </p>
          <h1 className="mt-1 font-display text-3xl tracking-tight text-foreground sm:text-4xl">
            Morning desk
          </h1>
          <p className="mt-1.5 max-w-md text-sm text-muted-foreground">
            Triage, confirms, Fristen, and the rest of your day — arranged how you like.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            variant={editing ? "default" : "outline"}
            size="sm"
            onClick={() => setEditing((v) => !v)}
          >
            <Pencil className="mr-1.5 h-4 w-4" />
            {editing ? "Done editing" : "Edit layout"}
          </Button>
          <Button type="button" size="sm" onClick={openCustomize}>
            <LayoutGrid className="mr-1.5 h-4 w-4" />
            Customize Home
          </Button>
        </div>
      </header>

      {editing ? (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-border/70 bg-surface-container/60 px-3.5 py-2.5 text-sm">
          <p className="text-muted-foreground">
            Drag-free reorder: use arrows. Add widgets from the catalog.
          </p>
          <div className="flex flex-wrap gap-2">
            <Button type="button" size="sm" variant="outline" onClick={() => setCatalogOpen(true)}>
              Open catalog
            </Button>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={() => void commit(defaultHomeLayout(usageMode))}
            >
              <RotateCcw className="mr-1.5 h-3.5 w-3.5" />
              Reset defaults
            </Button>
          </div>
        </div>
      ) : null}

      {!ready || modeLoading ? (
        <p className="text-sm text-muted-foreground">Loading your desk…</p>
      ) : layout.widgets.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-border/80 px-5 py-12 text-center">
          <p className="font-display text-xl tracking-tight">Home is empty</p>
          <p className="mt-2 text-sm text-muted-foreground">
            Nothing on the desk yet — open the catalog and add real widgets (no placeholders).
          </p>
          <Button type="button" className="mt-4" onClick={openCustomize}>
            Browse widget catalog
          </Button>
        </div>
      ) : (
        <div className="space-y-7 sm:space-y-8">
          {layout.widgets.map((placement, index) => {
            const meta = catalogEntry(placement.id);
            return (
              <section
                key={placement.id}
                className={cn(
                  "relative",
                  editing && "rounded-2xl border border-dashed border-border/80 p-3 sm:p-4",
                )}
              >
                {editing ? (
                  <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                    <p className="text-xs font-semibold uppercase tracking-[0.06em] text-foreground/70">
                      {meta?.title ?? placement.id}
                    </p>
                    <div className="flex items-center gap-1">
                      <Button
                        type="button"
                        size="icon"
                        variant="ghost"
                        className="h-8 w-8"
                        disabled={index === 0}
                        aria-label="Move up"
                        onClick={() => void commit(moveWidget(layout, placement.id, "up"))}
                      >
                        <ChevronUp className="h-4 w-4" />
                      </Button>
                      <Button
                        type="button"
                        size="icon"
                        variant="ghost"
                        className="h-8 w-8"
                        disabled={index === layout.widgets.length - 1}
                        aria-label="Move down"
                        onClick={() => void commit(moveWidget(layout, placement.id, "down"))}
                      >
                        <ChevronDown className="h-4 w-4" />
                      </Button>
                      <Button
                        type="button"
                        size="icon"
                        variant="ghost"
                        className="h-8 w-8 text-muted-foreground"
                        aria-label="Remove widget"
                        onClick={() => void commit(removeWidget(layout, placement.id))}
                      >
                        <X className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                ) : null}
                {renderHomeWidget(placement.id)}
              </section>
            );
          })}
        </div>
      )}

      <WidgetCatalogSheet
        open={catalogOpen}
        onClose={() => setCatalogOpen(false)}
        layout={layout}
        usageMode={usageMode}
        onAdd={(id: HomeWidgetId) => void commit(addWidget(layout, id))}
        onRemove={(id: HomeWidgetId) => void commit(removeWidget(layout, id))}
      />
    </PageEnter>
  );
}
