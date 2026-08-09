"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Users } from "lucide-react";
import { apiGet } from "@/lib/api-client";
import { SPECIALIST_FALLBACK, type SpecialistMeta } from "@/lib/specialists";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const QUICK_IDS = ["secretary", "cfo", "legal_aide", "medical_integrator", "forge", "mystic"] as const;

export function TeamQuickPickWidget() {
  const router = useRouter();
  const [specialists, setSpecialists] = useState<SpecialistMeta[]>(SPECIALIST_FALLBACK);

  useEffect(() => {
    void apiGet<{ specialists: SpecialistMeta[] }>("/specialists", { silent: true })
      .then((d) => {
        if (d.specialists?.length) setSpecialists(d.specialists);
      })
      .catch(() => undefined);
  }, []);

  const quick = QUICK_IDS.map((id) => specialists.find((s) => s.id === id)).filter(
    (s): s is SpecialistMeta => Boolean(s),
  );

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <h2 className="font-display text-lg tracking-tight">Team</h2>
        <Button variant="ghost" size="sm" asChild>
          <Link href="/team/">All specialists</Link>
        </Button>
      </div>
      {quick.length === 0 ? (
        <div className="flex items-start gap-3 rounded-2xl border border-border/70 bg-card px-4 py-3.5">
          <Users className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
          <p className="text-sm text-muted-foreground">Specialist list unavailable.</p>
        </div>
      ) : (
        <div className="flex flex-wrap gap-2">
          {quick.map((s) => (
            <button
              key={s.id}
              type="button"
              title={s.description}
              onClick={() => router.push(`/team/?specialist=${s.id}`)}
              className={cn(
                "pressable inline-flex min-h-10 items-center rounded-full bg-surface-container px-3.5 text-sm font-medium",
                "text-foreground/80 transition-colors hover:bg-surface-container-high hover:text-foreground",
              )}
            >
              {s.shortLabel}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
