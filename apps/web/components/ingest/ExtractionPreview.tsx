"use client";

import { useState } from "react";
import { ChevronDown, ChevronRight, Code2 } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";

interface ExtractionPreviewProps {
  filename: string;
  structured?: Record<string, unknown> | string;
  rawJson?: string;
}

export function ExtractionPreview({ filename, structured, rawJson }: ExtractionPreviewProps) {
  const [expanded, setExpanded] = useState(false);

  const display =
    typeof structured === "string"
      ? structured
      : structured
        ? JSON.stringify(structured, null, 2)
        : rawJson ?? "{}";

  return (
    <Card>
      <CardHeader
        className="cursor-pointer"
        onClick={() => setExpanded((v) => !v)}
      >
        <CardTitle className="flex items-center justify-between text-base">
          <span className="flex items-center gap-2">
            <Code2 className="h-4 w-4 text-teal-400" />
            Extraction: {filename}
          </span>
          {expanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
        </CardTitle>
      </CardHeader>
      {expanded && (
        <CardContent>
          <pre
            className={cn(
              "max-h-96 overflow-auto rounded-lg border border-border bg-zinc-950 p-4 text-xs text-teal-100/90",
            )}
          >
            {display}
          </pre>
        </CardContent>
      )}
    </Card>
  );
}
