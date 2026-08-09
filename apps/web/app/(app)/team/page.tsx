"use client";

import { useSearchParams } from "next/navigation";
import { Suspense } from "react";
import { TeamChat } from "@/components/team/TeamChat";
import { ConfirmGate } from "@/components/confirm/ConfirmGate";
import { PageEnter } from "@/components/motion/PageEnter";

function TeamPageInner() {
  const params = useSearchParams();
  const specialist = params.get("specialist") ?? "secretary";

  return (
    <PageEnter className="flex w-full min-w-0 flex-col gap-2 sm:gap-3">
      <div className="page-header flex min-w-0 flex-col gap-0.5 sm:flex-row sm:items-end sm:justify-between sm:gap-6">
        <div className="min-w-0">
          <h1 className="page-title">Team</h1>
          <p className="page-subtitle mt-0.5 max-w-3xl">
            Ask your specialists anything. Important changes still ask for confirmation first.
          </p>
        </div>
      </div>
      <ConfirmGate compact />
      <TeamChat initialSpecialist={specialist} />
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
