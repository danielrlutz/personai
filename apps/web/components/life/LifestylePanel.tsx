"use client";

import { useCallback, useEffect, useState } from "react";
import { Activity, Plus } from "lucide-react";
import { apiGet, apiPost, type LifestyleMetric } from "@/lib/api-client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/shared/EmptyState";
import { ApiLoadError } from "@/components/shared/ApiLoadError";
import { formatDate } from "@/lib/utils";

interface LifestylePanelProps {
  refreshKey?: number;
  onChanged?: () => void;
}

export function LifestylePanel({ refreshKey = 0, onChanged }: LifestylePanelProps) {
  const [metrics, setMetrics] = useState<LifestyleMetric[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [key, setKey] = useState("");
  const [value, setValue] = useState("");
  const [unit, setUnit] = useState("");
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    try {
      const data = await apiGet<{ metrics: LifestyleMetric[] }>("/life/metrics");
      setMetrics(data.metrics);
    } catch (err) {
      setMetrics([]);
      setError(err instanceof Error ? err.message : "Failed to load metrics");
    }
  }, []);

  useEffect(() => {
    setLoading(true);
    void load().finally(() => setLoading(false));
  }, [load, refreshKey]);

  const create = async (e: React.FormEvent) => {
    e.preventDefault();
    const numeric = Number(value);
    if (!key.trim() || Number.isNaN(numeric)) return;
    setSaving(true);
    try {
      await apiPost("/life/metrics", {
        key: key.trim().toLowerCase().replace(/\s+/g, "_"),
        label: key.trim(),
        value: numeric,
        unit: unit.trim() || undefined,
      });
      setKey("");
      setValue("");
      setUnit("");
      await load();
      onChanged?.();
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <Skeleton className="h-72 rounded-lg" />;

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-base">
          <Activity className="h-4 w-4 text-primary" />
          Lifestyle metrics
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <form onSubmit={(e) => void create(e)} className="grid gap-2 sm:grid-cols-4">
          <Input
            placeholder="Metric (e.g. sleep)"
            value={key}
            onChange={(e) => setKey(e.target.value)}
            required
          />
          <Input
            type="number"
            step="any"
            placeholder="Value"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            required
          />
          <Input placeholder="Unit" value={unit} onChange={(e) => setUnit(e.target.value)} />
          <Button type="submit" disabled={saving}>
            <Plus className="h-4 w-4" />
            Log
          </Button>
        </form>

        {error ? (
          <ApiLoadError message={error} onRetry={() => void load()} />
        ) : metrics.length === 0 ? (
          <EmptyState
            icon={Activity}
            title="No metrics logged"
            description="Log sleep, steps, or other lifestyle numbers when you have them — no sample data."
          />
        ) : (
          <ul className="space-y-2">
            {metrics.slice(0, 20).map((m) => (
              <li
                key={m.id}
                className="md-list-row justify-between rounded-md border border-border/60 px-3 py-2.5 text-sm"
              >
                <div className="min-w-0">
                  <p className="font-medium">{m.label ?? m.key}</p>
                  <p className="text-xs text-muted-foreground">{formatDate(m.recordedAt)}</p>
                </div>
                <span className="tabular-nums font-medium">
                  {m.value}
                  {m.unit ? ` ${m.unit}` : ""}
                </span>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
