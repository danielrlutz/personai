"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Bell } from "lucide-react";
import { apiGet, type HomeHeadsUp } from "@/lib/api-client";
import { formatCHF } from "@/lib/utils";
import { Button } from "@/components/ui/button";

function dueLabel(iso: string | null, overdue: boolean): string {
  if (!iso) return overdue ? "overdue" : "soon";
  const d = new Date(iso).toLocaleDateString("de-CH");
  return overdue ? `${d} · overdue` : d;
}

export function HeadsUpWidget() {
  const [data, setData] = useState<HomeHeadsUp | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void apiGet<HomeHeadsUp>("/home/heads-up", { silent: true })
      .then(setData)
      .catch((err) => setError(err instanceof Error ? err.message : "Could not load heads-up"));
  }, []);

  if (error) {
    return <p className="text-sm text-destructive">{error}</p>;
  }

  if (!data) {
    return <p className="text-sm text-muted-foreground">Checking desk…</p>;
  }

  const quiet =
    data.fristen.length === 0 &&
    data.unpaidInvoices.length === 0 &&
    data.pendingConfirmations === 0;

  if (quiet) {
    return (
      <div className="flex items-start gap-3 rounded-2xl border border-border/70 bg-card px-4 py-3.5">
        <Bell className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
        <div>
          <p className="text-sm font-medium">Desk is clear</p>
          <p className="text-xs text-muted-foreground">
            No urgent Fristen or unpaid invoices in the next 36 hours.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <h2 className="font-display text-lg tracking-tight">Heads-up</h2>
        {data.pendingConfirmations > 0 ? (
          <Button variant="ghost" size="sm" asChild>
            <Link href="/#confirms">
              {data.pendingConfirmations} awaiting confirm
            </Link>
          </Button>
        ) : null}
      </div>
      <div className="rounded-2xl border border-border bg-card px-4 py-3.5">
        <p className="text-xs text-muted-foreground">
          Light nudge only — money and archive writes still need your confirmation.
        </p>
        {data.fristen.length > 0 ? (
          <ul className="mt-3 space-y-2">
            {data.fristen.slice(0, 3).map((f) => (
              <li key={f.id} className="flex items-center justify-between gap-2 text-sm">
                <span className="min-w-0 truncate font-medium">{f.title}</span>
                <Button variant="outline" size="sm" asChild className="shrink-0">
                  <Link href={f.href}>{dueLabel(f.dueDate, f.overdue)}</Link>
                </Button>
              </li>
            ))}
          </ul>
        ) : null}
        {data.unpaidInvoices.length > 0 ? (
          <ul className="mt-3 space-y-2 border-t border-border/60 pt-3">
            {data.unpaidInvoices.slice(0, 3).map((inv) => (
              <li key={inv.id} className="flex items-center justify-between gap-2 text-sm">
                <span className="min-w-0 truncate">
                  <span className="font-medium">{inv.creditor}</span>
                  <span className="text-muted-foreground">
                    {" "}
                    · {formatCHF(inv.amount)} unpaid invoice
                  </span>
                </span>
                <Button variant="outline" size="sm" asChild className="shrink-0">
                  <Link href={inv.href}>Review</Link>
                </Button>
              </li>
            ))}
          </ul>
        ) : null}
      </div>
    </div>
  );
}
