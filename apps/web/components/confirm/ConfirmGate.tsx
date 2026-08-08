"use client";

import { useCallback, useEffect, useState } from "react";
import { ShieldCheck, X } from "lucide-react";
import { apiGet, apiPost, type PendingConfirmation } from "@/lib/api-client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
      const data = await apiGet<{ confirmations: PendingConfirmation[] }>("/confirmations");
      setItems(data.confirmations);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load confirmations");
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load, refreshKey]);

  const decide = async (id: string, decision: "confirm" | "reject") => {
    setBusyId(id);
    try {
      await apiPost(`/confirmations/${id}/${decision === "confirm" ? "confirm" : "reject"}`);
      await load();
      onResolved?.(decision);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Action failed");
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
          Confirm before write
          <Badge variant="outline">{items.length}</Badge>
        </CardTitle>
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
                <p className="text-xs uppercase tracking-wide text-muted-foreground">{c.action}</p>
                <p className="md-label-large break-words [overflow-wrap:anywhere] sm:truncate">
                  {c.summary}
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
                  Reject
                </Button>
              </div>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}
