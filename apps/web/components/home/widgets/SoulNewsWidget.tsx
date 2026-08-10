"use client";

import { useCallback, useEffect, useState } from "react";
import { Newspaper, RefreshCw } from "lucide-react";
import { apiGet } from "@/lib/api-client";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";

type SoulNewsItem = {
  id: string;
  kind: string;
  title: string;
  body: string;
  tags: string[];
  sources: string[];
};

type SoulNewsFeed = {
  ok: boolean;
  generatedAt: string | null;
  nextRefreshAt: string | null;
  items: SoulNewsItem[];
  error?: string;
};

function formatFeedTime(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString("de-CH", {
    weekday: "short",
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function SoulNewsWidget() {
  const [feed, setFeed] = useState<SoulNewsFeed | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async (mode: "initial" | "refresh" = "initial") => {
    if (mode === "refresh") setRefreshing(true);
    else setLoading(true);
    try {
      const data = await apiGet<SoulNewsFeed>("/integrations/soul-news/feed", { silent: true });
      setFeed(data);
    } catch {
      setFeed({
        ok: false,
        generatedAt: null,
        nextRefreshAt: null,
        items: [],
        error: "Soul News is offline",
      });
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void load("initial");
  }, [load]);

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <time className="text-xs text-muted-foreground tabular-nums" dateTime={feed?.generatedAt ?? undefined}>
          {loading ? "Loading…" : formatFeedTime(feed?.generatedAt ?? null)}
        </time>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={loading || refreshing}
          onClick={() => void load("refresh")}
        >
          <RefreshCw className={`mr-1.5 h-3.5 w-3.5 ${refreshing ? "animate-spin" : ""}`} />
          Refresh
        </Button>
      </div>

      <div className="flex items-baseline justify-between gap-2">
        <h2 className="font-display text-lg tracking-tight">Soul News</h2>
        {feed?.nextRefreshAt ? (
          <p className="text-[11px] text-muted-foreground/80 tabular-nums">
            Next {formatFeedTime(feed.nextRefreshAt)}
          </p>
        ) : null}
      </div>

      {loading ? (
        <div className="space-y-2">
          <Skeleton className="h-24 w-full rounded-2xl" />
          <Skeleton className="h-24 w-full rounded-2xl" />
        </div>
      ) : !feed?.ok || feed.items.length === 0 ? (
        <div className="flex items-start gap-3 rounded-2xl border border-border/70 bg-card px-4 py-3.5">
          <Newspaper className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
          <div>
            <p className="text-sm font-medium">
              {feed?.ok === false ? "Soul News unavailable" : "No cards yet"}
            </p>
            <p className="text-xs text-muted-foreground">
              {feed?.error ??
                "When the Soul News service is running, reflective sky & weather cards appear here."}
            </p>
          </div>
        </div>
      ) : (
        <ul className="space-y-2.5">
          {feed.items.map((item) => (
            <li
              key={item.id}
              className="rounded-2xl border border-border/70 bg-card px-4 py-3.5 shadow-elev-1"
            >
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-[11px] font-medium uppercase tracking-[0.08em] text-muted-foreground">
                  {item.kind}
                </span>
                {item.tags.slice(0, 3).map((tag) => (
                  <span
                    key={`${item.id}-${tag}`}
                    className="rounded-full border border-border/60 px-2 py-0.5 text-[10px] text-muted-foreground"
                  >
                    {tag}
                  </span>
                ))}
              </div>
              <p className="mt-1.5 text-sm font-medium leading-snug">{item.title}</p>
              {item.body ? (
                <p className="mt-1.5 whitespace-pre-wrap text-sm leading-relaxed text-muted-foreground">
                  {item.body}
                </p>
              ) : null}
              {item.sources.length > 0 ? (
                <p className="mt-2 text-[11px] text-muted-foreground/80">
                  Sources · {item.sources.slice(0, 4).join(" · ")}
                </p>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
