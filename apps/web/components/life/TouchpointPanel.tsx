"use client";

import { useCallback, useEffect, useState } from "react";
import { Plus, Users } from "lucide-react";
import { apiGet, apiPatch, apiPost, type RelationshipTouchpoint } from "@/lib/api-client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/shared/EmptyState";
import { ApiLoadError } from "@/components/shared/ApiLoadError";
import { formatDate } from "@/lib/utils";

interface TouchpointPanelProps {
  refreshKey?: number;
  onChanged?: () => void;
}

export function TouchpointPanel({ refreshKey = 0, onChanged }: TouchpointPanelProps) {
  const [touchpoints, setTouchpoints] = useState<RelationshipTouchpoint[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [contactName, setContactName] = useState("");
  const [relationship, setRelationship] = useState("");
  const [cadenceDays, setCadenceDays] = useState("30");
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    try {
      const data = await apiGet<{ touchpoints: RelationshipTouchpoint[] }>("/life/touchpoints");
      setTouchpoints(data.touchpoints);
    } catch (err) {
      setTouchpoints([]);
      setError(err instanceof Error ? err.message : "Failed to load touchpoints");
    }
  }, []);

  useEffect(() => {
    setLoading(true);
    void load().finally(() => setLoading(false));
  }, [load, refreshKey]);

  const create = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!contactName.trim()) return;
    setSaving(true);
    try {
      await apiPost("/life/touchpoints", {
        contactName: contactName.trim(),
        relationship: relationship.trim() || undefined,
        cadenceDays: Number(cadenceDays) || 30,
      });
      setContactName("");
      setRelationship("");
      setCadenceDays("30");
      await load();
      onChanged?.();
    } finally {
      setSaving(false);
    }
  };

  const markContacted = async (id: string) => {
    await apiPatch(`/life/touchpoints/${id}`, { markContacted: true });
    await load();
    onChanged?.();
  };

  if (loading) return <Skeleton className="h-72 rounded-lg" />;

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-base">
          <Users className="h-4 w-4 text-primary" />
          Relationship touchpoints
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <form onSubmit={(e) => void create(e)} className="grid gap-2 sm:grid-cols-4">
          <Input
            placeholder="Contact name"
            value={contactName}
            onChange={(e) => setContactName(e.target.value)}
            required
          />
          <Input
            placeholder="Relationship"
            value={relationship}
            onChange={(e) => setRelationship(e.target.value)}
          />
          <Input
            type="number"
            min={1}
            placeholder="Cadence (days)"
            value={cadenceDays}
            onChange={(e) => setCadenceDays(e.target.value)}
          />
          <Button type="submit" disabled={saving}>
            <Plus className="h-4 w-4" />
            Add
          </Button>
        </form>

        {error ? (
          <ApiLoadError message={error} onRetry={() => void load()} />
        ) : touchpoints.length === 0 ? (
          <EmptyState
            icon={Users}
            title="No touchpoints yet"
            description="Keep relationship follow-ups honest — add people you actually want to stay in touch with."
          />
        ) : (
          <ul className="space-y-2">
            {touchpoints.map((tp) => (
              <li
                key={tp.id}
                className="md-list-row justify-between rounded-md border border-border/60 px-3 py-2.5"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{tp.contactName}</p>
                  <div className="mt-1 flex flex-wrap gap-1.5 text-xs text-muted-foreground">
                    {tp.relationship && <Badge variant="outline">{tp.relationship}</Badge>}
                    <span>Every {tp.cadenceDays}d</span>
                    {tp.nextDueAt && <span>Next {formatDate(tp.nextDueAt)}</span>}
                    {tp.lastContactedAt && <span>Last {formatDate(tp.lastContactedAt)}</span>}
                  </div>
                </div>
                <Button variant="secondary" size="sm" onClick={() => void markContacted(tp.id)}>
                  Mark contacted
                </Button>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
