import { apiUpload, streamSSE } from "@/lib/api-client";
import { idbGetBlob } from "./idb";
import type {
  IngestUploadPayload,
  OutboxEvent,
  OutboxOp,
  TeamChatPayload,
} from "./types";

export type ProcessEmit = (event: OutboxEvent) => void;

export type ProcessResult =
  | { type: "team-chat"; assistantContent: string; sessionId?: string }
  | { type: "ingest-upload"; filename: string };

export async function processOp(op: OutboxOp, emit: ProcessEmit): Promise<ProcessResult> {
  if (op.type === "team-chat") {
    return processTeamChat(op as OutboxOp<"team-chat">, emit);
  }
  if (op.type === "ingest-upload") {
    return processIngestUpload(op as OutboxOp<"ingest-upload">, emit);
  }
  throw new Error(`Unknown outbox op type: ${(op as OutboxOp).type}`);
}

async function processTeamChat(op: OutboxOp<"team-chat">, emit: ProcessEmit): Promise<ProcessResult> {
  const payload = op.payload as TeamChatPayload;
  let assistantContent = "";
  let sessionId = payload.sessionId;
  let streamError: string | null = null;

  emit({ kind: "team-chat-progress", opId: op.id, phase: "started", payload });

  await new Promise<void>((resolve, reject) => {
    let settled = false;
    const finish = (err?: Error) => {
      if (settled) return;
      settled = true;
      if (err) reject(err);
      else resolve();
    };

    // silent: OutboxBootstrap surfaces a sticky snackbar for failed ops.
    void streamSSE("/team/chat/stream", {
      method: "POST",
      silent: true,
      body: {
        message: payload.message,
        sessionId: payload.sessionId,
        specialist: payload.specialist,
      },
      onEvent: (event, data) => {
        if (event === "context" && typeof data === "object" && data && "sessionId" in data) {
          sessionId = String((data as { sessionId: string }).sessionId);
          emit({
            kind: "team-chat-progress",
            opId: op.id,
            phase: "context",
            sessionId,
          });
        }
        if (event === "token" && typeof data === "object" && data && "token" in data) {
          const token = String((data as { token: string }).token);
          assistantContent += token;
          emit({
            kind: "team-chat-progress",
            opId: op.id,
            phase: "token",
            token,
            assistantContent,
          });
        }
        if (event === "error") {
          streamError =
            typeof data === "object" && data && "message" in data
              ? String((data as { message: unknown }).message)
              : "Chat error";
        }
      },
      onError: (err) => {
        streamError = err.message;
      },
      onDone: () => {
        if (streamError) {
          finish(new Error(streamError));
          return;
        }
        if (!assistantContent.trim()) {
          finish(new Error("No reply received"));
          return;
        }
        finish();
      },
    }).catch((err) => {
      finish(err instanceof Error ? err : new Error(String(err)));
    });
  });

  emit({
    kind: "team-chat-progress",
    opId: op.id,
    phase: "finished",
    assistantContent,
    sessionId,
    payload,
  });

  return { type: "team-chat", assistantContent, sessionId };
}

async function processIngestUpload(
  op: OutboxOp<"ingest-upload">,
  emit: ProcessEmit,
): Promise<ProcessResult> {
  const payload = op.payload as IngestUploadPayload;
  const blob = await idbGetBlob(payload.blobKey);
  if (!blob) {
    throw new Error("Upload file missing from device cache — re-select the file");
  }

  const form = new FormData();
  const file = new File([blob], payload.filename, {
    type: payload.mimeType || blob.type || "application/octet-stream",
  });
  form.append("file", file);
  // silent: OutboxBootstrap surfaces a sticky snackbar for failed uploads.
  await apiUpload("/ingest/upload", form, { silent: true });

  emit({ kind: "ingest-upload-done", opId: op.id, filename: payload.filename });
  return { type: "ingest-upload", filename: payload.filename };
}
