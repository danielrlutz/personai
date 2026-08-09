"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Cpu } from "lucide-react";
import { apiGet, type OllamaHealth } from "@/lib/api-client";
import { requireSession } from "@/lib/session";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

export function OllamaStatusWidget() {
  const [health, setHealth] = useState<OllamaHealth | null>(null);

  useEffect(() => {
    let mounted = true;
    const poll = async () => {
      if (!requireSession()) {
        if (mounted) setHealth(null);
        return;
      }
      try {
        const data = await apiGet<OllamaHealth>("/ollama/health", { silent: true });
        if (mounted) setHealth(data);
      } catch {
        if (mounted) setHealth({ ok: false });
      }
    };
    void poll();
    const interval = setInterval(poll, 15000);
    return () => {
      mounted = false;
      clearInterval(interval);
    };
  }, []);

  const ok = Boolean(health?.ok);
  const hostShort = health?.host?.replace(/^https?:\/\//, "") ?? null;

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <h2 className="font-display text-lg tracking-tight">Brains</h2>
        <Button variant="ghost" size="sm" asChild>
          <Link href="/settings/">Settings</Link>
        </Button>
      </div>
      <div className="flex items-start gap-3 rounded-2xl border border-border/70 bg-card px-4 py-3.5">
        <Cpu className={`mt-0.5 h-4 w-4 shrink-0 ${ok ? "text-primary" : "text-destructive"}`} />
        <div className="min-w-0 space-y-1.5">
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-sm font-medium">{ok ? "Ollama reachable" : "Ollama offline"}</p>
            {health?.runtime ? <Badge variant="outline">{health.runtime}</Badge> : null}
            {health?.vram?.holder ? <Badge variant="outline">Model busy</Badge> : null}
          </div>
          {hostShort ? (
            <p className="truncate font-mono text-xs text-muted-foreground">{hostShort}</p>
          ) : (
            <p className="text-xs text-muted-foreground">
              Configure host in Settings when the API cannot reach a local model.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
