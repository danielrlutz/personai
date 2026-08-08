"use client";

import { cn } from "@/lib/utils";

interface StreamingMessageProps {
  role: "user" | "assistant";
  content: string;
  streaming?: boolean;
}

export function StreamingMessage({ role, content, streaming }: StreamingMessageProps) {
  return (
    <div
      className={cn(
        "rounded-lg px-4 py-3 text-sm leading-relaxed",
        role === "user"
          ? "ml-8 bg-primary-container text-primary-on-container"
          : "mr-8 border border-border/60 bg-surface-container text-foreground",
      )}
    >
      <p className="mb-1 md-label-medium text-muted-foreground">
        {role === "user" ? "You" : "Advisor"}
      </p>
      <div className="whitespace-pre-wrap">
        {content}
        {streaming && (
          <span
            className="ml-0.5 inline-block h-[1.05em] w-[2px] translate-y-[2px] bg-primary align-baseline motion-safe:animate-pulse"
            aria-hidden
          />
        )}
      </div>
    </div>
  );
}
