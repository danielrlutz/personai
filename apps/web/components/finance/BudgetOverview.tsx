"use client";

import { useEffect, useState } from "react";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell } from "recharts";
import { apiGet, type BudgetCategoryOverview } from "@/lib/api-client";
import { formatCHF } from "@/lib/utils";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

export function BudgetOverview() {
  const [categories, setCategories] = useState<BudgetCategoryOverview[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    void apiGet<{ categories: BudgetCategoryOverview[] }>("/finance/budget")
      .then((data) => setCategories(data.categories))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <Skeleton className="h-80 rounded-lg" />;

  const chartData = categories.map((c) => ({
    name: c.name,
    spent: c.spent,
    limit: c.monthlyLimit ?? 0,
    color: c.color ?? "#14b8a6",
  }));

  const totalSpent = categories.reduce((s, c) => s + c.spent, 0);
  const totalLimit = categories.reduce((s, c) => s + (c.monthlyLimit ?? 0), 0);

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
            <p className={`text-2xl font-bold ${totalLimit - totalSpent < 0 ? "text-red-400" : "text-teal-400"}`}>
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
          {chartData.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">No budget categories yet.</p>
          ) : (
            <ResponsiveContainer width="100%" height={280}>
              <BarChart data={chartData} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                <XAxis dataKey="name" tick={{ fill: "#a1a1aa", fontSize: 12 }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fill: "#a1a1aa", fontSize: 12 }} axisLine={false} tickLine={false} />
                <Tooltip
                  contentStyle={{
                    background: "#18181b",
                    border: "1px solid rgba(255,255,255,0.08)",
                    borderRadius: 8,
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
          )}
        </CardContent>
      </Card>
    </div>
  );
}
