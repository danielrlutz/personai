"use client";

import { useCallback, useState } from "react";
import { Upload, FileText } from "lucide-react";
import { apiUpload } from "@/lib/api-client";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

interface FileDropzoneProps {
  onUploaded?: () => void;
}

export function FileDropzone({ onUploaded }: FileDropzoneProps) {
  const [dragging, setDragging] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const uploadFiles = useCallback(
    async (files: FileList | File[]) => {
      setUploading(true);
      setError(null);
      try {
        for (const file of Array.from(files)) {
          const form = new FormData();
          form.append("file", file);
          await apiUpload("/ingest/upload", form);
        }
        onUploaded?.();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Upload failed");
      } finally {
        setUploading(false);
      }
    },
    [onUploaded],
  );

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragging(false);
    if (e.dataTransfer.files.length) void uploadFiles(e.dataTransfer.files);
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
        "surface-card relative flex flex-col items-center justify-center border-2 border-dashed p-6 text-center transition-colors duration-md ease-md sm:p-12",
        dragging ? "border-primary bg-primary-container/40" : "border-border hover:border-primary/50",
        uploading && "pointer-events-none opacity-60",
      )}
    >
      <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-primary-container">
        {uploading ? (
          <div className="h-7 w-7 animate-spin rounded-full border-2 border-primary border-t-transparent" />
        ) : (
          <Upload className="h-7 w-7 text-primary-on-container" />
        )}
      </div>
      <h3 className="md-title-medium">Drop files to ingest</h3>
      <p className="mt-1 md-body-medium text-muted-foreground">PDF, images, receipts, medical records</p>
      <label className="mt-6 cursor-pointer">
        <Button asChild variant="default" disabled={uploading}>
          <span>
            <FileText className="h-4 w-4" />
            Browse files
          </span>
        </Button>
        <input
          type="file"
          multiple
          className="hidden"
          onChange={(e) => e.target.files && void uploadFiles(e.target.files)}
        />
      </label>
      {error && <p className="mt-4 text-sm text-destructive">{error}</p>}
    </div>
  );
}
