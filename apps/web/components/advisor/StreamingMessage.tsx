"use client";

import { motion, useReducedMotion } from "framer-motion";
import { RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { messageVariants } from "@/lib/motion";
import type { ChatMessageStatus } from "./useChatStream";
import { ChatMarkdown } from "./ChatMarkdown";
import { CitationChips } from "@/components/team/CitationChips";
import {
  collectDisplayCitations,
  stripDocCitations,
  type CitableCatalogEntry,
  type DocCitation,
} from "@/lib/chat-citations";

interface StreamingMessageProps {
  role: "user" | "assistant";
  content: string;
  streaming?: boolean;
  status?: ChatMessageStatus;
  error?: string;
  onRetry?: () => void;
  /** When false, show plain text (markdown source). Default true. */
  formatted?: boolean;
  /** Local archive catalog for filename-mention chips. */
  /** Pocket huddle / multi-speaker label (defaults to Advisor). */
  speakerLabel?: string;
  citableCatalog?: CitableCatalogEntry[];
  previewBusyId?: string | null;
  onOpenCitation?: (citation: DocCitation) => void;
}

export function StreamingMessage({
  role,
  content,
  streaming,
  status,
  error,
  onRetry,
  formatted = true,
  speakerLabel,
  citableCatalog,
  previewBusyId,
  onOpenCitation,
}: StreamingMessageProps) {
  const reduce = useReducedMotion();
  const failed = role === "user" && status === "failed";
  const pending = role === "user" && status === "pending";
  const citations =
    role === "assistant" ? collectDisplayCitations(content, citableCatalog) : [];
  // Formatted: strip markers so markdown stays clean. Raw: keep markers (true source).
  const displayContent =
    role === "assistant" && formatted ? stripDocCitations(content) : content;

  return (
    <motion.div
      variants={reduce ? undefined : messageVariants}
      initial={reduce ? undefined : "hidden"}
      animate={reduce ? undefined : "show"}
      className={cn(
        "chat-bubble",
        role === "user" ? "chat-bubble-user" : "chat-bubble-assistant",
        failed && "ring-1 ring-destructive/50",
      )}
    >
      <p className="mb-1.5 text-xs font-medium tracking-[0.02em] text-foreground/55">
        {role === "user" ? "You" : speakerLabel?.trim() || "Advisor"}
        {pending ? <span className="ml-2 text-foreground/45">Sending…</span> : null}
        {failed ? <span className="ml-2 text-destructive">Not sent</span> : null}
      </p>
      {formatted && displayContent.trim() ? (
        <div>
          <ChatMarkdown content={displayContent} />
          {streaming ? (
            <span
              className="ml-0.5 inline-block h-[1.05em] w-[2px] translate-y-[2px] bg-primary align-baseline motion-safe:animate-pulse"
              aria-hidden
            />
          ) : null}
        </div>
      ) : (
        <div className="whitespace-pre-wrap break-words [overflow-wrap:anywhere]">
          {displayContent}
          {streaming ? (
            <span
              className="ml-0.5 inline-block h-[1.05em] w-[2px] translate-y-[2px] bg-primary align-baseline motion-safe:animate-pulse"
              aria-hidden
            />
          ) : null}
        </div>
      )}
      {role === "assistant" && onOpenCitation ? (
        <CitationChips
          citations={citations}
          busyId={previewBusyId}
          onOpen={onOpenCitation}
        />
      ) : null}
      {failed ? (
        <div className="mt-3 flex min-w-0 flex-wrap items-center gap-2">
          {error ? (
            <p className="min-w-0 flex-1 break-words text-xs text-destructive">{error}</p>
          ) : null}
          {onRetry ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={onRetry}
              className="shrink-0 border-destructive/40 text-foreground"
            >
              <RefreshCw className="h-3.5 w-3.5" />
              Retry
            </Button>
          ) : null}
        </div>
      ) : null}
    </motion.div>
  );
}
