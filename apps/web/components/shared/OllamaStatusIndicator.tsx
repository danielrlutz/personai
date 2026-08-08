"use client";

import { useEffect, useState } from "react";
import { Cpu, Loader2 } from "lucide-react";
import { apiGet, type OllamaHealth } from "@/lib/api-client";
import { cn } from "@/lib/utils";

function statusLabel(health: OllamaHealth | null): string {
  if (!health?.ok) return "Ollama offline";
  if (health.vram?.holder) return "VRAM busy";
  if (health.failoverOk) return "Failover OK";
  if (health.runtime === "native") return "Native Ollama";
  if (health.runtime === "docker") return "Ollama (Docker)";
  if (health.runtime === "remote") return "Ollama (remote)";
  return "Ollama ready";
}

export function OllamaStatusIndicator({ className }: { className?: string }) {
  const [health, setHealth] = useState<OllamaHealth | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let mounted = true;
    const poll = async () => {
      try {
        const data = await apiGet<OllamaHealth>("/ollama/health");
        if (mounted) setHealth(data);
      } catch {
        if (mounted) setHealth({ ok: false });
      } finally {
        if (mounted) setLoading(false);
      }
    };
    void poll();
    const interval = setInterval(poll, 15000);
    return () => {
      mounted = false;
      clearInterval(interval);
    };
  }, []);

  if (loading) {
    return (
      <div className={cn("flex items-center gap-2 text-xs text-muted-foreground", className)}>
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
        <span>Ollama</span>
      </div>
    );
  }

  const locked = Boolean(health?.vram?.holder);
  const ok = health?.ok;
  const label = statusLabel(health);
  const alternatives = (health?.candidatesUp ?? []).filter((h) => h !== health?.host);
  const hostShort = health?.host?.replace(/^https?:\/\//, "");
  const titleParts = [
    health?.host ? `${label} · ${health.host}` : label,
    health?.apiInDocker ? "API in Docker" : null,
    alternatives.length ? `Alternatives: ${alternatives.join(", ")}` : null,
  ].filter(Boolean);
  const title = titleParts.join(" · ");

  return (
    <div className={cn("flex items-center gap-2 text-xs", className)} title={title}>
      <Cpu className={cn("h-3.5 w-3.5", ok ? "text-primary" : "text-destructive")} />
      <span className={ok ? "text-muted-foreground" : "text-destructive"}>{label}</span>
      {ok && hostShort ? (
        <span className="hidden max-w-[8rem] truncate font-mono text-[10px] text-muted-foreground sm:inline">
          {hostShort}
        </span>
      ) : null}
      <span
        className={cn(
          "h-1.5 w-1.5 rounded-full",
          ok ? (locked ? "bg-warning" : "bg-success") : "bg-destructive",
        )}
      />
    </div>
  );
}
