/** Client-side durable outbox — never lose user intent across reloads. */

export type OutboxStatus = "pending" | "inflight" | "failed" | "done";

export type OutboxOpType = "team-chat" | "ingest-upload";

export interface TeamChatPayload {
  clientMessageId: string;
  message: string;
  specialist: string;
  sessionId?: string;
}

export interface IngestUploadPayload {
  filename: string;
  mimeType: string;
  size: number;
  /** Key into the IndexedDB blobs store */
  blobKey: string;
}

export type OutboxPayload = TeamChatPayload | IngestUploadPayload;

export interface OutboxOp<T extends OutboxOpType = OutboxOpType> {
  id: string;
  type: T;
  status: OutboxStatus;
  profileId: string;
  createdAt: number;
  updatedAt: number;
  attempts: number;
  lastError?: string;
  payload: T extends "team-chat"
    ? TeamChatPayload
    : T extends "ingest-upload"
      ? IngestUploadPayload
      : OutboxPayload;
}

export type OutboxEvent =
  | { kind: "changed"; ops: OutboxOp[] }
  | {
      kind: "team-chat-progress";
      opId: string;
      phase: "started" | "token" | "context" | "finished" | "failed";
      token?: string;
      sessionId?: string;
      assistantContent?: string;
      error?: string;
      payload?: TeamChatPayload;
    }
  | { kind: "ingest-upload-done"; opId: string; filename: string };

export function isOpenStatus(status: OutboxStatus): boolean {
  return status === "pending" || status === "inflight" || status === "failed";
}

export function labelForOp(op: OutboxOp): string {
  if (op.type === "team-chat") {
    const p = op.payload as TeamChatPayload;
    const preview = p.message.length > 48 ? `${p.message.slice(0, 48)}…` : p.message;
    return `Team chat · ${preview}`;
  }
  const p = op.payload as IngestUploadPayload;
  return `Upload · ${p.filename}`;
}
