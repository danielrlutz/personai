"use client";

import { useMemo, useState } from "react";
import { Archive, Check, ChevronLeft, ChevronRight, FileArchive } from "lucide-react";
import { apiGet, apiPost } from "@/lib/api-client";
import { ARCHIVE_TAXONOMY_CLIENT } from "@/lib/archive-taxonomy";
import { countLabel } from "@/lib/confirm-labels";
import { ConfirmGate } from "@/components/confirm/ConfirmGate";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

const STEPS = [
  { id: "year", label: "Year" },
  { id: "hits", label: "Archive hits" },
  { id: "confirm", label: "Confirm" },
] as const;

/** Insurance, Financial (Steuern), Employment, Health — plus optional Official. */
const PACK_CATEGORY_OPTIONS = [3, 4, 5, 6, 1] as const;

type JahresakteDoc = {
  id: string;
  filename: string;
  archiveName: string | null;
  archiveCategory: number | null;
  categoryLabel: string;
  documentType: string;
  yearMatch: string;
};

type PreviewResponse = {
  year: number;
  categories: number[];
  driveEnabled: boolean;
  documents: JahresakteDoc[];
};

export function JahresakteWizard() {
  const currentYear = new Date().getFullYear();
  const [step, setStep] = useState(0);
  const [year, setYear] = useState(String(currentYear - 1));
  const [categories, setCategories] = useState<number[]>([3, 4, 5, 6]);
  const [docs, setDocs] = useState<JahresakteDoc[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [driveEnabled, setDriveEnabled] = useState(false);
  const [uploadToDrive, setUploadToDrive] = useState(false);
  const [loading, setLoading] = useState(false);
  const [queuing, setQueuing] = useState(false);
  const [awaiting, setAwaiting] = useState(false);
  const [gateKey, setGateKey] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [doneNote, setDoneNote] = useState<string | null>(null);

  const yearNum = Number(year);
  const yearValid = Number.isInteger(yearNum) && yearNum >= 1990 && yearNum <= 2100;

  const grouped = useMemo(() => {
    const map = new Map<string, JahresakteDoc[]>();
    for (const d of docs) {
      const key = d.categoryLabel || "Misc";
      const list = map.get(key) ?? [];
      list.push(d);
      map.set(key, list);
    }
    return [...map.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [docs]);

  const toggleCategory = (cat: number) => {
    setCategories((prev) =>
      prev.includes(cat) ? prev.filter((c) => c !== cat) : [...prev, cat].sort((a, b) => a - b),
    );
  };

  const toggleDoc = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const loadHits = async () => {
    if (!yearValid || categories.length === 0) return;
    setLoading(true);
    setError(null);
    setDoneNote(null);
    try {
      const data = await apiGet<PreviewResponse>(
        `/archive/jahresakte?year=${yearNum}&categories=${categories.join(",")}`,
      );
      setDocs(data.documents);
      setDriveEnabled(Boolean(data.driveEnabled));
      setSelected(new Set(data.documents.map((d) => d.id)));
      if (!data.driveEnabled) setUploadToDrive(false);
      setStep(1);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load archive hits");
    } finally {
      setLoading(false);
    }
  };

  const queuePack = async () => {
    if (selected.size === 0 || !yearValid) return;
    setQueuing(true);
    setError(null);
    setDoneNote(null);
    try {
      await apiPost("/archive/jahresakte", {
        year: yearNum,
        documentIds: Array.from(selected),
        categories,
        uploadToDrive: uploadToDrive && driveEnabled,
      });
      setAwaiting(true);
      setGateKey((k) => k + 1);
      setStep(2);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to queue Jahresakte pack");
    } finally {
      setQueuing(false);
    }
  };

  return (
    <div className="space-y-4">
      <ConfirmGate
        refreshKey={gateKey}
        onResolved={(d) => {
          if (d === "confirm") {
            setAwaiting(false);
            setDoneNote(
              uploadToDrive && driveEnabled
                ? `Jahresakte ${yearNum} written under this profile’s exports folder. Drive upload continues as a ServerJob.`
                : `Jahresakte ${yearNum} ZIP + PDF index saved under this profile’s exports folder.`,
            );
          }
          if (d === "reject") setAwaiting(false);
        }}
      />

      <div className="flex flex-wrap gap-2">
        {STEPS.map((s, i) => {
          const Icon = i < step ? Check : i === 0 ? Archive : i === 1 ? FileArchive : Check;
          return (
            <div
              key={s.id}
              className={cn(
                "flex items-center gap-2 rounded-full px-3 py-1 text-xs",
                i === step
                  ? "bg-primary/15 text-primary"
                  : i < step
                    ? "bg-muted/40 text-foreground"
                    : "bg-muted/20 text-muted-foreground",
              )}
            >
              <Icon className="h-3.5 w-3.5" />
              {i + 1}. {s.label}
            </div>
          );
        })}
      </div>

      {step === 0 ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Pick year</CardTitle>
            <CardDescription>
              Confirmed archive docs in Insurance, Financial (Steuern), Employment, and Health —
              optional Official. Tax season as a confirm-gated pack, not a Drive scavenger hunt.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <label className="mb-1.5 block text-xs text-muted-foreground">Calendar year</label>
              <Input
                type="number"
                min={1990}
                max={2100}
                value={year}
                onChange={(e) => setYear(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <p className="text-xs text-muted-foreground">Categories</p>
              <div className="flex flex-wrap gap-2">
                {PACK_CATEGORY_OPTIONS.map((cat) => {
                  const on = categories.includes(cat);
                  return (
                    <button
                      key={cat}
                      type="button"
                      onClick={() => toggleCategory(cat)}
                      className={cn(
                        "rounded-lg border px-3 py-1.5 text-xs transition-colors",
                        on
                          ? "border-primary/50 bg-primary/10 text-foreground"
                          : "border-border text-muted-foreground hover:bg-muted/30",
                      )}
                    >
                      {String(cat).padStart(2, "0")}_{ARCHIVE_TAXONOMY_CLIENT[cat]}
                    </button>
                  );
                })}
              </div>
            </div>
            {error ? <p className="text-sm text-red-400">{error}</p> : null}
            <Button
              onClick={() => void loadHits()}
              disabled={!yearValid || categories.length === 0 || loading}
            >
              {loading ? "Loading…" : "Find archive hits"}
              <ChevronRight className="h-4 w-4" />
            </Button>
          </CardContent>
        </Card>
      ) : null}

      {step === 1 ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Archive hits · {yearNum}</CardTitle>
            <CardDescription>
              {countLabel(docs.length, "confirmed document", "confirmed documents")} matched.
              Uncheck anything you want to leave out of the pack.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="max-h-72 space-y-3 overflow-y-auto rounded-lg border border-border p-3">
              {grouped.length === 0 ? (
                <p className="py-6 text-center text-sm text-muted-foreground">
                  No confirmed hits for {yearNum} in the selected folders.
                </p>
              ) : (
                grouped.map(([label, items]) => (
                  <div key={label} className="space-y-1">
                    <p className="text-xs font-medium text-muted-foreground">{label}</p>
                    {items.map((d) => (
                      <label
                        key={d.id}
                        className="flex cursor-pointer items-start gap-3 rounded-md p-2 hover:bg-muted/20"
                      >
                        <input
                          type="checkbox"
                          className="mt-1 rounded border-border"
                          checked={selected.has(d.id)}
                          onChange={() => toggleDoc(d.id)}
                        />
                        <span className="min-w-0 text-sm">
                          <span className="block truncate">{d.archiveName || d.filename}</span>
                          <span className="text-xs text-muted-foreground">
                            {d.documentType} · match via {d.yearMatch.replace("_", " ")}
                          </span>
                        </span>
                      </label>
                    ))}
                  </div>
                ))
              )}
            </div>

            <label
              className={cn(
                "flex items-start gap-3 rounded-lg border border-border p-3 text-sm",
                driveEnabled ? "cursor-pointer" : "opacity-60",
              )}
            >
              <input
                type="checkbox"
                className="mt-1 rounded border-border"
                disabled={!driveEnabled}
                checked={uploadToDrive && driveEnabled}
                onChange={(e) => setUploadToDrive(e.target.checked)}
              />
              <span>
                <span className="font-medium">Also upload ZIP to Drive</span>
                <span className="mt-0.5 block text-xs text-muted-foreground">
                  {driveEnabled
                    ? "Optional. Local ZIP/PDF index always writes first; Drive continues as a ServerJob into Financial."
                    : "Drive not linked — local export only. Link Google Drive in Settings when you want cloud copies."}
                </span>
              </span>
            </label>

            {error ? <p className="text-sm text-red-400">{error}</p> : null}

            <div className="flex flex-wrap gap-2">
              <Button type="button" variant="outline" onClick={() => setStep(0)}>
                <ChevronLeft className="h-4 w-4" />
                Back
              </Button>
              <Button
                onClick={() => void queuePack()}
                disabled={selected.size === 0 || queuing || awaiting}
              >
                {queuing
                  ? "Queuing…"
                  : awaiting
                    ? "Waiting for confirmation…"
                    : `Prepare pack (${selected.size})`}
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : null}

      {step === 2 ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Needs your confirmation</CardTitle>
            <CardDescription>
              Approve above to write the Jahresakte ZIP and PDF index locally
              {uploadToDrive && driveEnabled ? ", then optional Drive upload" : ""}.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {awaiting ? (
              <p className="text-sm text-muted-foreground">
                Waiting for confirmation —{" "}
                {countLabel(selected.size, "document", "documents")} in Jahresakte {yearNum}.
              </p>
            ) : null}
            {doneNote ? <p className="text-sm text-primary">{doneNote}</p> : null}
            {error ? <p className="text-sm text-red-400">{error}</p> : null}
            <div className="flex flex-wrap gap-2">
              <Button type="button" variant="outline" onClick={() => setStep(1)} disabled={awaiting}>
                <ChevronLeft className="h-4 w-4" />
                Back to hits
              </Button>
              {!awaiting && !doneNote ? (
                <Button onClick={() => void queuePack()} disabled={selected.size === 0 || queuing}>
                  {queuing ? "Queuing…" : "Re-queue pack"}
                </Button>
              ) : null}
              {doneNote ? (
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => {
                    setStep(0);
                    setDoneNote(null);
                    setDocs([]);
                    setSelected(new Set());
                  }}
                >
                  Pack another year
                </Button>
              ) : null}
            </div>
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
