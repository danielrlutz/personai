"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Brain } from "lucide-react";
import { apiGet, type MemoryFact } from "@/lib/api-client";
import { Button } from "@/components/ui/button";

export function MemoryFactsWidget() {
  const [facts, setFacts] = useState<MemoryFact[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void apiGet<{ facts: MemoryFact[] }>("/memory-facts", { silent: true })
      .then((d) => setFacts((d.facts ?? []).slice(0, 6)))
      .catch((err) => setError(err instanceof Error ? err.message : "Could not load memory"));
  }, []);

  if (error) {
    return <p className="text-sm text-destructive">{error}</p>;
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <h2 className="font-display text-lg tracking-tight">Memory</h2>
        <Button variant="ghost" size="sm" asChild>
          <Link href="/settings/">Manage</Link>
        </Button>
      </div>
      {facts.length === 0 ? (
        <div className="flex items-start gap-3 rounded-2xl border border-border/70 bg-card px-4 py-3.5">
          <Brain className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
          <div>
            <p className="text-sm font-medium">No facts stored</p>
            <p className="text-xs text-muted-foreground">
              Add facts in Settings, or distill from chats (confirm-gated).
            </p>
          </div>
        </div>
      ) : (
        <ul className="flex flex-wrap gap-2">
          {facts.map((f) => (
            <li
              key={f.id ?? f.key}
              className="max-w-full rounded-full border border-border/70 bg-card px-3 py-1.5 text-xs"
              title={f.value}
            >
              <span className="font-medium">{f.key}</span>
              <span className="text-muted-foreground"> · </span>
              <span className="text-muted-foreground">{f.value.slice(0, 48)}</span>
              {f.value.length > 48 ? "…" : ""}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
