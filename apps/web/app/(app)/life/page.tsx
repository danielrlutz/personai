"use client";

import { useState } from "react";
import { PersonalOverview } from "@/components/life/PersonalOverview";
import { HabitPanel } from "@/components/life/HabitPanel";
import { PersonalTaskPanel } from "@/components/life/PersonalTaskPanel";
import { GoalPanel } from "@/components/life/GoalPanel";
import { TouchpointPanel } from "@/components/life/TouchpointPanel";
import { NotePanel } from "@/components/life/NotePanel";
import { LifestylePanel } from "@/components/life/LifestylePanel";

export default function LifePage() {
  const [refreshKey, setRefreshKey] = useState(0);
  const bump = () => setRefreshKey((k) => k + 1);

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Life</h1>
        <p className="mt-1 text-muted-foreground">
          Personal manners — habits, goals, relationships, and lifestyle signals. No mock data.
        </p>
      </div>

      <PersonalOverview refreshKey={refreshKey} />

      <div className="grid gap-6 lg:grid-cols-2">
        <HabitPanel refreshKey={refreshKey} onChanged={bump} />
        <PersonalTaskPanel refreshKey={refreshKey} onChanged={bump} />
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <GoalPanel refreshKey={refreshKey} onChanged={bump} />
        <TouchpointPanel refreshKey={refreshKey} onChanged={bump} />
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <NotePanel refreshKey={refreshKey} onChanged={bump} />
        <LifestylePanel refreshKey={refreshKey} onChanged={bump} />
      </div>
    </div>
  );
}
