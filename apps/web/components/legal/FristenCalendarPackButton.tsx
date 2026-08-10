"use client";

import { useState } from "react";
import { CalendarPlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { stageAndDownloadFristenPack } from "@/lib/fristen-calendar";

type Props = {
  /** Optional Frist ids (`task:…` / `doc:…`). Omit to pack all open dated Fristen. */
  ids?: string[];
  size?: "sm" | "default";
  variant?: "outline" | "ghost" | "secondary";
  className?: string;
  label?: string;
};

export function FristenCalendarPackButton({
  ids,
  size = "sm",
  variant = "outline",
  className,
  label = "Stage + .ics",
}: Props) {
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const run = async () => {
    setBusy(true);
    setError(null);
    setNote(null);
    try {
      const pack = await stageAndDownloadFristenPack(ids);
      if (pack.events.length === 0) {
        setNote("No dated Fristen to pack.");
      } else {
        setNote(
          `Staged ${pack.staged} locally · downloaded ${pack.filename} (Google write later).`,
        );
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Calendar pack failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={className}>
      <Button
        type="button"
        size={size}
        variant={variant}
        disabled={busy}
        onClick={() => void run()}
      >
        <CalendarPlus className="h-3.5 w-3.5" />
        {busy ? "Packing…" : label}
      </Button>
      {note ? <p className="mt-1.5 text-xs text-muted-foreground">{note}</p> : null}
      {error ? <p className="mt-1.5 text-xs text-destructive">{error}</p> : null}
    </div>
  );
}
