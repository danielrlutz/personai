"use client";

import { useState } from "react";
import { Send, Trash2, MessageSquare } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { PersonaToggle, type AdvisorPersona } from "./PersonaToggle";
import { StreamingMessage } from "./StreamingMessage";
import { useChatStream } from "./useChatStream";
import { EmptyState } from "@/components/shared/EmptyState";

export function AdvisorChat() {
  const [persona, setPersona] = useState<AdvisorPersona>("COMBINED");
  const [input, setInput] = useState("");
  const { messages, streaming, error, sendMessage, clear } = useChatStream({ persona });

  const handleSend = () => {
    if (!input.trim()) return;
    void sendMessage(input);
    setInput("");
  };

  return (
    <Card className="flex h-[calc(100vh-12rem)] flex-col">
      <CardHeader className="shrink-0 space-y-4 border-b border-border pb-4">
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2 text-base">
            <MessageSquare className="h-4 w-4 text-teal-400" />
            Finance Advisor
          </CardTitle>
          <Button variant="ghost" size="sm" onClick={clear} disabled={streaming || messages.length === 0}>
            <Trash2 className="mr-1 h-4 w-4" />
            Clear
          </Button>
        </div>
        <PersonaToggle value={persona} onChange={setPersona} disabled={streaming} />
      </CardHeader>

      <CardContent className="flex flex-1 flex-col overflow-hidden p-0">
        <div className="flex-1 space-y-4 overflow-y-auto p-6">
          {messages.length === 0 ? (
            <EmptyState
              icon={MessageSquare}
              title="Start a conversation"
              description="Ask about budget, QR bills, legal deadlines, or Swiss freelancer compliance."
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
          {error && <p className="text-sm text-red-400">{error}</p>}
        </div>

        <div className="shrink-0 border-t border-border p-4">
          <div className="flex gap-2">
            <Textarea
              placeholder="Ask your advisor..."
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
              className="resize-none"
            />
            <Button onClick={handleSend} disabled={streaming || !input.trim()} size="icon" className="shrink-0">
              <Send className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
