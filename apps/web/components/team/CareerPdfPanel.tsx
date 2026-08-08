"use client";

import { useState } from "react";
import { FileText } from "lucide-react";
import { getApiBaseUrl, getProfileId } from "@/lib/api-client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { ConfirmGate } from "@/components/confirm/ConfirmGate";

export function CareerPdfPanel() {
  const [title, setTitle] = useState("Curriculum Vitae");
  const [subtitle, setSubtitle] = useState("");
  const [body, setBody] = useState("");
  const [loading, setLoading] = useState(false);
  const [awaiting, setAwaiting] = useState(false);
  const [gateKey, setGateKey] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const generate = async (confirmed: boolean) => {
    if (!title.trim() || !body.trim()) return;
    setLoading(true);
    setError(null);
    try {
      const sections = body
        .split(/\n{2,}/)
        .map((block) => {
          const lines = block.trim().split("\n");
          const heading = lines[0] ?? "Section";
          const sectionBody = lines.slice(1).join("\n").trim() || heading;
          return { heading, body: sectionBody };
        })
        .filter((s) => s.heading);

      const res = await fetch(`${getApiBaseUrl()}/career/pdf`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(getProfileId() ? { "X-Profile-Id": getProfileId()! } : {}),
        },
        body: JSON.stringify({ title, subtitle: subtitle || undefined, sections, confirmed }),
      });

      if (res.status === 202) {
        setAwaiting(true);
        setGateKey((k) => k + 1);
        return;
      }
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error((err as { error?: string }).error ?? "PDF failed");
      }

      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `career-${Date.now()}.pdf`;
      a.click();
      URL.revokeObjectURL(url);
      setAwaiting(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "PDF failed");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-3">
      <ConfirmGate
        refreshKey={gateKey}
        compact
        onResolved={(d) => {
          if (d === "confirm" && awaiting) void generate(true);
          if (d === "reject") setAwaiting(false);
        }}
      />
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-base">
            <FileText className="h-4 w-4 text-primary" />
            Career PDF
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Title" />
          <Input
            value={subtitle}
            onChange={(e) => setSubtitle(e.target.value)}
            placeholder="Subtitle (optional)"
          />
          <Textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            rows={6}
            placeholder={"Experience\nRole details…\n\nEducation\n…"}
            className="resize-none"
          />
          {error ? <p className="text-sm text-destructive">{error}</p> : null}
          <Button
            size="sm"
            disabled={loading || !title.trim() || !body.trim()}
            onClick={() => void generate(false)}
          >
            {loading ? "Working…" : "Request PDF"}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
