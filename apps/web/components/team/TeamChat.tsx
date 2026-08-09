"use client";

import { useEffect, useState } from "react";
import { BookmarkPlus, Send, Trash2, Users } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { StreamingMessage } from "@/components/advisor/StreamingMessage";
import { useChatStream } from "@/components/advisor/useChatStream";
import { EmptyState } from "@/components/shared/EmptyState";
import { SpecialistPicker } from "./SpecialistPicker";
import { CareerPdfPanel } from "./CareerPdfPanel";
import { apiGet, apiPost, type MemoryFact } from "@/lib/api-client";
import { SPECIALIST_FALLBACK, type SpecialistMeta } from "@/lib/specialists";
import { toast } from "@/lib/toast";

interface TeamChatProps {
  initialSpecialist?: string;
}

export function TeamChat({ initialSpecialist = "secretary" }: TeamChatProps) {
  const [specialists, setSpecialists] = useState<SpecialistMeta[]>(SPECIALIST_FALLBACK);
  const [specialist, setSpecialist] = useState(initialSpecialist);
  const [input, setInput] = useState("");
  const [showRemember, setShowRemember] = useState(false);
  const [rememberKey, setRememberKey] = useState("");
  const [rememberValue, setRememberValue] = useState("");
  const [rememberNote, setRememberNote] = useState<string | null>(null);
  const [rememberSaving, setRememberSaving] = useState(false);
  const { messages, streaming, error, sendMessage, retryMessage, clear } = useChatStream({
    specialist,
  });
  const showCareerPdf = specialist === "career_strategist";

  useEffect(() => {
    void apiGet<{ specialists: SpecialistMeta[] }>("/specialists", { silent: true })
      .then((data) => {
        if (data.specialists?.length) setSpecialists(data.specialists);
      })
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    if (initialSpecialist) setSpecialist(initialSpecialist);
  }, [initialSpecialist]);

  const active = specialists.find((s) => s.id === specialist) ?? specialists[0];
  const hasUnsent = messages.some((m) => m.role === "user" && m.status !== "sent");

  const handleSend = () => {
    if (!input.trim()) return;
    void sendMessage(input).catch((err) => {
      toast.error(err instanceof Error ? err.message : "Could not queue message", {
        title: "Message failed to send",
        sticky: true,
      });
    });
    setInput("");
  };

  const openRemember = () => {
    const lastUser = [...messages].reverse().find((m) => m.role === "user" && m.content.trim());
    setRememberKey("");
    setRememberValue(lastUser?.content.trim().slice(0, 500) ?? input.trim().slice(0, 500));
    setRememberNote(null);
    setShowRemember((v) => !v);
  };

  const saveRemember = async () => {
    if (!rememberKey.trim() || !rememberValue.trim()) return;
    setRememberSaving(true);
    setRememberNote(null);
    try {
      await apiPost<MemoryFact>("/memory-facts", {
        key: rememberKey.trim(),
        value: rememberValue.trim(),
        source: "team-chat",
        specialistId: specialist,
      });
      setRememberNote("Saved to memory.");
      setShowRemember(false);
      setRememberKey("");
      setRememberValue("");
    } catch (err) {
      setRememberNote(err instanceof Error ? err.message : "Failed to remember");
    } finally {
      setRememberSaving(false);
    }
  };

  return (
    <div
      className={
        showCareerPdf
          ? "grid min-w-0 gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,320px)]"
          : "min-w-0"
      }
    >
      <Card className="flex h-[calc(100dvh-12rem)] min-h-[22rem] min-w-0 flex-col overflow-hidden hover:shadow-elev-2 md:h-[calc(100dvh-9rem)]">
        <CardHeader className="shrink-0 space-y-3.5 border-b border-border/60 pb-4">
          <div className="flex items-center justify-between gap-3">
            <CardTitle className="flex min-w-0 items-center gap-2.5">
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary-container">
                <Users className="h-4 w-4 text-primary-on-container" />
              </span>
              <span className="truncate">Pocket team</span>
            </CardTitle>
            <div className="flex shrink-0 items-center gap-1">
              <Button variant="ghost" size="sm" onClick={openRemember} disabled={streaming}>
                <BookmarkPlus className="h-4 w-4" />
                Remember
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={clear}
                disabled={streaming || (messages.length === 0 && !hasUnsent)}
              >
                <Trash2 className="h-4 w-4" />
                Clear
              </Button>
            </div>
          </div>
          <SpecialistPicker
            specialists={specialists}
            value={specialist}
            onChange={setSpecialist}
            disabled={streaming}
          />
          {active ? (
            <p className="text-xs leading-relaxed text-muted-foreground break-words">
              <span className="font-medium text-foreground">{active.label}</span> — {active.description}
            </p>
          ) : null}
        </CardHeader>

        <CardContent className="flex min-h-0 flex-1 flex-col overflow-hidden p-0">
          <div className="min-h-0 flex-1 space-y-3.5 overflow-y-auto overflow-x-hidden p-5">
            {messages.length === 0 ? (
              <EmptyState
                icon={Users}
                title="Ask your pocket team"
                description="Staff handles everyday requests. Switch to CFO, Legal, coding, Career, or coaching when you need a specialist."
              />
            ) : (
              messages.map((msg, i) => {
                const isStreamingAssistant =
                  streaming &&
                  msg.role === "assistant" &&
                  i === messages.length - 1 &&
                  messages[i - 1]?.status === "pending";
                // Never render an empty advisor bubble except while actively streaming.
                if (msg.role === "assistant" && !msg.content.trim() && !isStreamingAssistant) {
                  return null;
                }
                return (
                  <StreamingMessage
                    key={msg.id}
                    role={msg.role}
                    content={msg.content}
                    streaming={isStreamingAssistant}
                    status={msg.status}
                    error={msg.error}
                    onRetry={
                      msg.role === "user" && msg.status === "failed"
                        ? () => void retryMessage(msg.outboxOpId ?? msg.id)
                        : undefined
                    }
                  />
                );
              })
            )}
            {error && !hasUnsent ? (
              <p className="break-words text-sm text-destructive">{error}</p>
            ) : null}
          </div>

          <div className="shrink-0 border-t border-border/60 bg-surface-container/30 p-4">
            {showRemember ? (
              <div className="mb-3 animate-scale-in space-y-2 rounded-xl border border-border/70 bg-card/80 p-3.5">
                <p className="text-xs text-muted-foreground">
                  Save a short fact for future chats and the morning brief — not the full conversation.
                </p>
                <Input
                  value={rememberKey}
                  onChange={(e) => setRememberKey(e.target.value)}
                  placeholder="Label (e.g. preferred IBAN)"
                />
                <Textarea
                  value={rememberValue}
                  onChange={(e) => setRememberValue(e.target.value)}
                  placeholder="Value to remember"
                  rows={2}
                  className="resize-none"
                />
                <div className="flex flex-wrap gap-2">
                  <Button
                    size="sm"
                    onClick={() => void saveRemember()}
                    disabled={rememberSaving || !rememberKey.trim() || !rememberValue.trim()}
                  >
                    {rememberSaving ? "Saving…" : "Save fact"}
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => setShowRemember(false)}>
                    Cancel
                  </Button>
                </div>
                {rememberNote ? <p className="text-xs text-muted-foreground">{rememberNote}</p> : null}
              </div>
            ) : rememberNote ? (
              <p className="mb-2 text-xs text-muted-foreground">{rememberNote}</p>
            ) : null}
            <div className="flex min-w-0 items-end gap-2">
              <Textarea
                placeholder={`Message ${active?.shortLabel ?? "Staff"}…`}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    handleSend();
                  }
                }}
                rows={2}
                className="min-w-0 flex-1 resize-none"
              />
              <Button onClick={handleSend} disabled={!input.trim()} size="icon" className="shrink-0">
                <Send className="h-4 w-4" />
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>
      {showCareerPdf ? <CareerPdfPanel /> : null}
    </div>
  );
}
