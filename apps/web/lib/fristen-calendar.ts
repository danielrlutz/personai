import { apiPost } from "@/lib/api-client";

export type FristenCalendarPackResult = {
  ok: boolean;
  staged: number;
  events: Array<{
    id: string;
    kind: "legal_task" | "document";
    sourceId: string;
    title: string;
    start: string;
  }>;
  ics: string;
  filename: string;
  googleWrite: "not_wired";
};

function triggerDownload(filename: string, contents: string, mime: string) {
  const blob = new Blob([contents], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

/** Stage open Fristen locally and download a portable .ics pack. */
export async function stageAndDownloadFristenPack(ids?: string[]): Promise<FristenCalendarPackResult> {
  const pack = await apiPost<FristenCalendarPackResult>("/fristen/calendar-pack", {
    ids,
    stage: true,
  });
  triggerDownload(pack.filename, pack.ics, "text/calendar;charset=utf-8");
  return pack;
}
