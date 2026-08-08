"use client";

import { useCallback, useEffect, useState } from "react";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell } from "recharts";
import { Wallet } from "lucide-react";
import { apiGet, type BudgetCategoryOverview } from "@/lib/api-client";
import { formatCHF } from "@/lib/utils";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/shared/EmptyState";
import { ApiLoadError } from "@/components/shared/ApiLoadError";

export function BudgetOverview() {
  const [categories, setCategories] = useState<BudgetCategoryOverview[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    setLoading(true);
    try {
      const data = await apiGet<{ categories: BudgetCategoryOverview[] }>("/finance/budget");
      setCategories(data.categories);
    } catch (err) {
      setCategories([]);
      setError(err instanceof Error ? err.message : "Failed to load budget");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  if (loading) return <Skeleton className="h-80 rounded-lg" />;

  if (error) {
    return (
      <Card>
        <CardContent className="pt-6">
          <ApiLoadError message={error} onRetry={() => void load()} />
        </CardContent>
      </Card>
    );
  }

  const chartData = categories.map((c) => ({
    name: c.name,
    spent: c.spent,
    limit: c.monthlyLimit ?? 0,
    color: c.color ?? "#1a73e8",
  }));

  const totalSpent = categories.reduce((s, c) => s + c.spent, 0);
  const totalLimit = categories.reduce((s, c) => s + (c.monthlyLimit ?? 0), 0);

  if (categories.length === 0) {
    return (
      <Card>
        <CardContent className="pt-6">
          <EmptyState
            icon={Wallet}
            title="No budget categories"
            description="Budget categories appear here once configured for this profile."
          />
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-3">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-muted-foreground">Spent this month</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold">{formatCHF(totalSpent)}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-muted-foreground">Monthly budget</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold">{formatCHF(totalLimit)}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-muted-foreground">Remaining</CardTitle>
          </CardHeader>
          <CardContent>
            <p className={`text-2xl font-normal ${totalLimit - totalSpent < 0 ? "text-destructive" : "text-primary"}`}>
              {formatCHF(totalLimit - totalSpent)}
            </p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Budget by category</CardTitle>
        </CardHeader>
        <CardContent>
          <ResponsiveContainer width="100%" height={280}>
            <BarChart data={chartData} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
              <XAxis dataKey="name" tick={{ fill: "#bdc1c6", fontSize: 12 }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fill: "#bdc1c6", fontSize: 12 }} axisLine={false} tickLine={false} />
              <Tooltip
                contentStyle={{
                  background: "#303134",
                  border: "1px solid rgba(232,234,237,0.12)",
                  borderRadius: 8,
                  boxShadow: "0 1px 3px rgba(0,0,0,0.3)",
                }}
                formatter={(value: number) => formatCHF(value)}
              />
              <Bar dataKey="spent" radius={[4, 4, 0, 0]}>
                {chartData.map((entry, i) => (
                  <Cell key={i} fill={entry.color} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
          {totalSpent === 0 && (
            <p className="mt-3 text-center text-xs text-muted-foreground">
              No spending recorded this month — category limits are templates only.
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
