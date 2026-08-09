"use client";

import { useCallback, useEffect, useState } from "react";
import { Upload, FileText } from "lucide-react";
import { getOutbox, type OutboxEvent } from "@/lib/outbox";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

interface FileDropzoneProps {
  onUploaded?: () => void;
}

export function FileDropzone({ onUploaded }: FileDropzoneProps) {
  const [dragging, setDragging] = useState(false);
  const [queued, setQueued] = useState(0);

  useEffect(() => {
    return getOutbox().subscribe((event: OutboxEvent) => {
      if (event.kind === "ingest-upload-done") {
        onUploaded?.();
      }
      if (event.kind === "changed") {
        setQueued(event.ops.filter((op) => op.type === "ingest-upload").length);
      }
    });
  }, [onUploaded]);

  const enqueueFiles = useCallback(async (files: FileList | File[]) => {
    const list = Array.from(files);
    if (!list.length) return;
    for (const file of list) {
      await getOutbox().enqueueUpload(file);
    }
  }, []);

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragging(false);
    if (e.dataTransfer.files.length) void enqueueFiles(e.dataTransfer.files);
  };

  return (
    <div
      onDragOver={(e) => {
        e.preventDefault();
        setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={onDrop}
      className={cn(
        "surface-card relative flex min-w-0 flex-col items-center justify-center border-2 border-dashed p-6 text-center transition-colors duration-md ease-md sm:p-12",
        dragging ? "border-primary bg-primary-container/40" : "border-border hover:border-primary/50",
      )}
    >
      <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-primary-container">
        {queued > 0 ? (
          <div className="h-7 w-7 animate-spin rounded-full border-2 border-primary border-t-transparent" />
        ) : (
          <Upload className="h-7 w-7 text-primary-on-container" />
        )}
      </div>
      <h3 className="md-title-medium">Drop files to ingest</h3>
      <p className="mt-1 md-body-medium text-muted-foreground">
        PDF, images, receipts, medical records
      </p>
      <p className="mt-2 max-w-sm text-xs text-muted-foreground">
        Files are cached on this device first — if the network fails, Retry from Pending below.
      </p>
      <label className="mt-6 cursor-pointer">
        <Button asChild variant="default">
          <span>
            <FileText className="h-4 w-4" />
            Browse files
          </span>
        </Button>
        <input
          type="file"
          multiple
          className="hidden"
          onChange={(e) => e.target.files && void enqueueFiles(e.target.files)}
        />
      </label>
    </div>
  );
}
