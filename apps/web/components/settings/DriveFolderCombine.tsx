"use client";

import { useMemo, useState } from "react";
import { FolderInput, Loader2 } from "lucide-react";
import {
  apiGet,
  apiPost,
  type CombineConflictAction,
  type CombineDryRunReport,
  type CombineExecuteResult,
  type CombineFileDecision,
  type CombineFolderListItem,
  type CombineFoldersResponse,
} from "@/lib/api-client";
import { trackDriveJobPulse } from "@/components/confirm/DriveJobPulse";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

type Props = {
  linked: boolean;
  disabled?: boolean;
};

function formatBytes(size: number | null): string {
  if (size == null || !Number.isFinite(size)) return "—";
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

function formatModified(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString();
}

const ACTIONS: Array<{ id: CombineConflictAction; label: string }> = [
  { id: "keep_destination", label: "Keep destination" },
  { id: "keep_incoming", label: "Keep incoming (rename dest)" },
  { id: "keep_both", label: "Keep both (auto-rename)" },
  { id: "skip", label: "Skip" },
];

export function DriveFolderCombine({ linked, disabled }: Props) {
  const [folders, setFolders] = useState<CombineFolderListItem[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [destinationId, setDestinationId] = useState<string | null>(null);
  const [preview, setPreview] = useState<CombineDryRunReport | null>(null);
  const [decisions, setDecisions] = useState<Record<string, CombineFileDecision>>({});
  const [reviewed, setReviewed] = useState(false);
  const [removeEmpty, setRemoveEmpty] = useState(false);
  const [understandRemove, setUnderstandRemove] = useState(false);
  const [busy, setBusy] = useState<"load" | "dry" | "exec" | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [jobId, setJobId] = useState<string | null>(null);

  const sources = useMemo(() => {
    if (!destinationId) return [...selected];
    return [...selected].filter((id) => id !== destinationId);
  }, [selected, destinationId]);

  const loadFolders = async () => {
    setBusy("load");
    setNote(null);
    setPreview(null);
    setReviewed(false);
    setJobId(null);
    try {
      const res = await apiGet<CombineFoldersResponse>("/archive/drive/combine/folders");
      setFolders(res.folders);
      setNote(res.note);
      setSelected(new Set());
      setDestinationId(null);
    } catch (err) {
      setNote(err instanceof Error ? err.message : "Could not load folder map");
    } finally {
      setBusy(null);
    }
  };

  const toggleSelect = (id: string) => {
    setPreview(null);
    setReviewed(false);
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const runDryRun = async () => {
    if (!destinationId || sources.length < 1) {
      setNote("Select a destination and at least one other source folder.");
      return;
    }
    setBusy("dry");
    setNote(null);
    setReviewed(false);
    try {
      const report = await apiPost<CombineDryRunReport>("/archive/drive/combine/dry-run", {
        destinationFolderId: destinationId,
        sourceFolderIds: sources,
      });
      setPreview(report);
      const next: Record<string, CombineFileDecision> = {};
      for (const move of report.moves) {
        if (move.conflict) next[move.fileId] = { action: "keep_both" };
      }
      setDecisions(next);
      setNote(report.note);
    } catch (err) {
      setNote(err instanceof Error ? err.message : "Dry-run failed");
    } finally {
      setBusy(null);
    }
  };

  const setAction = (fileId: string, action: CombineConflictAction) => {
    setDecisions((prev) => ({
      ...prev,
      [fileId]: {
        action,
        trashOther: action === "keep_incoming" ? prev[fileId]?.trashOther : undefined,
      },
    }));
    setReviewed(false);
  };

  const setTrashOther = (fileId: string, trashOther: boolean) => {
    setDecisions((prev) => ({
      ...prev,
      [fileId]: {
        action: prev[fileId]?.action ?? "keep_incoming",
        trashOther: trashOther || undefined,
      },
    }));
    setReviewed(false);
  };

  const canConfirm =
    Boolean(preview) &&
    reviewed &&
    busy === null &&
    linked &&
    !disabled &&
    (!removeEmpty || understandRemove);

  const execute = async () => {
    if (!preview || !canConfirm) return;
    setBusy("exec");
    setNote(null);
    try {
      const result = await apiPost<CombineExecuteResult>("/archive/drive/combine/execute", {
        destinationFolderId: preview.destination.id,
        sourceFolderIds: preview.sources.map((s) => s.id),
        dryRunAt: preview.dryRunAt,
        decisions,
        removeEmptySourceFolders: removeEmpty,
        iUnderstandRemoveEmptySourceFolders: understandRemove,
      });
      setJobId(result.jobId);
      trackDriveJobPulse(result.jobId);
      setNote(result.message);
    } catch (err) {
      setNote(err instanceof Error ? err.message : "Combine failed to queue");
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="space-y-3 rounded-lg border border-border/70 bg-muted/20 p-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0 space-y-1">
          <p className="flex items-center gap-2 text-sm font-medium text-foreground">
            <FolderInput className="h-4 w-4 text-primary" />
            Combine folders
          </p>
          <p className="text-xs text-muted-foreground">
            Merge selected taxonomy folders into one destination (Drive parents update). Name
            conflicts are never overwritten — choose Keep destination / Keep incoming / Keep both /
            Skip. Nothing is deleted unless you tick an explicit confirm.
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          className="shrink-0"
          onClick={() => void loadFolders()}
          disabled={disabled || busy !== null || !linked}
        >
          {busy === "load" ? (
            <>
              <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
              Loading…
            </>
          ) : (
            "Load folder map"
          )}
        </Button>
      </div>

      {folders.length > 0 ? (
        <div className="space-y-3">
          <ul className="max-h-56 space-y-1 overflow-y-auto rounded-md border border-border/60 bg-background/60 p-2">
            {folders.map((folder) => {
              const isSelected = selected.has(folder.id);
              const isDest = destinationId === folder.id;
              return (
                <li
                  key={folder.id}
                  className="flex flex-wrap items-center justify-between gap-2 rounded px-1 py-1.5 text-sm hover:bg-muted/40"
                >
                  <label className="flex min-w-0 cursor-pointer items-center gap-2">
                    <input
                      type="checkbox"
                      checked={isSelected}
                      disabled={disabled || busy !== null}
                      onChange={() => toggleSelect(folder.id)}
                    />
                    <span className="truncate font-mono text-xs sm:text-sm">{folder.name}</span>
                    <span className="text-xs text-muted-foreground">
                      {folder.fileCount} item{folder.fileCount === 1 ? "" : "s"}
                    </span>
                  </label>
                  <Button
                    size="sm"
                    variant={isDest ? "default" : "outline"}
                    disabled={disabled || busy !== null || !isSelected}
                    onClick={() => {
                      setDestinationId(folder.id);
                      setPreview(null);
                      setReviewed(false);
                    }}
                  >
                    {isDest ? "Destination" : "Set destination"}
                  </Button>
                </li>
              );
            })}
          </ul>

          <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            <Badge variant="outline">{selected.size} selected</Badge>
            <Badge variant="outline">
              {sources.length} source{sources.length === 1 ? "" : "s"}
            </Badge>
            {destinationId ? <Badge variant="default">Destination set</Badge> : null}
          </div>

          <Button
            variant="outline"
            size="sm"
            onClick={() => void runDryRun()}
            disabled={disabled || busy !== null || !destinationId || sources.length < 1}
          >
            {busy === "dry" ? (
              <>
                <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                Previewing…
              </>
            ) : (
              "Dry-run preview"
            )}
          </Button>
        </div>
      ) : null}

      {preview ? (
        <div className="space-y-3">
          <p className="text-xs text-muted-foreground">
            Into <span className="font-mono text-foreground">{preview.destination.name}</span> from{" "}
            {preview.sources.map((s) => s.name).join(", ")} — {preview.moveCount} move
            {preview.moveCount === 1 ? "" : "s"}, {preview.conflictCount} conflict
            {preview.conflictCount === 1 ? "" : "s"}.
          </p>

          <ul className="max-h-72 space-y-2 overflow-y-auto">
            {preview.moves.map((move) => {
              if (!move.conflict) {
                return (
                  <li
                    key={move.fileId}
                    className="rounded-md border border-border/50 bg-background/50 px-3 py-2 text-xs"
                  >
                    <p className="font-mono text-sm text-foreground">{move.name}</p>
                    <p className="text-muted-foreground">
                      Move from {move.fromFolderName} · {formatBytes(move.size)} ·{" "}
                      {formatModified(move.modifiedTime)}
                    </p>
                  </li>
                );
              }

              const decision = decisions[move.fileId] ?? { action: "keep_both" as const };
              return (
                <li
                  key={move.fileId}
                  className="space-y-2 rounded-md border border-amber-500/40 bg-background/60 p-3"
                >
                  <details open>
                    <summary className="cursor-pointer text-sm font-medium">
                      Conflict: <span className="font-mono">{move.name}</span>
                    </summary>
                    <div className="mt-2 grid gap-2 sm:grid-cols-2">
                      <div className="rounded border border-border/50 p-2 text-xs">
                        <p className="font-medium text-foreground">Incoming (from)</p>
                        <p className="font-mono">{move.conflict.incoming.name}</p>
                        <p className="text-muted-foreground">
                          {move.conflict.incoming.folderName} ·{" "}
                          {formatBytes(move.conflict.incoming.size)} ·{" "}
                          {formatModified(move.conflict.incoming.modifiedTime)}
                        </p>
                      </div>
                      <div className="rounded border border-border/50 p-2 text-xs">
                        <p className="font-medium text-foreground">Existing in destination</p>
                        <p className="font-mono">{move.conflict.existing.name}</p>
                        <p className="text-muted-foreground">
                          {move.conflict.existing.folderName} ·{" "}
                          {formatBytes(move.conflict.existing.size)} ·{" "}
                          {formatModified(move.conflict.existing.modifiedTime)}
                        </p>
                      </div>
                    </div>
                  </details>
                  <div className="flex flex-wrap gap-1.5">
                    {ACTIONS.map((a) => (
                      <Button
                        key={a.id}
                        size="sm"
                        variant={decision.action === a.id ? "default" : "outline"}
                        disabled={disabled || busy !== null}
                        onClick={() => setAction(move.fileId, a.id)}
                      >
                        {a.label}
                      </Button>
                    ))}
                  </div>
                  {decision.action === "keep_incoming" ? (
                    <label className="flex items-start gap-2 text-xs text-destructive">
                      <input
                        type="checkbox"
                        className="mt-0.5"
                        checked={Boolean(decision.trashOther)}
                        disabled={disabled || busy !== null}
                        onChange={(e) => setTrashOther(move.fileId, e.target.checked)}
                      />
                      <span>
                        Dangerous: trash the existing destination item (not done unless checked).
                        Default renames it aside instead.
                      </span>
                    </label>
                  ) : null}
                </li>
              );
            })}
          </ul>

          <label className="flex items-start gap-2 text-xs text-muted-foreground">
            <input
              type="checkbox"
              className="mt-0.5"
              checked={removeEmpty}
              disabled={disabled || busy !== null}
              onChange={(e) => {
                setRemoveEmpty(e.target.checked);
                if (!e.target.checked) setUnderstandRemove(false);
                setReviewed(false);
              }}
            />
            <span>After merge, remove empty source folders (optional — off by default).</span>
          </label>
          {removeEmpty ? (
            <label className="flex items-start gap-2 text-xs text-destructive">
              <input
                type="checkbox"
                className="mt-0.5"
                checked={understandRemove}
                disabled={disabled || busy !== null}
                onChange={(e) => {
                  setUnderstandRemove(e.target.checked);
                  setReviewed(false);
                }}
              />
              <span>I understand this removes the folder from Drive (moves it to trash).</span>
            </label>
          ) : null}

          <label className="flex items-start gap-2 text-xs font-medium text-foreground">
            <input
              type="checkbox"
              className="mt-0.5"
              checked={reviewed}
              disabled={disabled || busy !== null}
              onChange={(e) => setReviewed(e.target.checked)}
            />
            <span>I reviewed the dry-run preview (required to enable Confirm combine).</span>
          </label>

          <Button size="sm" disabled={!canConfirm} onClick={() => void execute()}>
            {busy === "exec" ? (
              <>
                <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                Queuing…
              </>
            ) : (
              "Confirm combine"
            )}
          </Button>
          {jobId ? (
            <p className="text-xs text-muted-foreground">
              Job <span className="font-mono">{jobId}</span> queued — watch the Drive upload pulse /
              Activity for progress.
            </p>
          ) : null}
        </div>
      ) : null}

      {note ? <p className="text-xs text-muted-foreground">{note}</p> : null}
    </div>
  );
}
