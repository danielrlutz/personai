"use client";

import { useState } from "react";
import { PersonalOverview } from "@/components/life/PersonalOverview";
import { HabitPanel } from "@/components/life/HabitPanel";
import { PersonalTaskPanel } from "@/components/life/PersonalTaskPanel";
import { GoalPanel } from "@/components/life/GoalPanel";
import { TouchpointPanel } from "@/components/life/TouchpointPanel";
import { NotePanel } from "@/components/life/NotePanel";
import { LifestylePanel } from "@/components/life/LifestylePanel";
import { PageEnter, Stagger, StaggerItem } from "@/components/motion/PageEnter";

export default function LifePage() {
  const [refreshKey, setRefreshKey] = useState(0);
  const bump = () => setRefreshKey((k) => k + 1);

  return (
    <PageEnter className="mx-auto max-w-6xl space-y-8">
      <div className="page-header min-w-0">
        <h1 className="page-title">Life</h1>
        <p className="page-subtitle">
          Personal manners — habits, goals, relationships, and lifestyle signals. No mock data.
        </p>
      </div>

      <PersonalOverview refreshKey={refreshKey} />

      <Stagger className="grid gap-5 lg:grid-cols-2">
        <StaggerItem>
          <HabitPanel refreshKey={refreshKey} onChanged={bump} />
        </StaggerItem>
        <StaggerItem>
          <PersonalTaskPanel refreshKey={refreshKey} onChanged={bump} />
        </StaggerItem>
        <StaggerItem>
          <GoalPanel refreshKey={refreshKey} onChanged={bump} />
        </StaggerItem>
        <StaggerItem>
          <TouchpointPanel refreshKey={refreshKey} onChanged={bump} />
        </StaggerItem>
        <StaggerItem>
          <NotePanel refreshKey={refreshKey} onChanged={bump} />
        </StaggerItem>
        <StaggerItem>
          <LifestylePanel refreshKey={refreshKey} onChanged={bump} />
        </StaggerItem>
      </Stagger>
    </PageEnter>
  );
}
