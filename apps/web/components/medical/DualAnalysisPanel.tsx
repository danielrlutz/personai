"use client";

import { useCallback, useEffect, useState } from "react";
import { Brain, Leaf } from "lucide-react";
import { apiGet, type ComplaintLog } from "@/lib/api-client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { ApiLoadError } from "@/components/shared/ApiLoadError";

export function DualAnalysisPanel() {
  const [complaints, setComplaints] = useState<ComplaintLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    setLoading(true);
    try {
      const data = await apiGet<{ complaints: ComplaintLog[] }>("/medical/complaints");
      setComplaints(data.complaints.filter((c) => (c.analyses?.length ?? 0) > 0));
    } catch (err) {
      setComplaints([]);
      setError(err instanceof Error ? err.message : "Failed to load analyses");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  if (loading) return <Skeleton className="h-64 rounded-lg" />;

  if (error) {
    return (
      <Card>
        <CardContent className="pt-6">
          <ApiLoadError message={error} onRetry={() => void load()} />
        </CardContent>
      </Card>
    );
  }

  const latest = complaints[0];
  const western = latest?.analyses?.find((a) => a.framework === "WESTERN");
  const eastern = latest?.analyses?.find((a) => a.framework === "EASTERN");

  if (!latest) {
    return (
      <Card>
        <CardContent className="py-12 text-center text-sm text-muted-foreground">
          Run dual analysis on a complaint to see Western vs Eastern perspectives.
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Brain className="h-4 w-4 text-blue-400" />
            Western analysis
          </CardTitle>
        </CardHeader>
        <CardContent>
          {western ? (
            <>
              <p className="whitespace-pre-wrap text-sm text-muted-foreground">{western.result}</p>
              <p className="mt-4 text-xs text-amber-400/80">{western.disclaimer}</p>
            </>
          ) : (
            <p className="text-sm text-muted-foreground">No Western analysis yet.</p>
          )}
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Leaf className="h-4 w-4 text-emerald-400" />
            Eastern analysis
          </CardTitle>
        </CardHeader>
        <CardContent>
          {eastern ? (
            <>
              <p className="whitespace-pre-wrap text-sm text-muted-foreground">{eastern.result}</p>
              <p className="mt-4 text-xs text-amber-400/80">{eastern.disclaimer}</p>
            </>
          ) : (
            <p className="text-sm text-muted-foreground">No Eastern analysis yet.</p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
