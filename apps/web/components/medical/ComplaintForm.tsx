"use client";

import { useState } from "react";
import { HeartPulse, Sparkles } from "lucide-react";
import { apiPost } from "@/lib/api-client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

const categories = ["PHYSICAL", "PSYCHOLOGICAL", "BOTH"] as const;
const severities = ["MILD", "MODERATE", "SEVERE"] as const;

interface ComplaintFormProps {
  onCreated?: () => void;
}

export function ComplaintForm({ onCreated }: ComplaintFormProps) {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [category, setCategory] = useState<(typeof categories)[number]>("PHYSICAL");
  const [severity, setSeverity] = useState<(typeof severities)[number]>("MILD");
  const [bodyRegion, setBodyRegion] = useState("");
  const [moodScore, setMoodScore] = useState("");
  const [sleepHours, setSleepHours] = useState("");
  const [occurredAt, setOccurredAt] = useState(new Date().toISOString().slice(0, 16));
  const [loading, setLoading] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim() || !description.trim()) return;
    setLoading(true);
    try {
      await apiPost("/medical/complaints", {
        title: title.trim(),
        description: description.trim(),
        category,
        severity,
        bodyRegion: bodyRegion.trim() || undefined,
        moodScore: moodScore ? Number(moodScore) : undefined,
        sleepHours: sleepHours ? Number(sleepHours) : undefined,
        occurredAt: new Date(occurredAt).toISOString(),
      });
      setTitle("");
      setDescription("");
      setBodyRegion("");
      setMoodScore("");
      setSleepHours("");
      onCreated?.();
    } finally {
      setLoading(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <HeartPulse className="h-4 w-4 text-teal-400" />
          Log complaint
        </CardTitle>
      </CardHeader>
      <CardContent>
        <form onSubmit={(e) => void submit(e)} className="space-y-4">
          <Input placeholder="Title" value={title} onChange={(e) => setTitle(e.target.value)} required />
          <Textarea
            placeholder="Describe symptoms, mood, or triggers..."
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={4}
            required
          />
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className="mb-1.5 block text-xs text-muted-foreground">Category</label>
              <select
                value={category}
                onChange={(e) => setCategory(e.target.value as (typeof categories)[number])}
                className="flex h-10 w-full rounded-md border border-input bg-muted/30 px-3 text-sm focus-ring"
              >
                {categories.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="mb-1.5 block text-xs text-muted-foreground">Severity</label>
              <select
                value={severity}
                onChange={(e) => setSeverity(e.target.value as (typeof severities)[number])}
                className="flex h-10 w-full rounded-md border border-input bg-muted/30 px-3 text-sm focus-ring"
              >
                {severities.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </div>
            <Input placeholder="Body region" value={bodyRegion} onChange={(e) => setBodyRegion(e.target.value)} />
            <Input
              type="datetime-local"
              value={occurredAt}
              onChange={(e) => setOccurredAt(e.target.value)}
            />
            <Input
              type="number"
              min={1}
              max={10}
              placeholder="Mood (1-10)"
              value={moodScore}
              onChange={(e) => setMoodScore(e.target.value)}
            />
            <Input
              type="number"
              step={0.5}
              placeholder="Sleep hours"
              value={sleepHours}
              onChange={(e) => setSleepHours(e.target.value)}
            />
          </div>
          <Button type="submit" disabled={loading}>
            {loading ? "Saving..." : "Save complaint"}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
