export type ReinspectStatus = "flagged" | "reinspecting" | "ready" | "failed";

const REINSPECT_STATUSES = new Set<ReinspectStatus>([
  "flagged",
  "reinspecting",
  "ready",
  "failed",
]);

function payloadRecord(payload: unknown): Record<string, unknown> | null {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return null;
  return payload as Record<string, unknown>;
}

export function reinspectStatusFromPayload(payload: unknown): ReinspectStatus | null {
  const p = payloadRecord(payload);
  if (!p) return null;
  const status = p.reinspectStatus;
  if (typeof status !== "string") return null;
  return REINSPECT_STATUSES.has(status as ReinspectStatus)
    ? (status as ReinspectStatus)
    : null;
}

export function reinspectJobIdFromPayload(payload: unknown): string | null {
  const p = payloadRecord(payload);
  if (!p) return null;
  const id = p.reinspectJobId;
  return typeof id === "string" && id.trim() ? id.trim() : null;
}

export function labelForReinspectStatus(status: ReinspectStatus): string {
  switch (status) {
    case "flagged":
      return "Flagged";
    case "reinspecting":
      return "Reinspecting";
    case "ready":
      return "Ready to review again";
    case "failed":
      return "Reinspect failed";
  }
}
