"use client";

import { useState } from "react";
import { Plus } from "lucide-react";
import { apiPost } from "@/lib/api-client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

const taskTypes = ["TAX", "FILING", "CONTRACT", "REVIEW", "DEADLINE", "COMPLIANCE", "OTHER"] as const;

interface LegalTaskFormProps {
  onCreated?: () => void;
}

export function LegalTaskForm({ onCreated }: LegalTaskFormProps) {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [type, setType] = useState<(typeof taskTypes)[number]>("DEADLINE");
  const [dueDate, setDueDate] = useState("");
  const [loading, setLoading] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) return;
    setLoading(true);
    try {
      await apiPost("/legal/tasks", {
        title: title.trim(),
        description: description.trim() || undefined,
        type,
        dueDate: dueDate || undefined,
      });
      setTitle("");
      setDescription("");
      setDueDate("");
      onCreated?.();
    } finally {
      setLoading(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Plus className="h-4 w-4 text-teal-400" />
          New legal task
        </CardTitle>
      </CardHeader>
      <CardContent>
        <form onSubmit={(e) => void submit(e)} className="space-y-4">
          <Input placeholder="Task title" value={title} onChange={(e) => setTitle(e.target.value)} required />
          <Textarea
            placeholder="Description (optional)"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={3}
          />
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className="mb-1.5 block text-xs text-muted-foreground">Type</label>
              <select
                value={type}
                onChange={(e) => setType(e.target.value as (typeof taskTypes)[number])}
                className="flex h-10 w-full rounded-md border border-input bg-muted/30 px-3 text-sm focus-ring"
              >
                {taskTypes.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="mb-1.5 block text-xs text-muted-foreground">Due date</label>
              <Input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
            </div>
          </div>
          <Button type="submit" disabled={loading}>
            {loading ? "Creating..." : "Add task"}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
