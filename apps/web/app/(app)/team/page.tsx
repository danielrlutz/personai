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
    <PageEnter className="mx-auto max-w-5xl space-y-5">
      <div className="page-header min-w-0">
        <h1 className="page-title">Team</h1>
        <p className="page-subtitle">
          Twelve specialists, one local orchestration path. Irreversible writes stay behind confirm.
        </p>
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
