"use client";

import type { HomeWidgetId } from "@/lib/home-layout";
import { TriageInbox } from "@/components/home/TriageInbox";
import { FristenStrip } from "@/components/home/FristenStrip";
import { ConfirmsWidget } from "./ConfirmsWidget";
import { MorningBriefWidget } from "./MorningBriefWidget";
import { ActivityRecentWidget } from "./ActivityRecentWidget";
import { FinanceSnapshotWidget } from "./FinanceSnapshotWidget";
import { LifeHabitsWidget } from "./LifeHabitsWidget";
import { ArchiveQueueWidget } from "./ArchiveQueueWidget";
import { OllamaStatusWidget } from "./OllamaStatusWidget";
import { TeamQuickPickWidget } from "./TeamQuickPickWidget";
import { MemoryFactsWidget } from "./MemoryFactsWidget";
import { DriveStatusWidget } from "./DriveStatusWidget";

export function renderHomeWidget(id: HomeWidgetId) {
  switch (id) {
    case "triage":
      return <TriageInbox />;
    case "confirms":
      return <ConfirmsWidget />;
    case "fristen":
      return <FristenStrip />;
    case "morning-brief":
      return <MorningBriefWidget />;
    case "activity":
      return <ActivityRecentWidget />;
    case "finance":
      return <FinanceSnapshotWidget />;
    case "life-habits":
      return <LifeHabitsWidget />;
    case "archive-queue":
      return <ArchiveQueueWidget />;
    case "ollama":
      return <OllamaStatusWidget />;
    case "team":
      return <TeamQuickPickWidget />;
    case "memory":
      return <MemoryFactsWidget />;
    case "drive":
      return <DriveStatusWidget />;
    default:
      return null;
  }
}
