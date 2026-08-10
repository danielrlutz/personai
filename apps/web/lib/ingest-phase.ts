/** Client-side ingest lane phase labels (mirrors server deriveIngestPhase). */

export type IngestPhase =
  | "queued"
  | "waiting_vision"
  | "rasterize"
  | "ocr"
  | "split"
  | "await_confirm"
  | "cancelling"
  | "failed"
  | "done"
  | "upload";

export const LANE_STEPS: Array<{
  id: "rasterize" | "ocr" | "split" | "await_confirm";
  label: string;
}> = [
  { id: "rasterize", label: "Rasterize" },
  { id: "ocr", label: "OCR" },
  { id: "split", label: "Split" },
  { id: "await_confirm", label: "Confirm" },
];

export function phaseLabel(phase: IngestPhase | string | null | undefined): string {
  switch (phase) {
    case "upload":
      return "Uploading";
    case "queued":
      return "Queued";
    case "waiting_vision":
      return "Waiting for vision";
    case "rasterize":
      return "Rasterize";
    case "ocr":
      return "OCR";
    case "split":
      return "Split";
    case "await_confirm":
      return "Await confirm";
    case "cancelling":
      return "Cancelling";
    case "failed":
      return "Failed";
    case "done":
      return "Done";
    default:
      return "Processing";
  }
}

export function phaseStepIndex(phase: IngestPhase | string | null | undefined): number {
  switch (phase) {
    case "rasterize":
      return 0;
    case "ocr":
      return 1;
    case "split":
      return 2;
    case "await_confirm":
    case "done":
      return 3;
    case "waiting_vision":
    case "queued":
    case "upload":
      return -1;
    case "cancelling":
    case "failed":
      return -2;
    default:
      return -1;
  }
}

export function formatElapsed(startedAt: string | null | undefined): string | null {
  if (!startedAt) return null;
  const ms = Date.now() - new Date(startedAt).getTime();
  if (!Number.isFinite(ms) || ms < 0) return null;
  const sec = Math.floor(ms / 1000);
  if (sec < 60) return `~${sec}s`;
  const min = Math.floor(sec / 60);
  const rem = sec % 60;
  return rem ? `~${min}m ${rem}s` : `~${min}m`;
}

export function cancelConfirmMessage(opts: {
  filename: string;
  status: string;
  phase?: string | null;
}): string {
  const label = opts.filename || "this document";
  const status = (opts.status ?? "").toUpperCase();
  if (status === "PROCESSING" || opts.phase === "cancelling") {
    return (
      `Cancel “${label}”?\n\n` +
      `OCR may finish the current page, then the item is removed from the queue.\n` +
      `• Unconfirmed upload bytes on this device are discarded.\n` +
      `• Archived / Drive files already confirmed are never deleted.\n` +
      `• Pending naming confirms for this doc are expired.`
    );
  }
  if (status === "COMPLETED" || opts.phase === "await_confirm") {
    return (
      `Remove “${label}” from the queue?\n\n` +
      `This dismisses the queue item and expires its pending confirm.\n` +
      `• Unconfirmed upload bytes are discarded.\n` +
      `• Already-confirmed archive / Drive files are kept.`
    );
  }
  return (
    `Remove “${label}” from the queue?\n\n` +
    `This only clears the queue item — confirmed archive / Drive files are kept.\n` +
    `Unconfirmed upload bytes for this doc are discarded.`
  );
}
