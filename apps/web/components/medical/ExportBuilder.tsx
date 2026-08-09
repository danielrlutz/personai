"use client";

import { useEffect, useState } from "react";
import { FileDown } from "lucide-react";
import { apiGet, apiUrl, getProfileId } from "@/lib/api-client";
import type { ComplaintLog } from "@/lib/api-client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export function ExportBuilder() {
  const [complaints, setComplaints] = useState<ComplaintLog[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [title, setTitle] = useState("Medical Report");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void apiGet<{ complaints: ComplaintLog[] }>("/medical/complaints")
      .then((data) => {
        setComplaints(data.complaints);
        if (data.complaints.length) {
          const dates = data.complaints.map((c) => c.occurredAt).sort();
          setDateFrom(dates[0]?.slice(0, 10) ?? "");
          setDateTo(dates[dates.length - 1]?.slice(0, 10) ?? "");
        }
      })
      .catch((err) => {
        setComplaints([]);
        setError(err instanceof Error ? err.message : "Failed to load symptom entries");
      });
  }, []);

  const toggle = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const exportPdf = async () => {
    if (selected.size === 0 || !dateFrom || !dateTo) return;
    setLoading(true);
    setError(null);
    try {
      const analysisIds = complaints
        .filter((c) => selected.has(c.id))
        .flatMap((c) => c.analyses?.map((a) => a.id) ?? []);

      const res = await fetch(apiUrl("/medical/export"), {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(getProfileId() ? { "X-Profile-Id": getProfileId()! } : {}),
        },
        body: JSON.stringify({
          title,
          dateRangeFrom: dateFrom,
          dateRangeTo: dateTo,
          complaintIds: Array.from(selected),
          analysisIds,
        }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error((err as { error?: string }).error ?? "Export failed");
      }

      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `medical-report-${Date.now()}.pdf`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Export failed");
    } finally {
      setLoading(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <FileDown className="h-4 w-4 text-primary" />
          Export medical report
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <Input placeholder="Report title" value={title} onChange={(e) => setTitle(e.target.value)} />
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className="mb-1.5 block text-xs text-muted-foreground">From</label>
            <Input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} />
          </div>
          <div>
            <label className="mb-1.5 block text-xs text-muted-foreground">To</label>
            <Input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} />
          </div>
        </div>

        <div className="max-h-48 space-y-2 overflow-y-auto rounded-lg border border-border p-3">
          {complaints.map((c) => (
            <label key={c.id} className="flex cursor-pointer items-center gap-3 rounded-md p-2 hover:bg-muted/20">
              <input
                type="checkbox"
                checked={selected.has(c.id)}
                onChange={() => toggle(c.id)}
                className="rounded border-border"
              />
              <span className="text-sm">
                {c.title} — {c.occurredAt.slice(0, 10)}
              </span>
            </label>
          ))}
          {complaints.length === 0 && (
            <p className="py-4 text-center text-sm text-muted-foreground">No symptom entries to export.</p>
          )}
        </div>

        {error && <p className="text-sm text-red-400">{error}</p>}

        <Button onClick={() => void exportPdf()} disabled={loading || selected.size === 0}>
          {loading ? "Generating PDF..." : "Download PDF"}
        </Button>
      </CardContent>
    </Card>
  );
}
