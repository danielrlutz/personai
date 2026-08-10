import { apiUpload, streamSSE } from "@/lib/api-client";
import { describeApiFailure, describeStreamError } from "@/lib/api-errors";
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

async function blobToBase64(blob: Blob): Promise<string> {
  const buffer = await blob.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

async function processTeamChat(op: OutboxOp<"team-chat">, emit: ProcessEmit): Promise<ProcessResult> {
  const payload = op.payload as TeamChatPayload;
  let assistantContent = "";
  let sessionId = payload.sessionId;
  let streamError: string | null = null;

  let imageBase64: string | undefined;
  if (payload.imageBlobKey) {
    const blob = await idbGetBlob(payload.imageBlobKey);
    if (!blob) {
      throw new Error("Photo missing from device cache — re-attach the image");
    }
    imageBase64 = await blobToBase64(blob);
  }

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
        ...(imageBase64
          ? { imageBase64, imageMimeType: payload.imageMimeType }
          : {}),
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
          streamError = describeStreamError(data);
        }
      },
      onError: (err) => {
        // Collapse only — do not re-wrap streamSSE / describeStreamError output.
        streamError = describeApiFailure(err, { path: "/team/chat/stream" }).message;
      },
      onDone: () => {
        if (streamError) {
          finish(new Error(streamError));
          return;
        }
        if (!assistantContent.trim()) {
          finish(new Error("No reply received from the specialist — Ollama may have returned an empty response."));
          return;
        }
        finish();
      },
    }).catch((err) => {
      // Prefer onError message; else collapse once (streamSSE already humanizes fetch failures).
      if (streamError) {
        finish(new Error(streamError));
        return;
      }
      finish(new Error(describeApiFailure(err, { path: "/team/chat/stream" }).message));
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
