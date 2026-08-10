"use client";

import { Eye } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { DocCitation } from "@/lib/chat-citations";

interface CitationChipsProps {
  citations: DocCitation[];
  busyId?: string | null;
  onOpen: (citation: DocCitation) => void;
}

export function CitationChips({ citations, busyId, onOpen }: CitationChipsProps) {
  if (citations.length === 0) return null;
  return (
    <div className="mt-2.5 flex flex-wrap gap-1.5" aria-label="Cited documents">
      {citations.map((c) => (
        <Button
          key={c.id}
          type="button"
          size="sm"
          variant="secondary"
          className="h-7 max-w-full gap-1 px-2 text-xs font-normal"
          disabled={busyId === c.id}
          title={`View file · ${c.label}`}
          onClick={() => onOpen(c)}
        >
          <Eye className="h-3 w-3 shrink-0 opacity-70" />
          <span className="truncate">{busyId === c.id ? "Opening…" : c.label}</span>
        </Button>
      ))}
    </div>
  );
}
