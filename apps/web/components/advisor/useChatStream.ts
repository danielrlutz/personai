"use client";

import { useCallback, useRef, useState } from "react";
import { streamSSE } from "@/lib/api-client";
import type { AdvisorPersona } from "./PersonaToggle";

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
}

interface UseChatStreamOptions {
  persona: AdvisorPersona;
  onSessionId?: (id: string) => void;
}

export function useChatStream({ persona, onSessionId }: UseChatStreamOptions) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [streaming, setStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const sessionIdRef = useRef<string | undefined>(undefined);
  const abortRef = useRef<(() => void) | undefined>(undefined);

  const sendMessage = useCallback(
    async (text: string) => {
      if (!text.trim() || streaming) return;

      const userMsg: ChatMessage = {
        id: `user-${Date.now()}`,
        role: "user",
        content: text.trim(),
      };
      const assistantId = `assistant-${Date.now()}`;

      setMessages((prev) => [...prev, userMsg, { id: assistantId, role: "assistant", content: "" }]);
      setStreaming(true);
      setError(null);

      abortRef.current?.();

      try {
        abortRef.current = await streamSSE("/advisor/chat/stream", {
          method: "POST",
          body: {
            message: text.trim(),
            sessionId: sessionIdRef.current,
            persona,
          },
          onEvent: (event, data) => {
            if (event === "context" && typeof data === "object" && data && "sessionId" in data) {
              const sid = String((data as { sessionId: string }).sessionId);
              sessionIdRef.current = sid;
              onSessionId?.(sid);
            }
            if (event === "token" && typeof data === "object" && data && "token" in data) {
              const token = String((data as { token: string }).token);
              setMessages((prev) =>
                prev.map((m) => (m.id === assistantId ? { ...m, content: m.content + token } : m)),
              );
            }
            if (event === "error") {
              const msg =
                typeof data === "object" && data && "message" in data
                  ? String((data as { message: unknown }).message)
                  : "Chat error";
              setError(msg);
            }
          },
          onError: (err) => setError(err.message),
          onDone: () => setStreaming(false),
        });
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to send");
        setStreaming(false);
      }
    },
    [streaming, persona, onSessionId],
  );

  const clear = useCallback(() => {
    abortRef.current?.();
    setMessages([]);
    sessionIdRef.current = undefined;
    setError(null);
  }, []);

  return { messages, streaming, error, sendMessage, clear };
}
