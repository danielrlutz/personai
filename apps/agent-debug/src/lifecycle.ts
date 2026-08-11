import type { AckReason, Batch, BatchState, DeployStatus, InboxMessage } from "./types.js";

/** User-facing pipeline stage (matches balcony dismiss safety checklist). */
export type LifecycleStage =
  | "sent"
  | "composing"
  | "ready"
  | "dispatched"
  | "implemented"
  | "deployed"
  | "discarded"
  | "already_done";

/** How safe it is to tap Done / dismiss this bubble from the balcony. */
export type DismissSafety = "wait" | "caution" | "safe" | "done";

export type LifecycleStep = {
  stage: LifecycleStage;
  label: string;
  at: string | null;
  reached: boolean;
  active: boolean;
};

export type BatchLifecycle = {
  batchId: string;
  current: LifecycleStage;
  steps: LifecycleStep[];
  batchState: BatchState;
  sentAt: string | null;
  composedAt: string | null;
  readyAt: string | null;
  dispatchedAt: string | null;
  ackedAt: string | null;
  ackReason: AckReason | null;
  deployStatus: DeployStatus;
  deployNote: string | null;
  deployedAt: string | null;
  cursorAgentId: string | null;
  cursorRunId: string | null;
  /** True when batch has a composed prompt (safe to dismiss with awareness). */
  canAck: boolean;
  /** Non-null when Done is allowed but pipeline incomplete. */
  doneWarning: string | null;
  /** True when Mark live is meaningful. */
  canMarkLive: boolean;
  /** One-line human headline for the current stage. */
  headline: string;
  dismissSafety: DismissSafety;
  /** Short dismiss guidance shown beside the pipeline. */
  dismissHint: string | null;
};

const MAIN_PIPELINE: Array<{ stage: LifecycleStage; label: string }> = [
  { stage: "sent", label: "Sent" },
  { stage: "composing", label: "Composing" },
  { stage: "ready", label: "Composed" },
  { stage: "dispatched", label: "Prompted" },
  { stage: "implemented", label: "Implemented" },
  { stage: "deployed", label: "Live" },
];

function stageRank(stage: LifecycleStage): number {
  const order: LifecycleStage[] = [
    "sent",
    "composing",
    "ready",
    "dispatched",
    "implemented",
    "deployed",
    "discarded",
    "already_done",
  ];
  return order.indexOf(stage);
}

function isPrompted(batch: Batch): boolean {
  return Boolean(batch.dispatchedAt || batch.cursorAgentId || batch.cursorRunId);
}

function resolveCurrent(batch: Batch): LifecycleStage {
  if (batch.ackReason === "discarded") return "discarded";
  if (batch.ackReason === "already_done") return "already_done";
  if (batch.deployStatus === "live" && batch.deployedAt) return "deployed";
  if (batch.ackReason === "implemented" || batch.ackedAt) return "implemented";
  if (isPrompted(batch)) return "dispatched";
  if (batch.state === "ready") return "ready";
  if (
    batch.state === "composing" ||
    batch.state === "ready_to_compose"
  ) {
    return "composing";
  }
  return "sent";
}

function timestampForStage(batch: Batch, stage: LifecycleStage): string | null {
  switch (stage) {
    case "sent":
      return batch.createdAt;
    case "composing":
      return batch.state === "composing" ? batch.createdAt : null;
    case "ready":
      return batch.composedAt ?? batch.readyAt;
    case "dispatched":
      return batch.dispatchedAt ?? batch.composedAt ?? batch.readyAt;
    case "implemented":
      return batch.ackedAt;
    case "deployed":
      return batch.deployedAt;
    default:
      return batch.ackedAt;
  }
}

function buildHeadline(batch: Batch, current: LifecycleStage): string {
  switch (current) {
    case "sent":
      return "Sent — collecting batch";
    case "composing":
      return "Composing Cursor prompt…";
    case "ready":
      return "Composed — waiting for Cursor";
    case "dispatched":
      return batch.dispatchedAt
        ? "Prompted in Cursor"
        : "Cursor agent running…";
    case "implemented":
      return "Implemented — mark live when deployed";
    case "deployed":
      return "Live — safe to dismiss";
    case "discarded":
      return "Discarded";
    case "already_done":
      return "Already done";
    default:
      return "In progress";
  }
}

function buildDismissGuidance(
  batch: Batch,
  current: LifecycleStage,
): { safety: DismissSafety; hint: string | null; doneWarning: string | null } {
  if (current === "discarded" || current === "already_done") {
    return { safety: "done", hint: "Archived — no action needed.", doneWarning: null };
  }
  if (current === "deployed") {
    return {
      safety: "safe",
      hint: "Deployed and live — tap Done to clear this bubble.",
      doneWarning: null,
    };
  }
  if (current === "implemented") {
    const hint =
      batch.deployStatus !== "live"
        ? "Work done — Mark live after VPS deploy, then Done."
        : "Tap Done to archive this bubble.";
    return { safety: "safe", hint, doneWarning: null };
  }
  if (stageRank(current) < stageRank("ready")) {
    return {
      safety: "wait",
      hint: "Still composing — do not dismiss yet.",
      doneWarning: "Prompt not composed yet — wait before dismissing.",
    };
  }
  if (current === "ready" && !isPrompted(batch)) {
    return {
      safety: "caution",
      hint: "Composed but not in Cursor yet — wait for SDK or MCP poll.",
      doneWarning:
        "Not prompted to Cursor yet — confirm MCP poll or SDK dispatch before Done.",
    };
  }
  if (current === "dispatched") {
    return {
      safety: "caution",
      hint: "In Cursor — wait for implementation, then Mark live + Done.",
      doneWarning:
        batch.deployStatus !== "live"
          ? "Not marked live — use Mark live after deploy, or Done if work is complete."
          : null,
    };
  }
  return { safety: "caution", hint: null, doneWarning: null };
}

export function batchLifecycle(batch: Batch): BatchLifecycle {
  const current = resolveCurrent(batch);
  const currentRank = stageRank(current);
  const terminal =
    current === "discarded" ||
    current === "already_done" ||
    current === "implemented" ||
    current === "deployed";

  const steps: LifecycleStep[] = MAIN_PIPELINE.map(({ stage, label }) => {
    const rank = stageRank(stage);
    let reached = rank <= currentRank && current !== "discarded" && current !== "already_done";
    if (current === "discarded" || current === "already_done") {
      reached = stage !== "deployed" && rank <= stageRank("dispatched");
    }
    if (stage === "implemented" && current === "deployed") reached = true;
    return {
      stage,
      label,
      at: reached ? timestampForStage(batch, stage) : null,
      reached,
      active: stage === current,
    };
  });

  if (current === "discarded" || current === "already_done") {
    steps.push({
      stage: current,
      label: current === "discarded" ? "Discarded" : "Already done",
      at: batch.ackedAt,
      reached: true,
      active: true,
    });
  }

  const canAck =
    batch.state === "ready" ||
    isPrompted(batch) ||
    batch.deployStatus === "live";

  const dismiss = buildDismissGuidance(batch, current);

  return {
    batchId: batch.id,
    current,
    steps,
    batchState: batch.state,
    sentAt: batch.createdAt,
    composedAt: batch.composedAt ?? batch.readyAt,
    readyAt: batch.readyAt,
    dispatchedAt: batch.dispatchedAt,
    ackedAt: batch.ackedAt,
    ackReason: batch.ackReason,
    deployStatus: batch.deployStatus,
    deployNote: batch.deployNote,
    deployedAt: batch.deployedAt,
    cursorAgentId: batch.cursorAgentId,
    cursorRunId: batch.cursorRunId,
    canAck,
    doneWarning: terminal ? null : dismiss.doneWarning,
    canMarkLive:
      (batch.state === "ready" || isPrompted(batch)) &&
      batch.deployStatus !== "live",
    headline: buildHeadline(batch, current),
    dismissSafety: dismiss.safety,
    dismissHint: dismiss.hint,
  };
}

export function messageLifecycle(
  msg: InboxMessage,
  batch: Batch | undefined,
): BatchLifecycle | null {
  if (!batch) return null;
  return batchLifecycle(batch);
}
