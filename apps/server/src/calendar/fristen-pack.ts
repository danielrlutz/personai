import type { PrismaClient } from "@prisma/client";
import { stageCalendarEvent } from "../confirm/apply-confirmation.js";
import { buildIcsCalendar, type IcsEvent } from "./ics.js";

export type FristPackItem = {
  id: string;
  kind: "legal_task" | "document";
  sourceId: string;
  title: string;
  description: string | null;
  dueDate: Date;
  status: string;
};

export type FristPackResult = {
  events: Array<{
    id: string;
    kind: "legal_task" | "document";
    sourceId: string;
    title: string;
    start: string;
  }>;
  staged: number;
  ics: string;
  filename: string;
  googleWrite: "not_wired";
};

function openStatuses(): Array<"TODO" | "IN_PROGRESS" | "BLOCKED"> {
  return ["TODO", "IN_PROGRESS", "BLOCKED"];
}

/** Collect open Fristen (legal tasks + document deadlines) with a due date. */
export async function listOpenDatedFristen(
  prisma: PrismaClient,
  ids?: string[],
): Promise<FristPackItem[]> {
  const idSet = ids?.length ? new Set(ids) : null;
  const [tasks, docs] = await Promise.all([
    prisma.legalTask.findMany({
      where: {
        status: { in: openStatuses() },
        dueDate: { not: null },
      },
      orderBy: { dueDate: "asc" },
    }),
    prisma.document.findMany({
      where: { deadline: { not: null } },
      orderBy: { deadline: "asc" },
      take: 80,
    }),
  ]);

  const items: FristPackItem[] = [
    ...tasks
      .filter((t): t is typeof t & { dueDate: Date } => Boolean(t.dueDate))
      .map((t) => ({
        id: `task:${t.id}`,
        kind: "legal_task" as const,
        sourceId: t.id,
        title: t.title,
        description: t.description,
        dueDate: t.dueDate,
        status: t.status,
      })),
    ...docs
      .filter((d): d is typeof d & { deadline: Date } => Boolean(d.deadline))
      .map((d) => ({
        id: `doc:${d.id}`,
        kind: "document" as const,
        sourceId: d.id,
        title: d.archiveName || d.filename,
        description: `Archive category ${d.archiveCategory ?? "—"}`,
        dueDate: d.deadline,
        status: d.confirmedAt ? "FILED" : "STAGED",
      })),
  ].filter((item) => (idSet ? idSet.has(item.id) : true));

  items.sort((a, b) => a.dueDate.getTime() - b.dueDate.getTime());
  return items;
}

function toIcsEvent(item: FristPackItem): IcsEvent {
  const day = new Date(
    item.dueDate.getFullYear(),
    item.dueDate.getMonth(),
    item.dueDate.getDate(),
    0,
    0,
    0,
    0,
  );
  const descParts = [
    item.description,
    `PersonAI Frist (${item.kind})`,
    "Google Calendar write is not wired — import this .ics or keep the local stage.",
  ].filter(Boolean);
  return {
    uid: `personai-frist-${item.id}@personai.local`,
    title: item.title,
    description: descParts.join("\n"),
    start: day,
    allDay: true,
  };
}

/**
 * Build a portable .ics pack from open Fristen.
 * Optionally stage each event locally (Google write remains a stub).
 */
export async function buildFristenCalendarPack(
  prisma: PrismaClient,
  options?: { ids?: string[]; stage?: boolean },
): Promise<FristPackResult> {
  const stage = options?.stage !== false;
  const items = await listOpenDatedFristen(prisma, options?.ids);
  const icsEvents = items.map(toIcsEvent);

  let staged = 0;
  if (stage) {
    for (const item of items) {
      await stageCalendarEvent(prisma, {
        title: item.title,
        start: item.dueDate.toISOString(),
        end: null,
        description: [item.description, `source:${item.id}`, "google_write:not_wired"]
          .filter(Boolean)
          .join("\n"),
      });
      staged += 1;
    }
  }

  const day = new Date().toISOString().slice(0, 10);
  const filename = `personai-fristen-${day}.ics`;
  const ics = buildIcsCalendar(icsEvents, { name: "PersonAI Fristen" });

  await prisma.auditLog.create({
    data: {
      action: "fristen.calendar_pack",
      entity: "CalendarEvent",
      metadata: JSON.stringify({
        count: items.length,
        staged,
        stage,
        googleWrite: "not_wired",
        ids: items.map((i) => i.id),
      }),
    },
  });

  return {
    events: items.map((i) => ({
      id: i.id,
      kind: i.kind,
      sourceId: i.sourceId,
      title: i.title,
      start: i.dueDate.toISOString(),
    })),
    staged,
    ics,
    filename,
    googleWrite: "not_wired",
  };
}
