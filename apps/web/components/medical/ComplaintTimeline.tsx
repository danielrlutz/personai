"use client";

import { useEffect, useState } from "react";
import { Activity, Sparkles } from "lucide-react";
import { apiGet, apiPost, type ComplaintLog } from "@/lib/api-client";
import { formatDate, formatRelative } from "@/lib/utils";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/shared/EmptyState";

const severityVariant = {
  MILD: "secondary" as const,
  MODERATE: "warning" as const,
  SEVERE: "destructive" as const,
};

interface ComplaintTimelineProps {
  refreshKey?: number;
}

export function ComplaintTimeline({ refreshKey }: ComplaintTimelineProps) {
  const [complaints, setComplaints] = useState<ComplaintLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [analyzing, setAnalyzing] = useState<string | null>(null);

  const load = () =>
    apiGet<{ complaints: ComplaintLog[] }>("/medical/complaints").then((data) => setComplaints(data.complaints));

  useEffect(() => {
    void load().finally(() => setLoading(false));
  }, [refreshKey]);

  const analyze = async (complaintId: string) => {
    setAnalyzing(complaintId);
    try {
      await apiPost("/medical/analyze", { complaintId });
      await load();
    } finally {
      setAnalyzing(null);
    }
  };

  if (loading) return <Skeleton className="h-96 rounded-lg" />;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Complaint timeline</CardTitle>
      </CardHeader>
      <CardContent>
        {complaints.length === 0 ? (
          <EmptyState icon={Activity} title="No complaints logged" description="Track physical and psychological symptoms over time." />
        ) : (
          <ul className="space-y-4">
            {complaints.map((c) => (
              <li key={c.id} className="rounded-lg border border-border bg-muted/10 p-4">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <p className="font-medium">{c.title}</p>
                    <p className="mt-1 text-sm text-muted-foreground">{c.description}</p>
                    <p className="mt-2 text-xs text-muted-foreground">
                      {formatDate(c.occurredAt)} · {formatRelative(c.occurredAt)}
                      {c.moodScore != null && ` · Mood ${c.moodScore}/10`}
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Badge variant="outline">{c.category}</Badge>
                    <Badge variant={severityVariant[c.severity]}>{c.severity}</Badge>
                  </div>
                </div>
                <div className="mt-3 flex items-center gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => void analyze(c.id)}
                    disabled={analyzing === c.id}
                  >
                    <Sparkles className="mr-1 h-3 w-3" />
                    {analyzing === c.id ? "Analyzing..." : "Dual analysis"}
                  </Button>
                  {(c.analyses?.length ?? 0) > 0 && (
                    <span className="text-xs text-teal-400">{c.analyses!.length} analysis(es)</span>
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
