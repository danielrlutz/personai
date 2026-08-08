"use client";

import { useCallback, useState } from "react";
import { Upload, FileText } from "lucide-react";
import { apiUpload } from "@/lib/api-client";
import { cn } from "@/lib/utils";

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
        "relative flex flex-col items-center justify-center rounded-xl border-2 border-dashed p-12 transition-colors",
        dragging ? "border-teal-400 bg-teal-500/10" : "border-border bg-muted/10 hover:border-teal-500/40",
        uploading && "pointer-events-none opacity-60",
      )}
    >
      <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-teal-500/15">
        {uploading ? (
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-teal-400 border-t-transparent" />
        ) : (
          <Upload className="h-8 w-8 text-teal-400" />
        )}
      </div>
      <h3 className="text-lg font-medium">Drop files to ingest</h3>
      <p className="mt-1 text-sm text-muted-foreground">PDF, images, receipts, medical records</p>
      <label className="mt-6 cursor-pointer">
        <span className="inline-flex items-center gap-2 rounded-md bg-teal-500 px-4 py-2 text-sm font-medium text-white hover:bg-teal-400">
          <FileText className="h-4 w-4" />
          Browse files
        </span>
        <input
          type="file"
          multiple
          className="hidden"
          onChange={(e) => e.target.files && void uploadFiles(e.target.files)}
        />
      </label>
      {error && <p className="mt-4 text-sm text-red-400">{error}</p>}
    </div>
  );
}
