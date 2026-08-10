"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getProfileId } from "@/lib/api-client";
import { getOutbox, type OutboxEvent, type OutboxOp, type TeamChatPayload } from "@/lib/outbox";

export type ChatMessageStatus = "sent" | "pending" | "failed";

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  status?: ChatMessageStatus;
  error?: string;
  /** Outbox op id for retry/dismiss of unsent user messages */
  outboxOpId?: string;
}

interface UseChatStreamOptions {
  specialist: string;
  onSessionId?: (id: string) => void;
}

interface PersistedTranscript {
  messages: ChatMessage[];
  sessionId?: string;
}

const STORAGE_PREFIX = "personai:teamChat:transcript:";

function storageKey(specialist: string): string {
  const profile = getProfileId() ?? "anon";
  return `${STORAGE_PREFIX}${profile}:${specialist}`;
}

function loadTranscript(specialist: string): PersistedTranscript {
  if (typeof window === "undefined") return { messages: [] };
  try {
    const raw = localStorage.getItem(storageKey(specialist));
    if (!raw) return { messages: [] };
    const parsed = JSON.parse(raw) as PersistedTranscript;
    if (!Array.isArray(parsed.messages)) return { messages: [] };
    // Transcript only keeps completed turns — strip ghosts / delivery state.
    const messages = parsed.messages
      .filter((m) => m.role === "user" || (m.role === "assistant" && m.content?.trim()))
      .map((m) =>
        m.role === "user"
          ? { id: m.id, role: "user" as const, content: m.content, status: "sent" as const }
          : { id: m.id, role: "assistant" as const, content: m.content },
      );
    return { messages, sessionId: parsed.sessionId };
  } catch {
    return { messages: [] };
  }
}

function saveTranscript(specialist: string, state: PersistedTranscript): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(storageKey(specialist), JSON.stringify(state));
  } catch {
    // ignore quota
  }
}

function clearTranscript(specialist: string): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.removeItem(storageKey(specialist));
  } catch {
    // ignore
  }
}

function opToUserMessage(op: OutboxOp): ChatMessage {
  const payload = op.payload as TeamChatPayload;
  const status: ChatMessageStatus =
    op.status === "failed" ? "failed" : op.status === "inflight" ? "pending" : "pending";
  return {
    id: payload.clientMessageId,
    role: "user",
    content: payload.message,
    status,
    error: op.lastError,
    outboxOpId: op.id,
  };
}

export function useChatStream({ specialist, onSessionId }: UseChatStreamOptions) {
  const [transcript, setTranscript] = useState<ChatMessage[]>([]);
  const [outboxOps, setOutboxOps] = useState<OutboxOp[]>([]);
  const [streamingContent, setStreamingContent] = useState("");
  const [activeOpId, setActiveOpId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const sessionIdRef = useRef<string | undefined>(undefined);
  const transcriptRef = useRef<ChatMessage[]>([]);
  const clearEpochRef = useRef(0);
  const specialistRef = useRef(specialist);
  const onSessionIdRef = useRef(onSessionId);
  /** Remember payloads for in-flight ops (removed from IDB right after success). */
  const inflightPayloadRef = useRef<Map<string, TeamChatPayload>>(new Map());

  specialistRef.current = specialist;
  onSessionIdRef.current = onSessionId;
  transcriptRef.current = transcript;

  // Load completed transcript when specialist changes.
  useEffect(() => {
    clearEpochRef.current += 1;
    const stored = loadTranscript(specialist);
    setTranscript(stored.messages);
    transcriptRef.current = stored.messages;
    sessionIdRef.current = stored.sessionId;
    setStreamingContent("");
    setActiveOpId(null);
    setError(null);
  }, [specialist]);

  // Persist completed transcript only.
  useEffect(() => {
    saveTranscript(specialist, {
      messages: transcript,
      sessionId: sessionIdRef.current,
    });
  }, [transcript, specialist]);

  // Subscribe to durable outbox for this specialist's unsent chat ops.
  useEffect(() => {
    const outbox = getOutbox();
    const syncOps = (ops: OutboxOp[]) => {
      setOutboxOps(
        ops.filter(
          (op) =>
            op.type === "team-chat" &&
            (op.payload as TeamChatPayload).specialist === specialistRef.current,
        ),
      );
    };

    return outbox.subscribe((event: OutboxEvent) => {
      if (event.kind === "changed") {
        syncOps(event.ops);
        return;
      }
      if (event.kind !== "team-chat-progress") return;

      const epoch = clearEpochRef.current;
      const op = outbox.snapshot().find((o) => o.id === event.opId);
      const cached = inflightPayloadRef.current.get(event.opId);
      const payload =
        event.payload ??
        (op?.payload as TeamChatPayload | undefined) ??
        cached;
      if (payload) inflightPayloadRef.current.set(event.opId, payload);

      const viewingThis =
        !payload || payload.specialist === specialistRef.current;

      if (event.phase === "started") {
        if (!viewingThis || epoch !== clearEpochRef.current) return;
        setActiveOpId(event.opId);
        setStreamingContent("");
        setError(null);
      }
      if (event.phase === "token") {
        if (!viewingThis || epoch !== clearEpochRef.current) return;
        setActiveOpId(event.opId);
        setStreamingContent(event.assistantContent ?? "");
      }
      if (event.phase === "context" && event.sessionId && payload) {
        // Persist session onto that specialist's transcript even if user switched away.
        const existing = loadTranscript(payload.specialist);
        saveTranscript(payload.specialist, {
          messages: existing.messages,
          sessionId: event.sessionId,
        });
        if (viewingThis) {
          sessionIdRef.current = event.sessionId;
          onSessionIdRef.current?.(event.sessionId);
        }
      }
      if (event.phase === "finished" && event.assistantContent?.trim()) {
        const p = payload ?? inflightPayloadRef.current.get(event.opId);
        inflightPayloadRef.current.delete(event.opId);
        if (p) {
          const userMsg: ChatMessage = {
            id: p.clientMessageId,
            role: "user",
            content: p.message,
            status: "sent",
          };
          const assistantMsg: ChatMessage = {
            id: `assistant-${event.opId}`,
            role: "assistant",
            content: event.assistantContent,
          };
          const existing = loadTranscript(p.specialist);
          const already =
            existing.messages.some((m) => m.id === userMsg.id || m.id === assistantMsg.id);
          const nextMessages = already
            ? existing.messages
            : [...existing.messages, userMsg, assistantMsg];
          const nextSession = event.sessionId ?? existing.sessionId;
          saveTranscript(p.specialist, { messages: nextMessages, sessionId: nextSession });

          if (viewingThis && epoch === clearEpochRef.current) {
            if (event.sessionId) {
              sessionIdRef.current = event.sessionId;
              onSessionIdRef.current?.(event.sessionId);
            }
            setTranscript(nextMessages);
            transcriptRef.current = nextMessages;
            setStreamingContent("");
            setActiveOpId(null);
            setError(null);
          }
        } else if (viewingThis) {
          setStreamingContent("");
          setActiveOpId(null);
        }
      }
      if (event.phase === "failed") {
        inflightPayloadRef.current.delete(event.opId);
        if (!viewingThis || epoch !== clearEpochRef.current) return;
        setStreamingContent("");
        setActiveOpId(null);
        setError(event.error ?? "Failed to send");
      }
    });
  }, []);

  const sendMessage = useCallback(
    async (
      text: string,
      options?: {
        image?: File | Blob;
        imageFilename?: string;
        citeFromArchive?: boolean;
      },
    ) => {
      const trimmed = text.trim();
      if (!trimmed && !options?.image) return;
      // Allow queueing even if another chat op is inflight — they stack in outbox.
      setError(null);
      await getOutbox().enqueueTeamChat({
        message: trimmed || (options?.image ? "Please analyze this photo." : ""),
        specialist,
        sessionId: sessionIdRef.current,
        image: options?.image,
        imageFilename: options?.imageFilename,
        citeFromArchive: options?.citeFromArchive,
      });
    },
    [specialist],
  );

  const retryMessage = useCallback(async (messageId: string) => {
    const op =
      outboxOps.find((o) => o.id === messageId) ??
      outboxOps.find((o) => (o.payload as TeamChatPayload).clientMessageId === messageId);
    if (!op) return;
    setError(null);
    await getOutbox().retry(op.id);
  }, [outboxOps]);

  const clear = useCallback(() => {
    clearEpochRef.current += 1;
    setTranscript([]);
    transcriptRef.current = [];
    sessionIdRef.current = undefined;
    setStreamingContent("");
    setActiveOpId(null);
    setError(null);
    clearTranscript(specialist);
    void getOutbox().dismissTeamChat(specialist);
  }, [specialist]);

  const streaming = Boolean(activeOpId) || outboxOps.some((o) => o.status === "inflight");

  const messages = useMemo(() => {
    const sent = transcript.map((m) =>
      m.role === "user" ? { ...m, status: "sent" as const } : m,
    );

    // Unsent / in-flight from durable outbox — always after sent.
    const unsent: ChatMessage[] = [];
    for (const op of outboxOps) {
      const user = opToUserMessage(op);
      unsent.push(user);
      if (op.status === "inflight" && op.id === activeOpId) {
        // Show advisor only while streaming with content or cursor — never an empty ghost after failure.
        unsent.push({
          id: `assistant-stream-${op.id}`,
          role: "assistant",
          content: streamingContent,
        });
      }
    }

    return [...sent, ...unsent];
  }, [transcript, outboxOps, activeOpId, streamingContent]);

  return {
    messages,
    streaming,
    error,
    sendMessage,
    retryMessage,
    clear,
  };
}
