"use client";

import { Scale } from "lucide-react";
import type { PendingConfirmation } from "@/lib/api-client";
import { Button } from "@/components/ui/button";
import { fristDeadlineFromConfirmation } from "@/lib/frist-kit";

export function FristKitHint({ confirmation }: { confirmation: PendingConfirmation }) {
  const fristDay = fristDeadlineFromConfirmation(confirmation);
  if (!fristDay) return null;
  return (
    <p className="text-xs text-muted-foreground">
      Frist {fristDay} — one tap queues Legal task + staged calendar + Legal Aide thread (still
      confirm-gated).
    </p>
  );
}

export function FristKitButton({
  confirmation,
  busy,
  onQueue,
}: {
  confirmation: PendingConfirmation;
  busy: boolean;
  onQueue: () => void;
}) {
  if (!fristDeadlineFromConfirmation(confirmation)) return null;
  return (
    <Button size="sm" variant="secondary" disabled={busy} onClick={onQueue}>
      <Scale className="mr-1 h-3.5 w-3.5" />
      Frist kit
    </Button>
  );
}
