"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Activity as ActivityIcon, RefreshCw } from "lucide-react";
import { apiGet } from "@/lib/api-client";
import { labelForConfirmAction } from "@/lib/confirm-labels";
import { Button } from "@/components/ui/button";
import { PageEnter } from "@/components/motion/PageEnter";
import { EmptyState } from "@/components/shared/EmptyState";

type AuditLog = {
  id: string;
  action: string;
  entity: string | null;
  entityId: string | null;
  metadata: unknown;
  createdAt: string;
};

export default function ActivityPage() {
  const [logs, setLogs] = useState<AuditLog[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await apiGet<{ logs: AuditLog[] }>("/activity?limit=120");
      setLogs(data.logs);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load activity");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <PageEnter className="mx-auto max-w-3xl space-y-6">
      <div className="page-header flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="font-display text-3xl tracking-tight sm:text-4xl">Activity</h1>
          <p className="page-subtitle">
            Audit trail for confirms, archive writes, triage, and exports. Cancelled confirms leave
            external systems unchanged.
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={() => void load()} disabled={loading}>
          <RefreshCw className={`mr-1.5 h-4 w-4 ${loading ? "animate-spin" : ""}`} />
          Refresh
        </Button>
      </div>

      {error ? <p className="text-sm text-destructive">{error}</p> : null}

      {!loading && logs.length === 0 ? (
        <EmptyState
          icon={ActivityIcon}
          title="Nothing logged yet"
          description="Upload a document, confirm a ledger write, or run triage — it shows up here."
          action={
            <Button asChild size="sm">
              <Link href="/dashboard/">Back to Home</Link>
            </Button>
          }
        />
      ) : (
        <ul className="divide-y divide-border/60 rounded-2xl border border-border bg-card">
          {logs.map((log) => (
            <li key={log.id} className="px-4 py-3.5">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <p className="text-sm font-medium">{labelForConfirmAction(log.action)}</p>
                <time className="text-xs text-muted-foreground">
                  {new Date(log.createdAt).toLocaleString("de-CH")}
                </time>
              </div>
              <p className="mt-0.5 text-xs text-muted-foreground">
                {[log.entity, log.entityId].filter(Boolean).join(" · ") || "—"}
              </p>
            </li>
          ))}
        </ul>
      )}
    </PageEnter>
  );
}
