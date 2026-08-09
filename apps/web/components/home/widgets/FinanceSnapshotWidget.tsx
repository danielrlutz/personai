"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Wallet } from "lucide-react";
import { apiGet, type BudgetCategoryOverview } from "@/lib/api-client";
import { formatCHF } from "@/lib/utils";
import { Button } from "@/components/ui/button";

export function FinanceSnapshotWidget() {
  const [categories, setCategories] = useState<BudgetCategoryOverview[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    void apiGet<{ categories: BudgetCategoryOverview[] }>("/finance/budget", { silent: true })
      .then((d) => setCategories(d.categories ?? []))
      .catch((err) => setError(err instanceof Error ? err.message : "Could not load finance"))
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return <p className="text-sm text-muted-foreground">Loading finance…</p>;
  }

  if (error) {
    return <p className="text-sm text-destructive">{error}</p>;
  }

  if (categories.length === 0) {
    return (
      <div className="flex items-start gap-3 rounded-2xl border border-border/70 bg-card px-4 py-3.5">
        <Wallet className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
        <div className="min-w-0">
          <p className="text-sm font-medium">No finance data yet</p>
          <p className="text-xs text-muted-foreground">
            Budget categories and spend appear here once this profile has them — nothing invented.
          </p>
          <Button variant="ghost" size="sm" className="mt-2 px-0" asChild>
            <Link href="/finance/">Open Finance</Link>
          </Button>
        </div>
      </div>
    );
  }

  const totalSpent = categories.reduce((s, c) => s + c.spent, 0);
  const totalLimit = categories.reduce((s, c) => s + (c.monthlyLimit ?? 0), 0);
  const top = [...categories].sort((a, b) => b.spent - a.spent).slice(0, 4);
  const maxSpent = Math.max(...top.map((c) => c.spent), 1);

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <h2 className="font-display text-lg tracking-tight">Finance</h2>
        <Button variant="ghost" size="sm" asChild>
          <Link href="/finance/">Open</Link>
        </Button>
      </div>
      <div className="rounded-2xl border border-border bg-card px-4 py-3.5">
        <p className="text-sm text-muted-foreground">Spent this month</p>
        <p className="font-display text-2xl tracking-tight">{formatCHF(totalSpent)}</p>
        {totalLimit > 0 ? (
          <p className="mt-0.5 text-xs text-muted-foreground">of {formatCHF(totalLimit)} across limits</p>
        ) : null}
        {totalSpent > 0 ? (
          <ul className="mt-3 space-y-2">
            {top.map((c) => (
              <li key={c.id} className="space-y-1">
                <div className="flex justify-between gap-2 text-xs">
                  <span className="truncate text-muted-foreground">{c.name}</span>
                  <span className="shrink-0 font-medium">{formatCHF(c.spent)}</span>
                </div>
                <div className="h-1.5 overflow-hidden rounded-full bg-surface-container-high">
                  <div
                    className="h-full rounded-full bg-primary/80"
                    style={{ width: `${Math.min(100, (c.spent / maxSpent) * 100)}%` }}
                  />
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-2 text-xs text-muted-foreground">No spend recorded this month yet.</p>
        )}
      </div>
    </div>
  );
}
