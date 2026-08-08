"use client";

import { useSearchParams } from "next/navigation";
import { Suspense } from "react";
import { TeamChat } from "@/components/team/TeamChat";
import { ConfirmGate } from "@/components/confirm/ConfirmGate";

function TeamPageInner() {
  const params = useSearchParams();
  const specialist = params.get("specialist") ?? "secretary";

  return (
    <div className="mx-auto max-w-5xl space-y-4">
      <div>
        <h1 className="md-title-large text-[26px] tracking-tight">Team</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Twelve specialists, one local orchestration path. Irreversible writes stay behind confirm.
        </p>
      </div>
      <ConfirmGate compact />
      <TeamChat initialSpecialist={specialist} />
    </div>
  );
}

export default function TeamPage() {
  return (
    <Suspense
      fallback={
        <div className="flex h-40 items-center justify-center">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
        </div>
      }
    >
      <TeamPageInner />
    </Suspense>
  );
}
