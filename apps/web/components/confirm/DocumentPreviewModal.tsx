"use client";

import { useEffect } from "react";
import { createPortal } from "react-dom";
import { ExternalLink, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { PreviewState } from "./confirm-utils";

export function DocumentPreviewModal({
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
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = prevOverflow;
      window.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  if (typeof document === "undefined") return null;

  return createPortal(
    <div
      className="fixed inset-0 z-[80] flex flex-col bg-black/85 sm:items-center sm:justify-center sm:bg-black/70 sm:p-6"
      role="dialog"
      aria-modal="true"
      aria-label="Document preview"
      onClick={onClose}
    >
      <div
        className="flex h-dvh w-full flex-col overflow-hidden bg-background sm:h-auto sm:max-h-[92vh] sm:max-w-3xl sm:rounded-xl sm:border sm:border-border sm:shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between gap-2 border-b border-border px-3 py-2.5 pt-[max(0.625rem,env(safe-area-inset-top))]">
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
              className="mx-auto max-h-[calc(100dvh-3.5rem)] w-auto max-w-full object-contain sm:max-h-[80vh]"
            />
          ) : isPdf ? (
            <iframe
              title={preview.filename}
              src={preview.url}
              className="h-[calc(100dvh-3.5rem)] w-full border-0 bg-white sm:h-[80vh]"
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
