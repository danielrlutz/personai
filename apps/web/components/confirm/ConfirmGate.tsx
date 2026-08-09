"use client";

import { useCallback, useEffect, useState } from "react";
import { ShieldCheck, X } from "lucide-react";
import { apiGet, apiPost, type PendingConfirmation } from "@/lib/api-client";
import {
  humanizeConfirmationSummary,
  labelForConfirmAction,
} from "@/lib/confirm-labels";
import { toast } from "@/lib/toast";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";


interface ConfirmGateProps {
  /** Bump to force refresh */
  refreshKey?: number;
  onResolved?: (decision: "confirm" | "reject") => void;
  compact?: boolean;
}

export function ConfirmGate({ refreshKey = 0, onResolved, compact }: ConfirmGateProps) {
  const [items, setItems] = useState<PendingConfirmation[]>([]);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      // silent: ToastHost/api-client already surfaces fetch failures; keep inline for empty state.
      const data = await apiGet<{ confirmations: PendingConfirmation[] }>("/confirmations", {
        silent: true,
      });
      setItems(data.confirmations);
      setError(null);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to load confirmations";
      setError(message);
      toast.error(message, {
        title: "Couldn't load confirmations",
        sticky: true,
        dedupeKey: `confirm-load:${message}`,
      });
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load, refreshKey]);

  const decide = async (id: string, decision: "confirm" | "reject") => {
    setBusyId(id);
    try {
      await apiPost(
        `/confirmations/${id}/${decision === "confirm" ? "confirm" : "reject"}`,
        undefined,
        { silent: true },
      );
      await load();
      onResolved?.(decision);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Action failed";
      setError(message);
      toast.error(message, {
        title: decision === "confirm" ? "Couldn't confirm" : "Couldn't decline",
        sticky: true,
        dedupeKey: `confirm-decide:${id}:${message}`,
      });
    } finally {
      setBusyId(null);
    }
  };

  if (items.length === 0 && !error) return null;

  return (
    <Card className={compact ? "border-primary/30" : undefined}>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-base">
          <ShieldCheck className="h-4 w-4 text-primary" />
          Needs your confirmation
          <Badge variant="outline">{items.length}</Badge>
        </CardTitle>
        <CardDescription className="text-xs">
          These changes are ready but not saved until you approve.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {error ? <p className="text-sm text-destructive">{error}</p> : null}
        <ul className="space-y-2">
          {items.map((c) => (
            <li
              key={c.id}
              className="flex flex-col gap-2 rounded-lg border border-border/80 bg-surface-container/60 px-3 py-2.5 sm:flex-row sm:items-center sm:justify-between"
            >
              <div className="min-w-0">
                <p className="text-xs font-medium tracking-wide text-muted-foreground">
                  {labelForConfirmAction(c.action)}
                </p>
                <p className="md-label-large break-words [overflow-wrap:anywhere] sm:truncate">
                  {humanizeConfirmationSummary(c.summary)}
                </p>
              </div>
              <div className="flex shrink-0 gap-2">
                <Button
                  size="sm"
                  disabled={busyId === c.id}
                  onClick={() => void decide(c.id, "confirm")}
                >
                  Confirm
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={busyId === c.id}
                  onClick={() => void decide(c.id, "reject")}
                >
                  <X className="mr-1 h-3 w-3" />
                  Decline
                </Button>
              </div>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}
