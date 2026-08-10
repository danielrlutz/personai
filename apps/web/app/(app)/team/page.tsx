"use client";

import { useSearchParams } from "next/navigation";
import { Suspense } from "react";
import { TeamChat } from "@/components/team/TeamChat";
import { ConfirmGate } from "@/components/confirm/ConfirmGate";
import { PageEnter } from "@/components/motion/PageEnter";

function TeamPageInner() {
  const params = useSearchParams();
  const specialist = params.get("specialist") ?? "secretary";
  const initialPrompt = params.get("q") ?? params.get("message") ?? undefined;

  return (
    <PageEnter
      className={
        // Fill main below app header + padding + mobile nav; chat owns leftover height.
        "flex h-[calc(100dvh-var(--header-height)-5.75rem-env(safe-area-inset-top)-env(safe-area-inset-bottom))] min-h-[22rem] min-w-0 flex-col gap-2 overflow-hidden md:h-[calc(100dvh-var(--header-height)-2.75rem)] md:gap-2.5"
      }
    >
      <div className="page-header flex shrink-0 items-baseline justify-between gap-3">
        <div className="min-w-0">
          <h1 className="page-title">Team</h1>
          <p className="page-subtitle mt-0.5 hidden max-w-3xl sm:block">
            Ask your specialists anything. Important changes still ask for confirmation first.
          </p>
        </div>
      </div>
      <div className="shrink-0">
        <ConfirmGate compact />
      </div>
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <TeamChat initialSpecialist={specialist} initialPrompt={initialPrompt} />
      </div>
    </PageEnter>
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
