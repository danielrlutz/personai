"use client";

import { useEffect, useState } from "react";
import { Send, Trash2, Users } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { StreamingMessage } from "@/components/advisor/StreamingMessage";
import { useChatStream } from "@/components/advisor/useChatStream";
import { EmptyState } from "@/components/shared/EmptyState";
import { SpecialistPicker } from "./SpecialistPicker";
import { CareerPdfPanel } from "./CareerPdfPanel";
import { apiGet } from "@/lib/api-client";
import { SPECIALIST_FALLBACK, type SpecialistMeta } from "@/lib/specialists";

interface TeamChatProps {
  initialSpecialist?: string;
}

export function TeamChat({ initialSpecialist = "secretary" }: TeamChatProps) {
  const [specialists, setSpecialists] = useState<SpecialistMeta[]>(SPECIALIST_FALLBACK);
  const [specialist, setSpecialist] = useState(initialSpecialist);
  const [input, setInput] = useState("");
  const { messages, streaming, error, sendMessage, clear } = useChatStream({ specialist });
  const showCareerPdf = specialist === "career_strategist";

  useEffect(() => {
    void apiGet<{ specialists: SpecialistMeta[] }>("/specialists")
      .then((data) => {
        if (data.specialists?.length) setSpecialists(data.specialists);
      })
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    if (initialSpecialist) setSpecialist(initialSpecialist);
  }, [initialSpecialist]);

  const active = specialists.find((s) => s.id === specialist) ?? specialists[0];

  const handleSend = () => {
    if (!input.trim()) return;
    void sendMessage(input);
    setInput("");
  };

  return (
    <div
      className={
        showCareerPdf
          ? "grid min-w-0 gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,320px)]"
          : "min-w-0"
      }
    >
      <Card className="flex h-[calc(100dvh-11.5rem)] min-h-[22rem] min-w-0 flex-col overflow-hidden md:h-[calc(100dvh-8.5rem)]">
        <CardHeader className="shrink-0 space-y-3 border-b border-border/80 pb-4">
          <div className="flex items-center justify-between gap-3">
            <CardTitle className="flex min-w-0 items-center gap-2">
              <Users className="h-4 w-4 shrink-0 text-primary" />
              <span className="truncate">Pocket team</span>
            </CardTitle>
            <Button variant="ghost" size="sm" onClick={clear} disabled={streaming || messages.length === 0} className="shrink-0">
              <Trash2 className="h-4 w-4" />
              Clear
            </Button>
          </div>
          <SpecialistPicker
            specialists={specialists}
            value={specialist}
            onChange={(id) => {
              setSpecialist(id);
              clear();
            }}
            disabled={streaming}
          />
          {active ? (
            <p className="text-xs text-muted-foreground break-words">
              <span className="text-foreground">{active.label}</span> — {active.description}
            </p>
          ) : null}
        </CardHeader>

        <CardContent className="flex min-h-0 flex-1 flex-col overflow-hidden p-0">
          <div className="min-h-0 flex-1 space-y-3 overflow-y-auto overflow-x-hidden p-5">
            {messages.length === 0 ? (
              <EmptyState
                icon={Users}
                title="Ask your pocket team"
                description="Staff routes everyday requests. Switch to CFO, Legal, Forge↔QA, Career, or coaching modes when you need a specialist."
              />
            ) : (
              messages.map((msg, i) => (
                <StreamingMessage
                  key={msg.id}
                  role={msg.role}
                  content={msg.content}
                  streaming={streaming && i === messages.length - 1 && msg.role === "assistant"}
                />
              ))
            )}
            {error && <p className="break-words text-sm text-destructive">{error}</p>}
          </div>

          <div className="shrink-0 border-t border-border/80 p-4">
            <div className="flex min-w-0 gap-2">
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
                disabled={streaming}
                className="min-w-0 flex-1 resize-none"
              />
              <Button onClick={handleSend} disabled={streaming || !input.trim()} size="icon" className="shrink-0">
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
