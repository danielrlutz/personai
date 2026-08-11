"use client";

import { useCallback, useEffect, useState } from "react";
import { ChevronDown, Newspaper, RefreshCw, Sparkles } from "lucide-react";
import { apiGet, apiPost } from "@/lib/api-client";
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

type SoulNewsBriefSection = {
  id: string;
  title: string;
  body: string;
};

type SoulNewsBrief = {
  ok: boolean;
  profile: string;
  fromCache: boolean;
  generatedAt: string | null;
  meta: {
    cachedAt: string | null;
    model: string | null;
    stale: boolean;
    ollamaAvailable: boolean;
  };
  brief: {
    headline: string;
    lede: string;
    sections: SoulNewsBriefSection[];
    watchlist: string[];
    actions: string[];
  } | null;
  error?: string;
};

type ViewMode = "both" | "brief" | "raw";

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
  const [brief, setBrief] = useState<SoulNewsBrief | null>(null);
  const [viewMode, setViewMode] = useState<ViewMode>("both");
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [sectionsOpen, setSectionsOpen] = useState(true);

  const load = useCallback(async (mode: "initial" | "refresh" = "initial") => {
    if (mode === "refresh") setRefreshing(true);
    else setLoading(true);
    try {
      const [feedData, briefData] = await Promise.all([
        apiGet<SoulNewsFeed>("/integrations/soul-news/feed", { silent: true }),
        mode === "refresh"
          ? apiPost<SoulNewsBrief>("/integrations/soul-news/brief/refresh", {}, { silent: true })
          : apiGet<SoulNewsBrief>("/integrations/soul-news/brief", { silent: true }),
      ]);
      setFeed(feedData);
      setBrief(briefData);
    } catch {
      setFeed({
        ok: false,
        generatedAt: null,
        nextRefreshAt: null,
        items: [],
        error: "Soul News is offline",
      });
      setBrief({
        ok: false,
        profile: "default",
        fromCache: false,
        generatedAt: null,
        meta: { cachedAt: null, model: null, stale: true, ollamaAvailable: false },
        brief: null,
        error: "Brief unavailable",
      });
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void load("initial");
  }, [load]);

  const showBrief = viewMode === "both" || viewMode === "brief";
  const showRaw = viewMode === "both" || viewMode === "raw";

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

      <div className="flex flex-wrap gap-1.5" role="tablist" aria-label="Soul News view">
        {(["both", "brief", "raw"] as const).map((mode) => (
          <button
            key={mode}
            type="button"
            role="tab"
            aria-selected={viewMode === mode}
            className={`rounded-full border px-2.5 py-0.5 text-[11px] transition-colors ${
              viewMode === mode
                ? "border-primary/40 bg-primary/10 text-foreground"
                : "border-border/60 text-muted-foreground hover:text-foreground"
            }`}
            onClick={() => setViewMode(mode)}
          >
            {mode === "both" ? "Both" : mode === "brief" ? "Your Brief" : "Raw data"}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="space-y-2">
          <Skeleton className="h-32 w-full rounded-2xl" />
          <Skeleton className="h-24 w-full rounded-2xl" />
        </div>
      ) : (
        <>
          {showBrief ? (
            <section className="rounded-2xl border border-primary/20 bg-gradient-to-br from-primary/5 via-card to-card px-4 py-3.5 shadow-elev-1">
              <div className="flex items-center gap-2 text-[11px] font-medium uppercase tracking-[0.1em] text-primary">
                <Sparkles className="h-3.5 w-3.5" />
                Your Brief
                {brief?.fromCache ? (
                  <span className="normal-case tracking-normal text-muted-foreground">· cached</span>
                ) : null}
              </div>

              {!brief?.ok || !brief.brief ? (
                <div className="mt-2">
                  <p className="text-sm font-medium">Brief quiet for now</p>
                  <p className="text-xs text-muted-foreground">
                    {brief?.error ??
                      "When Soul News and Ollama are online, a personalized sky-and-desk narrative lands here."}
                  </p>
                </div>
              ) : (
                <>
                  <h3 className="mt-2 font-display text-base leading-snug tracking-tight">
                    {brief.brief.headline}
                  </h3>
                  <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{brief.brief.lede}</p>

                  {brief.brief.sections.length > 0 ? (
                    <div className="mt-3">
                      <button
                        type="button"
                        className="flex w-full items-center justify-between text-left text-xs font-medium text-muted-foreground"
                        onClick={() => setSectionsOpen((o) => !o)}
                      >
                        Sections
                        <ChevronDown className={`h-4 w-4 transition-transform ${sectionsOpen ? "rotate-180" : ""}`} />
                      </button>
                      {sectionsOpen ? (
                        <div className="mt-2 space-y-2.5 border-t border-border/50 pt-2">
                          {brief.brief.sections.map((sec) => (
                            <article key={sec.id}>
                              <p className="text-sm font-medium">{sec.title}</p>
                              <p className="mt-0.5 text-sm leading-relaxed text-muted-foreground">{sec.body}</p>
                            </article>
                          ))}
                        </div>
                      ) : null}
                    </div>
                  ) : null}

                  {(brief.brief.watchlist.length > 0 || brief.brief.actions.length > 0) && (
                    <div className="mt-3 space-y-1.5 border-t border-border/50 pt-2 text-xs text-muted-foreground">
                      {brief.brief.watchlist.map((w) => (
                        <p key={w}>Watch · {w}</p>
                      ))}
                      {brief.brief.actions.map((a) => (
                        <p key={a} className="text-foreground/80">
                          → {a}
                        </p>
                      ))}
                    </div>
                  )}

                  <p className="mt-2 text-[10px] text-muted-foreground/70">
                    {brief.meta.model ? `Model ${brief.meta.model}` : "Template fallback"}
                    {brief.meta.cachedAt ? ` · ${formatFeedTime(brief.meta.cachedAt)}` : null}
                  </p>
                </>
              )}
            </section>
          ) : null}

          {showRaw ? (
            !feed?.ok || feed.items.length === 0 ? (
              <div className="flex items-start gap-3 rounded-2xl border border-border/70 bg-card px-4 py-3.5">
                <Newspaper className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                <div>
                  <p className="text-sm font-medium">
                    {feed?.ok === false ? "Soul News quiet for now" : "No cards yet"}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {feed?.error ??
                      "Optional atmosphere — when the feed is online, reflective cards land here without crowding the desk."}
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
            )
          ) : null}
        </>
      )}
    </div>
  );
}
