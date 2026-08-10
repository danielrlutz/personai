"use client";

import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { JahresakteWizard } from "@/components/archive/JahresakteWizard";
import { Button } from "@/components/ui/button";
import { PageEnter } from "@/components/motion/PageEnter";

export default function JahresaktePage() {
  return (
    <PageEnter className="mx-auto max-w-2xl space-y-6">
      <div className="flex items-center gap-4">
        <Button variant="ghost" size="icon" asChild>
          <Link href="/ingest/">
            <ArrowLeft className="h-4 w-4" />
          </Link>
        </Button>
        <div>
          <h1 className="font-display text-3xl tracking-tight sm:text-4xl">Jahresakte</h1>
          <p className="page-subtitle">
            Swiss year pack — pick a year, review archive hits, confirm, then ZIP + PDF index
            locally (optional Drive).
          </p>
        </div>
      </div>
      <JahresakteWizard />
    </PageEnter>
  );
}
