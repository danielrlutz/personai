export type ImageMeta = {
  id: string;
  filename: string;
  mimeType: string;
  size: number;
  path: string;
  thumbPath: string | null;
  caption: string | null;
};

export type MessageStatus = "pending" | "batched" | "composed" | "acked";

/** Why a prompt/batch left the active pending queue. */
export type AckReason = "implemented" | "discarded" | "already_done";

/** Deploy / live status for a batch (optional — manual or deploy script). */
export type DeployStatus = "none" | "pending" | "live" | "failed";

export type InboxMessage = {
  id: string;
  sessionId: string;
  text: string;
  images: ImageMeta[];
  urgent: boolean;
  createdAt: string;
  batchId: string | null;
  status: MessageStatus;
};

export type BatchState =
  | "collecting"
  | "awaiting_more"
  | "ready_to_compose"
  | "composing"
  | "ready"
  | "acked";

export type Batch = {
  id: string;
  sessionId: string;
  state: BatchState;
  messageIds: string[];
  urgent: boolean;
  awaitingReason: string | null;
  awaitingUntil: string | null;
  composedPrompt: string | null;
  composeError: string | null;
  createdAt: string;
  readyAt: string | null;
  /** When Ollama compose finished (usually same as readyAt). */
  composedAt: string | null;
  /** Set when Cursor SDK dispatch completes successfully (before ack). */
  dispatchedAt: string | null;
  /** Cursor SDK agent id from Agent.create (agent-* / bc-*). */
  cursorAgentId: string | null;
  /** Cursor SDK run id from agent.send(). */
  cursorRunId: string | null;
  ackedAt: string | null;
  ackReason: AckReason | null;
  deployStatus: DeployStatus;
  deployNote: string | null;
  deployedAt: string | null;
};

/** Cursor run correlation surfaced on ready/archived batches. */
export type CursorDispatchInfo = {
  cursorAgentId: string | null;
  cursorRunId: string | null;
  dispatchedAt: string | null;
  /** Hint path under ~/.cursor/projects/.../agent-transcripts/ */
  cursorTranscriptHint: string | null;
};

export type ArchivedBatch = Batch & {
  ackedAt: string;
  ackReason: AckReason;
};

export type ArchivedMessage = InboxMessage & {
  ackedAt: string;
  ackReason: AckReason;
};

export type ArchiveData = {
  version: 1;
  batches: ArchivedBatch[];
  messages: ArchivedMessage[];
};

export type Session = {
  id: string;
  createdAt: string;
  lastActivityAt: string;
  label: string;
};

export type StoreData = {
  version: 2;
  sessions: Session[];
  messages: InboxMessage[];
  batches: Batch[];
};

export type StatusSnapshot = {
  ok: true;
  queueDepth: number;
  readyPrompts: number;
  pendingMessages: number;
  awaitingMore: Array<{
    batchId: string;
    reason: string | null;
    until: string | null;
    messageCount: number;
  }>;
  lastActivityAt: string | null;
  composeModel: string;
  visionModel: string;
  /** True when CURSOR_API_KEY is set (SDK primary delivery armed). */
  sdkDispatchEnabled: boolean;
  /** Batches enqueued/attempted via SDK bridge this process lifetime. */
  dispatchedPrompts: number;
  dispatchQueuePending: number;
  dispatchLastError: string | null;
  /** Ready batches with Cursor SDK correlation ids (when dispatched). */
  readyDispatches: Array<
    CursorDispatchInfo & { batchId: string; urgent: boolean; readyAt: string | null }
  >;
};
