"use client";

import { useEffect, useState } from "react";
import { Cpu, Loader2 } from "lucide-react";
import { apiGet, type OllamaHealth } from "@/lib/api-client";
import { requireSession } from "@/lib/session";
import { cn } from "@/lib/utils";

function statusLabel(health: OllamaHealth | null): string {
  if (!health?.ok) return "Ollama offline";
  if (health.vram?.holder) return "Model busy";
  if (health.failoverOk) return "Backup ready";
  if (health.runtime === "native") return "Ollama ready";
  if (health.runtime === "docker") return "Ollama (Docker)";
  if (health.runtime === "remote") return "Ollama (remote)";
  return "Ollama ready";
}

export function OllamaStatusIndicator({
  className,
  compact = false,
}: {
  className?: string;
  /** Icon + status only — for collapsed nav rail. */
  compact?: boolean;
}) {
  const [health, setHealth] = useState<OllamaHealth | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let mounted = true;
    const poll = async () => {
      // Avoid 401 spam / false "Ollama offline" when the session gate is empty.
      if (!requireSession()) {
        if (mounted) {
          setHealth(null);
          setLoading(false);
        }
        return;
      }
      try {
        const data = await apiGet<OllamaHealth>("/ollama/health", { silent: true });
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
      <div
        className={cn(
          "flex min-w-0 items-center gap-2 text-xs text-muted-foreground",
          compact && "justify-center",
          className,
        )}
        title="Checking Ollama…"
      >
        <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin" />
        {!compact ? <span className="min-w-0 truncate">Ollama</span> : null}
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

  if (compact) {
    return (
      <div className={cn("flex items-center justify-center gap-1.5", className)} title={title}>
        <Cpu className={cn("h-3.5 w-3.5 shrink-0", ok ? "text-primary" : "text-destructive")} />
        <span
          className={cn(
            "h-1.5 w-1.5 shrink-0 rounded-full",
            ok ? (locked ? "bg-warning" : "bg-success") : "bg-destructive",
          )}
        />
      </div>
    );
  }

  return (
    <div className={cn("flex min-w-0 flex-col gap-0.5 text-xs", className)} title={title}>
      <div className="flex min-w-0 items-center gap-2">
        <Cpu className={cn("h-3.5 w-3.5 shrink-0", ok ? "text-primary" : "text-destructive")} />
        <span
          className={cn(
            "min-w-0 flex-1 truncate font-medium",
            ok ? "text-muted-foreground" : "text-destructive",
          )}
        >
          {label}
        </span>
        <span
          className={cn(
            "h-1.5 w-1.5 shrink-0 rounded-full",
            ok ? (locked ? "bg-warning" : "bg-success") : "bg-destructive",
          )}
        />
      </div>
      {ok && hostShort ? (
        <span className="truncate pl-[1.375rem] font-mono text-[10px] leading-tight text-muted-foreground/90">
          {hostShort}
        </span>
      ) : null}
    </div>
  );
}
