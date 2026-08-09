"use client";

import Link from "next/link";
import { HabitPanel } from "@/components/life/HabitPanel";
import { Button } from "@/components/ui/button";

export function LifeHabitsWidget() {
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <h2 className="font-display text-lg tracking-tight">Habits today</h2>
        <Button variant="ghost" size="sm" asChild>
          <Link href="/life/">Life</Link>
        </Button>
      </div>
      <HabitPanel compact />
    </div>
  );
}
