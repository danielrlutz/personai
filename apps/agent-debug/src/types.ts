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
  ackedAt: string | null;
};

export type Session = {
  id: string;
  createdAt: string;
  lastActivityAt: string;
  label: string;
};

export type StoreData = {
  version: 1;
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
};
