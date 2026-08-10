"use client";

import { useEffect } from "react";
import { createPortal } from "react-dom";
import { ExternalLink, X } from "lucide-react";
import { Button } from "@/components/ui/button";

export type DocumentPreviewState = {
  url: string;
  contentType: string;
  filename: string;
  documentId: string;
};

export function DocumentPreviewModal({
  preview,
  onClose,
}: {
  preview: DocumentPreviewState;
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
            // eslint-disable-next-line @next/next/no-img-element
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
