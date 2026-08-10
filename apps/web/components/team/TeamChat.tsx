"use client";

import { useEffect, useRef, useState } from "react";
import { BookmarkPlus, ImagePlus, Send, Trash2, Users, X } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { StreamingMessage } from "@/components/advisor/StreamingMessage";
import { useChatStream } from "@/components/advisor/useChatStream";
import { EmptyState } from "@/components/shared/EmptyState";
import { SpecialistPicker } from "./SpecialistPicker";
import { CareerPdfPanel } from "./CareerPdfPanel";
import { ForgeQaPanel } from "./ForgeQaPanel";
import { apiGet, apiPost, type DriveStatus, type MemoryFact } from "@/lib/api-client";
import {
  readChatMarkdownPref,
  writeChatMarkdownPref,
  type ChatMarkdownMode,
} from "@/lib/chat-markdown-pref";
import { SPECIALIST_FALLBACK, type SpecialistMeta } from "@/lib/specialists";
import { toast } from "@/lib/toast";
import Link from "next/link";

interface TeamChatProps {
  initialSpecialist?: string;
  /** Prefill composer (Frist kit / triage deep-link). */
  initialPrompt?: string;
}

const MAX_STYLIST_IMAGE_BYTES = 8 * 1024 * 1024;

export function TeamChat({
  initialSpecialist = "secretary",
  initialPrompt,
}: TeamChatProps) {
  const [specialists, setSpecialists] = useState<SpecialistMeta[]>(SPECIALIST_FALLBACK);
  const [specialist, setSpecialist] = useState(initialSpecialist);
  const [input, setInput] = useState(initialPrompt ?? "");
  const appliedPromptRef = useRef<string | null>(null);
  const [photo, setPhoto] = useState<File | null>(null);
  const [photoPreview, setPhotoPreview] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [showRemember, setShowRemember] = useState(false);
  const [rememberKey, setRememberKey] = useState("");
  const [rememberValue, setRememberValue] = useState("");
  const [rememberNote, setRememberNote] = useState<string | null>(null);
  const [rememberSaving, setRememberSaving] = useState(false);
  const [drive, setDrive] = useState<DriveStatus | null>(null);
  const [markdownMode, setMarkdownMode] = useState<ChatMarkdownMode>("formatted");
  const { messages, streaming, error, sendMessage, retryMessage, clear } = useChatStream({
    specialist,
  });
  const showCareerPdf = specialist === "career_strategist";
  const showForgeQa = specialist === "forge" || specialist === "qa_auditor";
  const showStylistPhoto = specialist === "stylist";
  const showSidePanel = showCareerPdf || showForgeQa;
  const formatted = markdownMode === "formatted";

  useEffect(() => {
    setMarkdownMode(readChatMarkdownPref());
  }, []);

  useEffect(() => {
    void apiGet<{ specialists: SpecialistMeta[] }>("/specialists", { silent: true })
      .then((data) => {
        if (data.specialists?.length) setSpecialists(data.specialists);
      })
      .catch(() => undefined);
    void apiGet<DriveStatus>("/archive/drive", { silent: true })
      .then(setDrive)
      .catch(() => undefined);
  }, []);

  const toggleMarkdownMode = () => {
    setMarkdownMode((prev) => {
      const next: ChatMarkdownMode = prev === "formatted" ? "raw" : "formatted";
      writeChatMarkdownPref(next);
      return next;
    });
  };

  useEffect(() => {
    if (initialSpecialist) setSpecialist(initialSpecialist);
  }, [initialSpecialist]);

  useEffect(() => {
    const prompt = initialPrompt?.trim();
    if (!prompt) return;
    if (appliedPromptRef.current === prompt) return;
    appliedPromptRef.current = prompt;
    setInput(prompt);
  }, [initialPrompt]);

  useEffect(() => {
    // Drop pending photo when leaving Stylist.
    if (specialist !== "stylist") {
      clearPhoto();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only on specialist change
  }, [specialist]);

  useEffect(() => {
    return () => {
      if (photoPreview) URL.revokeObjectURL(photoPreview);
    };
  }, [photoPreview]);

  const active = specialists.find((s) => s.id === specialist) ?? specialists[0];
  const hasUnsent = messages.some((m) => m.role === "user" && m.status !== "sent");

  const clearPhoto = () => {
    setPhoto(null);
    setPhotoPreview((prev) => {
      if (prev) URL.revokeObjectURL(prev);
      return null;
    });
    if (fileRef.current) fileRef.current.value = "";
  };

  const onPickPhoto = (file: File | null) => {
    if (!file) {
      clearPhoto();
      return;
    }
    if (!file.type.startsWith("image/")) {
      toast.error("Please choose a photo (JPEG, PNG, or WebP).", {
        title: "Not an image",
      });
      return;
    }
    if (file.size > MAX_STYLIST_IMAGE_BYTES) {
      toast.error("Keep photos under 8 MB.", { title: "Photo too large" });
      return;
    }
    setPhoto(file);
    setPhotoPreview((prev) => {
      if (prev) URL.revokeObjectURL(prev);
      return URL.createObjectURL(file);
    });
  };

  const handleSend = () => {
    if (!input.trim() && !photo) return;
    void sendMessage(input, photo ? { image: photo, imageFilename: photo.name } : undefined).catch(
      (err) => {
        toast.error(err instanceof Error ? err.message : "Could not queue message", {
          title: "Message failed to send",
          sticky: true,
        });
      },
    );
    setInput("");
    clearPhoto();
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
        showSidePanel
          ? "grid h-full min-h-0 min-w-0 w-full gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(0,320px)] xl:grid-cols-[minmax(0,1fr)_minmax(0,360px)] lg:gap-4"
          : "flex h-full min-h-0 min-w-0 w-full flex-col"
      }
    >
      <Card className="flex h-full min-h-0 min-w-0 w-full flex-col overflow-hidden hover:shadow-elev-2">
        <CardHeader className="shrink-0 space-y-2 border-b border-border/60 p-3 pb-2.5 sm:p-4 sm:pb-3">
          <div className="flex min-w-0 items-center justify-between gap-2 sm:gap-3">
            <CardTitle className="flex min-w-0 items-center gap-2 sm:gap-2.5">
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary-container">
                <Users className="h-4 w-4 text-primary-on-container" />
              </span>
              <span className="min-w-0 truncate">
                {active?.label ?? "Pocket team"}
                {active?.preferredModel ? (
                  <span className="ml-2 hidden font-normal text-muted-foreground sm:inline">
                    · {active.preferredModel}
                  </span>
                ) : null}
              </span>
            </CardTitle>
            <div className="flex shrink-0 items-center gap-0.5 sm:gap-1">
              <Button
                variant="ghost"
                size="sm"
                onClick={toggleMarkdownMode}
                title={formatted ? "Show markdown source" : "Show formatted markdown"}
                aria-pressed={!formatted}
              >
                <span className="sm:hidden">{formatted ? "Raw" : "Fmt"}</span>
                <span className="hidden sm:inline">{formatted ? "View Raw" : "Formatted"}</span>
              </Button>
              <Button variant="ghost" size="sm" onClick={openRemember} disabled={streaming}>
                <BookmarkPlus className="h-4 w-4" />
                <span className="hidden sm:inline">Remember</span>
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  clear();
                  clearPhoto();
                }}
                disabled={streaming || (messages.length === 0 && !hasUnsent && !photo)}
              >
                <Trash2 className="h-4 w-4" />
                <span className="hidden sm:inline">Clear</span>
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
            <p className="truncate text-sm leading-snug text-muted-foreground">{active.description}</p>
          ) : null}
          {drive && !drive.linked ? (
            <p className="rounded-lg border border-border/50 bg-surface-container px-3 py-2 text-sm leading-snug text-muted-foreground">
              No archive context yet.{" "}
              <Link
                href="/settings/?focus=drive"
                className="font-semibold text-primary underline-offset-2 hover:underline"
              >
                Link Google Drive
              </Link>
            </p>
          ) : null}
        </CardHeader>

        <CardContent className="flex min-h-0 flex-1 flex-col overflow-hidden p-0">
          <div className="team-chat-thread min-h-0 flex-1 space-y-3.5 overflow-y-auto overflow-x-hidden overscroll-contain px-3 py-3.5 sm:space-y-4 sm:px-5 sm:py-4">
            {messages.length === 0 ? (
              <EmptyState
                icon={Users}
                title="Ask your pocket team"
                description="Staff handles everyday requests. Switch to Finance, Legal, coding, Career, or coaching when you need a specialist."
                className="py-10 sm:py-14"
              />
            ) : (
              messages.map((msg, i) => {
                const isStreamingAssistant =
                  streaming &&
                  msg.role === "assistant" &&
                  i === messages.length - 1 &&
                  messages[i - 1]?.status === "pending";
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
                    formatted={formatted}
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

          <div className="shrink-0 border-t border-border/60 bg-surface-container/40 p-3 sm:p-3.5">
            {showRemember ? (
              <div className="mb-3 animate-scale-in space-y-2 rounded-xl border border-border/70 bg-card/80 p-3">
                <p className="text-sm text-muted-foreground">
                  Save a short fact for future chats and the morning brief — not the full
                  conversation.
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

            {showStylistPhoto && photoPreview ? (
              <div className="mb-3 flex items-start gap-2">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={photoPreview}
                  alt="Outfit preview"
                  className="h-20 w-20 rounded-lg object-cover"
                />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-xs text-muted-foreground">{photo?.name}</p>
                  <Button size="sm" variant="ghost" className="mt-1 h-7 px-2" onClick={clearPhoto}>
                    <X className="h-3.5 w-3.5" />
                    Remove photo
                  </Button>
                </div>
              </div>
            ) : null}

            <div className="flex min-w-0 items-end gap-2">
              {showStylistPhoto ? (
                <>
                  <input
                    ref={fileRef}
                    type="file"
                    accept="image/jpeg,image/png,image/webp"
                    className="hidden"
                    onChange={(e) => onPickPhoto(e.target.files?.[0] ?? null)}
                  />
                  <Button
                    type="button"
                    variant="outline"
                    size="icon"
                    className="h-11 w-11 shrink-0"
                    disabled={streaming}
                    onClick={() => fileRef.current?.click()}
                    title="Attach photo for Stylist"
                  >
                    <ImagePlus className="h-4 w-4" />
                  </Button>
                </>
              ) : null}
              <Textarea
                placeholder={
                  showStylistPhoto
                    ? `Message Stylist… (optional photo)`
                    : `Message ${active?.shortLabel ?? "Staff"}…`
                }
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    handleSend();
                  }
                }}
                rows={2}
                className="min-h-[2.75rem] min-w-0 flex-1 resize-none text-[0.9375rem] leading-relaxed sm:text-base"
              />
              <Button
                onClick={handleSend}
                disabled={!input.trim() && !photo}
                size="icon"
                className="h-11 w-11 shrink-0"
              >
                <Send className="h-4 w-4" />
              </Button>
            </div>
            {showStylistPhoto ? (
              <p className="mt-2 text-sm text-muted-foreground">
                Attach a photo for wardrobe / presentation feedback. Uses the vision model, then
                Stylist coaching.
              </p>
            ) : null}
          </div>
        </CardContent>
      </Card>
      {showCareerPdf ? (
        <div className="min-h-0 overflow-y-auto lg:h-full">
          <CareerPdfPanel />
        </div>
      ) : null}
      {showForgeQa ? (
        <div className="min-h-0 overflow-y-auto lg:h-full">
          <ForgeQaPanel />
        </div>
      ) : null}
    </div>
  );
}
