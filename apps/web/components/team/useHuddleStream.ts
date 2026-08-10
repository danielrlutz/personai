"use client";

import { useCallback, useRef, useState } from "react";
import { getProfileId, streamSSE } from "@/lib/api-client";
import { describeApiFailure, describeStreamError } from "@/lib/api-errors";

export type HuddleTurnMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  speakerLabel?: string;
  specialistId?: string;
};

const STORAGE_PREFIX = "personai:teamChat:transcript:";

function huddleStorageKey(): string {
  const profile = getProfileId() ?? "anon";
  return `${STORAGE_PREFIX}${profile}:huddle`;
}

function loadHuddleTranscript(): { messages: HuddleTurnMessage[]; sessionId?: string } {
  if (typeof window === "undefined") return { messages: [] };
  try {
    const raw = localStorage.getItem(huddleStorageKey());
    if (!raw) return { messages: [] };
    const parsed = JSON.parse(raw) as { messages?: HuddleTurnMessage[]; sessionId?: string };
    if (!Array.isArray(parsed.messages)) return { messages: [] };
    return {
      messages: parsed.messages.filter((m) => m.role === "user" || Boolean(m.content?.trim())),
      sessionId: parsed.sessionId,
    };
  } catch {
    return { messages: [] };
  }
}

function saveHuddleTranscript(messages: HuddleTurnMessage[], sessionId?: string): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(huddleStorageKey(), JSON.stringify({ messages, sessionId }));
  } catch {
    /* ignore quota */
  }
}

export function useHuddleStream() {
  const initial =
    typeof window !== "undefined" ? loadHuddleTranscript() : { messages: [] as HuddleTurnMessage[] };
  const [messages, setMessages] = useState<HuddleTurnMessage[]>(initial.messages);
  const [streaming, setStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeSpeaker, setActiveSpeaker] = useState<string | null>(null);
  const [confirmCount, setConfirmCount] = useState(0);
  const sessionIdRef = useRef<string | undefined>(initial.sessionId);
  const abortEpoch = useRef(0);
  const turnIdBySpecialist = useRef<Map<string, string>>(new Map());

  const persist = useCallback((next: HuddleTurnMessage[]) => {
    saveHuddleTranscript(next, sessionIdRef.current);
    return next;
  }, []);

  const clear = useCallback(() => {
    abortEpoch.current += 1;
    setMessages([]);
    setStreaming(false);
    setError(null);
    setActiveSpeaker(null);
    setConfirmCount(0);
    sessionIdRef.current = undefined;
    turnIdBySpecialist.current.clear();
    try {
      localStorage.removeItem(huddleStorageKey());
    } catch {
      /* ignore */
    }
  }, []);

  const runHuddle = useCallback(
    async (message: string, specialists: string[]) => {
      const trimmed = message.trim();
      if (!trimmed || streaming) return;

      const epoch = ++abortEpoch.current;
      const guests = specialists.filter(Boolean).slice(0, 2);
      const userMsg: HuddleTurnMessage = {
        id: `huddle-user-${Date.now()}`,
        role: "user",
        content: trimmed,
      };

      setError(null);
      setConfirmCount(0);
      setStreaming(true);
      setActiveSpeaker("Staff");
      turnIdBySpecialist.current.clear();
      setMessages((prev) => persist([...prev, userMsg]));

      let streamError: string | null = null;

      try {
        await streamSSE("/team/huddle/stream", {
          method: "POST",
          silent: true,
          body: {
            message: trimmed,
            specialists: guests,
            sessionId: sessionIdRef.current,
          },
          onEvent: (event, data) => {
            if (epoch !== abortEpoch.current) return;
            const d = (data ?? {}) as Record<string, unknown>;

            if (event === "started" && typeof d.sessionId === "string") {
              sessionIdRef.current = d.sessionId;
            }

            if (event === "turn_start") {
              const specialistId = String(d.specialistId ?? "");
              const label = String(d.label ?? specialistId);
              const id = `huddle-${specialistId}-${String(d.index ?? Date.now())}`;
              turnIdBySpecialist.current.set(specialistId, id);
              setActiveSpeaker(label);
              setMessages((prev) =>
                persist([
                  ...prev,
                  {
                    id,
                    role: "assistant",
                    content: "",
                    speakerLabel: label,
                    specialistId,
                  },
                ]),
              );
            }

            if (event === "token") {
              const specialistId = String(d.specialistId ?? "");
              const token = String(d.token ?? "");
              const id = turnIdBySpecialist.current.get(specialistId);
              if (!id || !token) return;
              setMessages((prev) =>
                prev.map((m) => (m.id === id ? { ...m, content: m.content + token } : m)),
              );
            }

            if (event === "turn_done") {
              const specialistId = String(d.specialistId ?? "");
              const label = String(d.label ?? specialistId);
              const content = String(d.content ?? "");
              const id = turnIdBySpecialist.current.get(specialistId);
              if (!id) return;
              setMessages((prev) =>
                persist(
                  prev.map((m) =>
                    m.id === id
                      ? { ...m, content, speakerLabel: label, specialistId }
                      : m,
                  ),
                ),
              );
            }

            if (event === "confirm_queued") {
              setConfirmCount((n) => n + 1);
            }

            if (event === "done" && typeof d.sessionId === "string") {
              sessionIdRef.current = d.sessionId;
              setMessages((prev) => persist(prev));
            }

            if (event === "error") {
              streamError = describeStreamError(data);
            }
          },
          onError: (err) => {
            streamError = describeApiFailure(err, { path: "/team/huddle/stream" }).message;
          },
        });

        if (epoch !== abortEpoch.current) return;
        if (streamError) setError(streamError);
        else setMessages((prev) => persist(prev));
      } catch (err) {
        if (epoch !== abortEpoch.current) return;
        setError(
          streamError ?? describeApiFailure(err, { path: "/team/huddle/stream" }).message,
        );
      } finally {
        if (epoch === abortEpoch.current) {
          setStreaming(false);
          setActiveSpeaker(null);
        }
      }
    },
    [persist, streaming],
  );

  return {
    messages,
    streaming,
    error,
    activeSpeaker,
    confirmCount,
    runHuddle,
    clear,
  };
}
