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
        "rounded-xl px-4 py-3 text-sm leading-relaxed",
        role === "user"
          ? "ml-8 bg-teal-500/15 text-foreground"
          : "mr-8 border border-border bg-muted/20 text-muted-foreground",
      )}
    >
      <p className="mb-1 text-xs font-medium uppercase tracking-wider text-teal-400/80">
        {role === "user" ? "You" : "Advisor"}
      </p>
      <div className="whitespace-pre-wrap">
        {content}
        {streaming && (
          <span
            className="ml-0.5 inline-block h-[1.05em] w-[2px] translate-y-[2px] bg-teal-400 align-baseline motion-safe:animate-pulse"
            aria-hidden
          />
        )}
      </div>
    </div>
  );
}
