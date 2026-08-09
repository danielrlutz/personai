"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Receipt, Check } from "lucide-react";
import { apiGet, apiPatch, type QRBill } from "@/lib/api-client";
import { formatCHF, formatDate } from "@/lib/utils";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/shared/EmptyState";
import { ApiLoadError } from "@/components/shared/ApiLoadError";

const statusVariant = {
  PENDING: "warning" as const,
  PAID: "success" as const,
  OVERDUE: "destructive" as const,
  CANCELLED: "secondary" as const,
};

export function QRBillList() {
  const [bills, setBills] = useState<QRBill[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const data = await apiGet<{ bills: QRBill[] }>("/finance/qr-bills");
      setBills(data.bills);
    } catch (err) {
      setBills([]);
      setError(err instanceof Error ? err.message : "Failed to load QR bills");
    }
  }, []);

  useEffect(() => {
    void load().finally(() => setLoading(false));
  }, [load]);

  const markPaid = async (id: string) => {
    // Creates a pending confirmation (ledger write) — resolve on Home/Archive ConfirmGate.
    await apiPatch(`/finance/qr-bills/${id}`, { status: "PAID" });
    await load();
  };

  if (loading) return <Skeleton className="h-56 rounded-lg" />;

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base">QR Bills</CardTitle>
      </CardHeader>
      <CardContent>
        {error ? (
          <ApiLoadError message={error} onRetry={() => void load()} />
        ) : bills.length === 0 ? (
          <EmptyState
            icon={Receipt}
            title="No QR bills yet"
            description="Nothing pending — upload a Swiss QR invoice under Archive, then confirm to save it."
            action={
              <Button variant="tonal" size="sm" asChild>
                <Link href="/ingest">Go to Archive</Link>
              </Button>
            }
          />
        ) : (
          <ul>
            {bills.map((bill) => (
              <li
                key={bill.id}
                className="md-list-row flex-col items-stretch justify-between gap-2 px-0 sm:flex-row sm:items-center"
              >
                <div className="min-w-0">
                  <p className="md-label-large truncate">{bill.creditorName}</p>
                  <p className="text-xs text-muted-foreground">
                    {formatCHF(bill.amount, bill.currency)}
                    {bill.dueDate && ` · Due ${formatDate(bill.dueDate)}`}
                  </p>
                  {bill.reference && (
                    <p className="mt-0.5 truncate font-mono text-[11px] text-muted-foreground">
                      {bill.reference}
                    </p>
                  )}
                </div>
                <div className="flex shrink-0 flex-wrap items-center gap-2">
                  <Badge variant={statusVariant[bill.status]}>
                    {bill.status === "PENDING"
                      ? "Pending"
                      : bill.status === "PAID"
                        ? "Paid"
                        : bill.status === "OVERDUE"
                          ? "Overdue"
                          : bill.status === "CANCELLED"
                            ? "Cancelled"
                            : bill.status}
                  </Badge>
                  {bill.status === "PENDING" && (
                    <Button size="sm" variant="outline" onClick={() => void markPaid(bill.id)}>
                      <Check className="mr-1 h-3 w-3" />
                      Request paid
                    </Button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
