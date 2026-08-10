"use client";

import { useEffect, useState } from "react";
import { Sparkles } from "lucide-react";
import { apiGet, apiPut } from "@/lib/api-client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

type StagingDoc = {
  id: string;
  filename: string;
  title: string;
  description: string;
  content: string;
  exists: boolean;
  charCount: number;
  injectBudget: number;
  maxChars: number;
  hasSubstance: boolean;
  updatedAt: string | null;
};

type InjectSlice = {
  id: string;
  filename: string;
  charCount: number;
  truncated: boolean;
};

type StagingPayload = {
  docs: StagingDoc[];
  inject: {
    totalBudget: number;
    totalInjected: number;
    slices: InjectSlice[];
  };
};

/** Settings — About you / Personality vault (OpenClaw-style staging markdown). */
export function PersonalityVaultCard() {
  const [data, setData] = useState<StagingPayload | null>(null);
  const [activeId, setActiveId] = useState("USER");
  const [draft, setDraft] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = async (preferId?: string) => {
    setLoading(true);
    setError(null);
    try {
      const payload = await apiGet<StagingPayload>("/staging", { silent: true });
      setData(payload);
      const id = preferId ?? activeId;
      const doc = payload.docs.find((d) => d.id === id) ?? payload.docs[0];
      if (doc) {
        setActiveId(doc.id);
        setDraft(doc.content);
      }
    } catch (err) {
      setData(null);
      setError(err instanceof Error ? err.message : "Could not load personality vault.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- mount load only
  }, []);

  const selectDoc = (id: string) => {
    if (!data) return;
    const doc = data.docs.find((d) => d.id === id);
    if (!doc) return;
    setActiveId(id);
    setDraft(doc.content);
    setNote(null);
  };

  const save = async () => {
    if (!activeId) return;
    setSaving(true);
    setNote(null);
    setError(null);
    try {
      await apiPut(`/staging/${encodeURIComponent(activeId)}`, { content: draft });
      setNote(`Saved ${activeId}.md — Staff sees a budgeted slice when the file has substance.`);
      await load(activeId);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed.");
    } finally {
      setSaving(false);
    }
  };

  const active = data?.docs.find((d) => d.id === activeId);
  const injectSlice = data?.inject.slices.find((s) => s.id === activeId);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Sparkles className="h-4 w-4 text-primary" />
          About you / Personality vault
        </CardTitle>
        <CardDescription>
          Local markdown under this profile&apos;s{" "}
          <code className="text-xs">memory/</code> folder (USER, SOUL, preferences, people, ADHD).
          Specialists and Staff inject budgeted slices — new chat facts still need confirmation.
          Not the Soul News home widget.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {loading ? (
          <p className="text-sm text-muted-foreground">Loading vault…</p>
        ) : error ? (
          <p className="text-sm text-destructive">{error}</p>
        ) : data ? (
          <>
            <div className="flex flex-wrap gap-2">
              {data.docs.map((doc) => (
                <button
                  key={doc.id}
                  type="button"
                  onClick={() => selectDoc(doc.id)}
                  className={cn(
                    "rounded-xl border px-3 py-1.5 text-left text-sm transition-colors",
                    activeId === doc.id
                      ? "border-primary bg-primary/5"
                      : "border-border/70 hover:bg-surface-container-high",
                  )}
                >
                  <span className="font-medium">{doc.id}</span>
                  {doc.hasSubstance ? (
                    <Badge variant="secondary" className="ml-2 text-[10px]">
                      live
                    </Badge>
                  ) : null}
                </button>
              ))}
            </div>

            {active ? (
              <div className="space-y-2">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <div>
                    <p className="text-sm font-medium">{active.title}</p>
                    <p className="text-xs text-muted-foreground">{active.description}</p>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Inject ≤{active.injectBudget} chars · file max {active.maxChars.toLocaleString()}
                  </p>
                </div>
                <Textarea
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  rows={12}
                  className="min-h-[220px] resize-y font-mono text-sm"
                  spellCheck={false}
                />
                <div className="flex flex-wrap items-center gap-2">
                  <Button onClick={() => void save()} disabled={saving}>
                    {saving ? "Saving…" : `Save ${active.filename}`}
                  </Button>
                  <p className="text-xs text-muted-foreground">
                    {draft.length.toLocaleString()} chars
                    {active.exists ? "" : " · not on disk yet"}
                    {injectSlice
                      ? ` · currently injecting ${injectSlice.charCount}${injectSlice.truncated ? " (truncated)" : ""}`
                      : " · not injected (empty / template only)"}
                  </p>
                </div>
              </div>
            ) : null}

            <div className="rounded-xl border border-border/60 bg-muted/20 px-3 py-2 text-xs text-muted-foreground">
              <p className="font-medium text-foreground">What Staff sees right now</p>
              <p className="mt-1">
                {data.inject.totalInjected} / {data.inject.totalBudget} chars across{" "}
                {data.inject.slices.length} file
                {data.inject.slices.length === 1 ? "" : "s"}
                {data.inject.slices.length
                  ? `: ${data.inject.slices.map((s) => s.filename).join(", ")}`
                  : ". Add prefs (hotel budget, Cham/Zug, …) to make triage feel Jarvis-smart."}
              </p>
            </div>
          </>
        ) : null}
        {note ? <p className="text-xs text-muted-foreground">{note}</p> : null}
      </CardContent>
    </Card>
  );
}
