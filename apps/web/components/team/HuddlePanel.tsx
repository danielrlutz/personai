"use client";

import { useMemo, useState } from "react";
import { Loader2, UsersRound } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ConfirmGate } from "@/components/confirm/ConfirmGate";
import { SPECIALIST_FALLBACK, type SpecialistMeta } from "@/lib/specialists";
import { cn } from "@/lib/utils";

type HuddlePanelProps = {
  specialists: SpecialistMeta[];
  disabled?: boolean;
  running?: boolean;
  initialSelected?: string[];
  onStart: (guests: string[]) => void;
};

export function HuddlePanel({
  specialists,
  disabled,
  running,
  initialSelected = [],
  onStart,
}: HuddlePanelProps) {
  const roster = specialists.length ? specialists : SPECIALIST_FALLBACK;
  const guests = useMemo(
    () => roster.filter((s) => s.id !== "secretary"),
    [roster],
  );
  const [selected, setSelected] = useState<string[]>(() =>
    initialSelected.filter((id) => id !== "secretary").slice(0, 2),
  );
  const [gateKey, setGateKey] = useState(0);

  const toggle = (id: string) => {
    setSelected((prev) => {
      if (prev.includes(id)) return prev.filter((x) => x !== id);
      if (prev.length >= 2) return [prev[1]!, id];
      return [...prev, id];
    });
  };

  return (
    <div className="space-y-3">
      <ConfirmGate refreshKey={gateKey} compact />
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-base">
            <UsersRound className="h-4 w-4 text-primary" />
            Pocket huddle
          </CardTitle>
          <p className="text-sm leading-snug text-muted-foreground">
            Staff speaks first, then up to two specialists — one Team thread. Writes still land in
            Needs your confirmation.
          </p>
        </CardHeader>
        <CardContent className="space-y-3">
          <div>
            <p className="mb-2 text-xs font-medium uppercase tracking-[0.08em] text-muted-foreground">
              Guests (max 2)
            </p>
            <div className="flex flex-wrap gap-1.5">
              {guests.map((s) => {
                const on = selected.includes(s.id);
                return (
                  <button
                    key={s.id}
                    type="button"
                    disabled={disabled || running}
                    onClick={() => toggle(s.id)}
                    className={cn(
                      "rounded-lg border px-2.5 py-1 text-xs transition-colors",
                      on
                        ? "border-primary/50 bg-primary-container text-primary-on-container"
                        : "border-border bg-card text-muted-foreground hover:text-foreground",
                    )}
                  >
                    {s.shortLabel}
                  </button>
                );
              })}
            </div>
          </div>
          <Button
            className="w-full"
            disabled={disabled || running || selected.length === 0}
            onClick={() => {
              onStart(selected);
              setGateKey((k) => k + 1);
            }}
          >
            {running ? (
              <>
                <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
                Huddle running…
              </>
            ) : (
              <>
                <UsersRound className="mr-1.5 h-4 w-4" />
                Start huddle with message
              </>
            )}
          </Button>
          {selected.length === 0 ? (
            <p className="text-xs text-muted-foreground">Pick 1–2 guests, then start.</p>
          ) : null}
        </CardContent>
      </Card>
    </div>
  );
}
