"use client";

import { useCallback, useEffect, useState } from "react";
import { ArrowDownLeft, ArrowUpRight, ArrowLeftRight } from "lucide-react";
import { apiGet, type Transaction } from "@/lib/api-client";
import { formatCHF, formatDate } from "@/lib/utils";
import { labelForEnum } from "@/lib/confirm-labels";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/shared/EmptyState";
import { ApiLoadError } from "@/components/shared/ApiLoadError";

const typeIcons = {
  INCOME: ArrowDownLeft,
  EXPENSE: ArrowUpRight,
  TRANSFER: ArrowLeftRight,
};

const typeColors = {
  INCOME: "text-emerald-400",
  EXPENSE: "text-red-400",
  TRANSFER: "text-blue-400",
};

export function TransactionTable() {
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    setLoading(true);
    try {
      const data = await apiGet<{ transactions: Transaction[] }>("/finance/transactions");
      setTransactions(data.transactions);
    } catch (err) {
      setTransactions([]);
      setError(err instanceof Error ? err.message : "Failed to load transactions");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  if (loading) return <Skeleton className="h-96 rounded-lg" />;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Transactions</CardTitle>
      </CardHeader>
      <CardContent>
        {error ? (
          <ApiLoadError message={error} onRetry={() => void load()} />
        ) : transactions.length === 0 ? (
          <EmptyState
            icon={ArrowLeftRight}
            title="No transactions"
            description="Transactions from archived documents or manual entries appear here."
          />
        ) : (
          <div className="min-w-0 overflow-x-auto">
            <table className="w-full min-w-[36rem] table-fixed text-sm">
              <thead>
                <tr className="border-b border-border text-left text-muted-foreground">
                  <th className="w-28 pb-3 font-medium">Date</th>
                  <th className="pb-3 font-medium">Description</th>
                  <th className="w-32 pb-3 font-medium">Category</th>
                  <th className="w-28 pb-3 font-medium">Type</th>
                  <th className="w-28 pb-3 text-right font-medium">Amount</th>
                </tr>
              </thead>
              <tbody>
                {transactions.map((tx) => {
                  const Icon = typeIcons[tx.type];
                  return (
                    <tr key={tx.id} className="border-b border-border/50 last:border-0">
                      <td className="whitespace-nowrap py-3 text-muted-foreground">
                        {formatDate(tx.date)}
                      </td>
                      <td className="max-w-0 truncate py-3" title={tx.description}>
                        {tx.description}
                      </td>
                      <td className="py-3">
                        {tx.category ? (
                          <Badge variant="secondary" className="max-w-full truncate">
                            {tx.category.name}
                          </Badge>
                        ) : (
                          "—"
                        )}
                      </td>
                      <td className="py-3">
                        <span className={`inline-flex items-center gap-1 ${typeColors[tx.type]}`}>
                          <Icon className="h-3.5 w-3.5 shrink-0" />
                          {labelForEnum(tx.type)}
                        </span>
                      </td>
                      <td
                        className={`whitespace-nowrap py-3 text-right font-medium ${typeColors[tx.type]}`}
                      >
                        {tx.type === "EXPENSE" ? "−" : tx.type === "INCOME" ? "+" : ""}
                        {formatCHF(tx.amount, tx.currency)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
