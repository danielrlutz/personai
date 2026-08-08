"use client";

import { useCallback, useEffect, useState } from "react";
import { NotebookPen, Pin, Plus } from "lucide-react";
import { apiGet, apiPatch, apiPost, type PersonalNote } from "@/lib/api-client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/shared/EmptyState";
import { ApiLoadError } from "@/components/shared/ApiLoadError";
import { formatDate } from "@/lib/utils";

interface NotePanelProps {
  refreshKey?: number;
  onChanged?: () => void;
}

export function NotePanel({ refreshKey = 0, onChanged }: NotePanelProps) {
  const [notes, setNotes] = useState<PersonalNote[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    try {
      const data = await apiGet<{ notes: PersonalNote[] }>("/life/notes");
      setNotes(data.notes);
    } catch (err) {
      setNotes([]);
      setError(err instanceof Error ? err.message : "Failed to load notes");
    }
  }, []);

  useEffect(() => {
    setLoading(true);
    void load().finally(() => setLoading(false));
  }, [load, refreshKey]);

  const create = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!body.trim()) return;
    setSaving(true);
    try {
      await apiPost("/life/notes", {
        title: title.trim() || undefined,
        body: body.trim(),
      });
      setTitle("");
      setBody("");
      await load();
      onChanged?.();
    } finally {
      setSaving(false);
    }
  };

  const togglePin = async (note: PersonalNote) => {
    await apiPatch(`/life/notes/${note.id}`, { pinned: !note.pinned });
    await load();
    onChanged?.();
  };

  if (loading) return <Skeleton className="h-72 rounded-lg" />;

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-base">
          <NotebookPen className="h-4 w-4 text-primary" />
          Personal notes
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <form onSubmit={(e) => void create(e)} className="space-y-2">
          <Input
            placeholder="Title (optional)"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
          />
          <Textarea
            placeholder="Note body"
            value={body}
            onChange={(e) => setBody(e.target.value)}
            rows={3}
            required
          />
          <Button type="submit" disabled={saving}>
            <Plus className="h-4 w-4" />
            Add note
          </Button>
        </form>

        {error ? (
          <ApiLoadError message={error} onRetry={() => void load()} />
        ) : notes.length === 0 ? (
          <EmptyState
            icon={NotebookPen}
            title="No notes yet"
            description="Jot personal reminders and reflections — the panel stays empty until you write something."
          />
        ) : (
          <ul className="space-y-2">
            {notes.map((note) => (
              <li
                key={note.id}
                className="rounded-md border border-border/60 px-3 py-2.5"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    {note.title && <p className="truncate text-sm font-medium">{note.title}</p>}
                    <p className="mt-0.5 whitespace-pre-wrap text-sm text-muted-foreground">
                      {note.body}
                    </p>
                    <p className="mt-1.5 text-xs text-muted-foreground">
                      Updated {formatDate(note.updatedAt)}
                    </p>
                  </div>
                  <Button variant="ghost" size="icon" onClick={() => void togglePin(note)}>
                    <Pin className={`h-4 w-4 ${note.pinned ? "text-primary" : "text-muted-foreground"}`} />
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
