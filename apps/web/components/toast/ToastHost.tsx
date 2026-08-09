"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { AlertCircle, AlertTriangle, CheckCircle2, Info, X } from "lucide-react";
import {
  dismissToast,
  subscribeToasts,
  type ToastItem,
  type ToastType,
} from "@/lib/toast";
import { cn } from "@/lib/utils";

const ICONS: Record<ToastType, typeof Info> = {
  error: AlertCircle,
  success: CheckCircle2,
  info: Info,
  warning: AlertTriangle,
};

function ToastCard({ item }: { item: ToastItem }) {
  const Icon = ICONS[item.type];

  useEffect(() => {
    if (item.sticky) return;
    const timer = window.setTimeout(() => dismissToast(item.id), item.durationMs);
    return () => window.clearTimeout(timer);
  }, [item.id, item.sticky, item.durationMs]);

  return (
    <div
      role={item.type === "error" || item.type === "warning" ? "alert" : "status"}
      aria-live={item.type === "error" ? "assertive" : "polite"}
      className={cn(
        "pointer-events-auto flex w-full max-w-md items-start gap-3 rounded-xl border px-3.5 py-3 shadow-elev-3",
        "bg-card/95 text-card-foreground backdrop-blur-md animate-scale-in",
        item.type === "error" && "border-destructive/35",
        item.type === "success" && "border-success/35",
        item.type === "warning" && "border-warning/40",
        item.type === "info" && "border-border/70",
      )}
    >
      <span
        className={cn(
          "mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full",
          item.type === "error" && "bg-destructive/15 text-destructive",
          item.type === "success" && "bg-success/15 text-success",
          item.type === "warning" && "bg-warning/15 text-warning",
          item.type === "info" && "bg-primary-container text-primary-on-container",
        )}
      >
        <Icon className="h-4 w-4" aria-hidden />
      </span>
      <div className="min-w-0 flex-1 pt-0.5">
        {item.title ? (
          <p className="text-sm font-medium leading-snug text-foreground">{item.title}</p>
        ) : null}
        <p
          className={cn(
            "text-sm leading-relaxed text-muted-foreground break-words [overflow-wrap:anywhere]",
            !item.title && "text-foreground",
          )}
        >
          {item.message}
        </p>
      </div>
      <button
        type="button"
        onClick={() => dismissToast(item.id)}
        className="pressable -mr-1 -mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-surface-container-high hover:text-foreground"
        aria-label="Dismiss notification"
      >
        <X className="h-4 w-4" />
      </button>
    </div>
  );
}

/** Portals snackbars to document.body above modals/drawers (`--z-toast`). */
export function ToastHost() {
  const [items, setItems] = useState<ToastItem[]>([]);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
    return subscribeToasts(setItems);
  }, []);

  if (!mounted || typeof document === "undefined") return null;

  return createPortal(
    <div
      className="pointer-events-none fixed inset-x-0 bottom-0 flex flex-col items-center gap-2 px-3 pb-[calc(5.25rem+env(safe-area-inset-bottom))] sm:items-end sm:px-6 sm:pb-6 md:pb-6"
      style={{ zIndex: "var(--z-toast)" }}
      aria-label="Notifications"
    >
      {items.map((item) => (
        <ToastCard key={item.id} item={item} />
      ))}
    </div>,
    document.body,
  );
}
