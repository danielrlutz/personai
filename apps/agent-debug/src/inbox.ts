import { randomUUID } from "node:crypto";
import { config } from "./config.js";
import { cursorDispatchInfo } from "./cursor-ids.js";
import { detectWaitSignal, looksLikeFollowUp } from "./batching.js";
import { captionImage, ensureThumbPath } from "./caption.js";
import { composeBatchPrompt } from "./compose.js";
import {
  dispatchedCount,
  enqueueReadyBatch,
  isSdkDispatchEnabled,
} from "./dispatch/cursor-sdk-bridge.js";
import { dispatchQueueSnapshot } from "./dispatch/queue.js";
import { batchLifecycle } from "./lifecycle.js";
import { store } from "./store.js";
import type { AckReason, Batch, DeployStatus, ImageMeta, InboxMessage, StatusSnapshot } from "./types.js";

export type PostMessageInput = {
  sessionId?: string;
  text?: string;
  urgent?: boolean;
  images?: Array<{
    filename: string;
    mimeType: string;
    size: number;
    path: string;
  }>;
  /** Force flush after this message */
  sendNow?: boolean;
  /** Deploy script: mark batch live after VPS deploy */
  deployBatchId?: string;
  deployStatus?: DeployStatus;
  deployNote?: string;
};

export async function postMessage(input: PostMessageInput): Promise<{
  message: InboxMessage;
  batch: Batch;
  deploy?: { batchId: string; deployStatus: DeployStatus; deployedAt: string | null };
}> {
  if (input.deployBatchId && input.deployStatus) {
    const deployed = await markDeployed(input.deployBatchId, input.deployNote, input.deployStatus);
    const batch = store.getBatch(input.deployBatchId)!;
    const firstMsg = batch.messageIds
      .map((id) => store.getMessage(id))
      .find((m): m is InboxMessage => Boolean(m));
    if (!firstMsg) {
      throw new Error(`batch has no messages: ${input.deployBatchId}`);
    }
    return { message: firstMsg, batch, deploy: deployed };
  }

  const session = store.getOrCreateSession(input.sessionId);
  const text = (input.text ?? "").trim();
  const urgent = Boolean(input.urgent);
  const signal = detectWaitSignal(text);
  const sendNow = Boolean(input.sendNow) || signal.flushNow;

  const images: ImageMeta[] = [];
  for (const img of input.images ?? []) {
    const id = randomUUID();
    const meta: ImageMeta = {
      id,
      filename: img.filename,
      mimeType: img.mimeType,
      size: img.size,
      path: img.path,
      thumbPath: ensureThumbPath(img.path, id),
      caption: null,
    };
    meta.caption = await captionImage(meta);
    images.push(meta);
  }

  let batch =
    store.openBatches(session.id)[0] ??
    (looksLikeFollowUp(text, images.length)
      ? store
          .batchesByState("awaiting_more")
          .find((b) => b.sessionId === session.id)
      : undefined);

  if (!batch) {
    batch = {
      id: randomUUID(),
      sessionId: session.id,
      state: "collecting",
      messageIds: [],
      urgent: false,
      awaitingReason: null,
      awaitingUntil: null,
      composedPrompt: null,
      composeError: null,
      createdAt: new Date().toISOString(),
      readyAt: null,
      composedAt: null,
      dispatchedAt: null,
      cursorAgentId: null,
      cursorRunId: null,
      ackedAt: null,
      ackReason: null,
      deployStatus: "none",
      deployNote: null,
      deployedAt: null,
    };
    await store.addBatch(batch);
  }

  const message: InboxMessage = {
    id: randomUUID(),
    sessionId: session.id,
    text,
    images,
    urgent,
    createdAt: new Date().toISOString(),
    batchId: batch.id,
    status: "batched",
  };
  await store.addMessage(message);

  batch.messageIds.push(message.id);
  if (urgent) batch.urgent = true;

  if (sendNow) {
    batch.state = "ready_to_compose";
    batch.awaitingReason = null;
    batch.awaitingUntil = null;
  } else if (signal.awaitingMore) {
    batch.state = "awaiting_more";
    batch.awaitingReason = signal.reason;
    batch.awaitingUntil = new Date(Date.now() + config.batchTimeoutMs).toISOString();
  } else if (batch.state === "awaiting_more") {
    // If we were waiting for pictures/follow-up and this message delivers images, flush.
    const waitingForMedia = /picture|image|photo|pic|follow-up|second/i.test(
      batch.awaitingReason ?? "",
    );
    if (waitingForMedia && images.length > 0) {
      batch.state = "ready_to_compose";
      batch.awaitingReason = null;
      batch.awaitingUntil = null;
    }
    // else stay awaiting until timeout / send now
  } else {
    // single message with no wait signal → compose soon
    batch.state = "ready_to_compose";
    batch.awaitingReason = null;
    batch.awaitingUntil = null;
  }

  await store.updateBatch(batch.id, batch);
  return { message, batch: store.getBatch(batch.id)! };
}

export async function composeNow(batchId?: string, sessionId?: string): Promise<Batch[]> {
  const targets: Batch[] = [];
  if (batchId) {
    const b = store.getBatch(batchId);
    if (b) targets.push(b);
  } else {
    const open = store
      .batchesByState("collecting", "awaiting_more", "ready_to_compose")
      .filter((b) => !sessionId || b.sessionId === sessionId);
    targets.push(...open);
  }

  const out: Batch[] = [];
  for (const batch of targets) {
    await store.updateBatch(batch.id, {
      state: "ready_to_compose",
      awaitingReason: null,
      awaitingUntil: null,
    });
    const composed = await runCompose(batch.id);
    if (composed) out.push(composed);
  }
  return out;
}

export async function runCompose(batchId: string): Promise<Batch | null> {
  const batch = store.getBatch(batchId);
  if (!batch) return null;
  if (batch.state === "ready" || batch.state === "acked") return batch;

  await store.updateBatch(batchId, { state: "composing", composeError: null });
  try {
    const prompt = await composeBatchPrompt(store.getBatch(batchId)!);
    const readyAt = new Date().toISOString();
    await store.updateBatch(batchId, {
      state: "ready",
      composedPrompt: prompt,
      readyAt,
      composedAt: readyAt,
      composeError: null,
    });
    for (const mid of batch.messageIds) {
      await store.updateMessage(mid, { status: "composed" });
    }
    const ready = store.getBatch(batchId)!;
    // Primary delivery path (no-op without CURSOR_API_KEY). MCP poll remains fallback.
    enqueueReadyBatch(ready);
    return ready;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await store.updateBatch(batchId, {
      state: "ready_to_compose",
      composeError: message,
    });
    return store.getBatch(batchId)!;
  }
}

export async function flushTimedOutBatches(): Promise<void> {
  const now = Date.now();
  for (const batch of store.batchesByState("awaiting_more")) {
    if (!batch.awaitingUntil) continue;
    if (Date.parse(batch.awaitingUntil) <= now) {
      await store.updateBatch(batch.id, {
        state: "ready_to_compose",
        awaitingReason: batch.awaitingReason
          ? `${batch.awaitingReason} (timeout)`
          : "timeout",
        awaitingUntil: null,
      });
    }
  }
}

export async function composeReadyBatches(): Promise<void> {
  for (const batch of store.batchesByState("ready_to_compose")) {
    await runCompose(batch.id);
  }
}

export function getStatus(): StatusSnapshot {
  const awaiting = store.batchesByState("awaiting_more");
  const ready = store.batchesByState("ready");
  const pendingMsgs = store
    .listMessages()
    .filter((m) => m.status === "pending" || m.status === "batched");
  const dq = dispatchQueueSnapshot();
  return {
    ok: true,
    queueDepth: ready.length + awaiting.length + store.batchesByState("ready_to_compose", "composing").length,
    readyPrompts: ready.length,
    pendingMessages: pendingMsgs.length,
    awaitingMore: awaiting.map((b) => ({
      batchId: b.id,
      reason: b.awaitingReason,
      until: b.awaitingUntil,
      messageCount: b.messageIds.length,
    })),
    lastActivityAt: store.lastActivityAt(),
    composeModel: config.composeModel,
    visionModel: config.visionModel,
    sdkDispatchEnabled: isSdkDispatchEnabled(),
    dispatchedPrompts: dispatchedCount(),
    dispatchQueuePending: dq.pending,
    dispatchLastError: dq.lastError,
    readyDispatches: ready.map((b) => ({
      batchId: b.id,
      urgent: b.urgent,
      readyAt: b.readyAt,
      ...cursorDispatchInfo(b),
    })),
  };
}

export function listPending() {
  const ready = store.batchesByState("ready");
  const open = store.batchesByState(
    "collecting",
    "awaiting_more",
    "ready_to_compose",
    "composing",
  );
  const pendingMessages = store
    .listMessages()
    .filter((m) => m.status === "pending" || m.status === "batched");

  return {
    readyPrompts: ready.map((b) => ({
      batchId: b.id,
      sessionId: b.sessionId,
      urgent: b.urgent,
      readyAt: b.readyAt,
      composedAt: b.composedAt ?? b.readyAt,
      prompt: b.composedPrompt,
      messageIds: b.messageIds,
      lifecycle: batchLifecycle(b),
      ...cursorDispatchInfo(b),
      deployStatus: b.deployStatus,
      deployNote: b.deployNote,
      deployedAt: b.deployedAt,
    })),
    openBatches: open.map((b) => ({
      batchId: b.id,
      sessionId: b.sessionId,
      state: b.state,
      urgent: b.urgent,
      awaitingReason: b.awaitingReason,
      awaitingUntil: b.awaitingUntil,
      messageIds: b.messageIds,
      composeError: b.composeError,
      lifecycle: batchLifecycle(b),
    })),
    pendingMessages,
  };
}

export async function ack(ids: {
  batchIds?: string[];
  messageIds?: string[];
  reason?: AckReason;
}): Promise<{
  ackedBatches: Array<{ batchId: string; reason: AckReason; ackedAt: string }>;
  ackedMessages: Array<{ messageId: string; reason: AckReason; ackedAt: string }>;
}> {
  const reason = ids.reason ?? "implemented";
  const ackedBatches: Array<{ batchId: string; reason: AckReason; ackedAt: string }> =
    [];
  const ackedMessages: Array<{
    messageId: string;
    reason: AckReason;
    ackedAt: string;
  }> = [];

  for (const id of ids.batchIds ?? []) {
    const result = await store.archiveBatch(id, reason);
    if (!result) continue;
    ackedBatches.push({
      batchId: id,
      reason,
      ackedAt: result.batch.ackedAt,
    });
    for (const msg of result.messages) {
      ackedMessages.push({
        messageId: msg.id,
        reason,
        ackedAt: msg.ackedAt,
      });
    }
  }

  const batchAckedMsgIds = new Set(
    ackedMessages.map((m) => m.messageId),
  );
  for (const mid of ids.messageIds ?? []) {
    if (batchAckedMsgIds.has(mid)) continue;
    const archived = await store.archiveMessage(mid, reason);
    if (!archived) continue;
    ackedMessages.push({
      messageId: mid,
      reason,
      ackedAt: archived.ackedAt,
    });
  }

  return { ackedBatches, ackedMessages };
}

export function listArchive(limit = 20) {
  return {
    archivedBatches: store.listArchivedBatches(limit).map((b) => ({
      batchId: b.id,
      sessionId: b.sessionId,
      urgent: b.urgent,
      readyAt: b.readyAt,
      composedAt: b.composedAt ?? b.readyAt,
      ackedAt: b.ackedAt,
      ackReason: b.ackReason,
      promptPreview: (b.composedPrompt || "").slice(0, 200),
      lifecycle: batchLifecycle(b),
      deployStatus: b.deployStatus,
      deployNote: b.deployNote,
      deployedAt: b.deployedAt,
      ...cursorDispatchInfo(b),
    })),
  };
}

export async function markDeployed(
  batchId: string,
  deployNote?: string | null,
  deployStatus: DeployStatus = "live",
): Promise<{ batchId: string; deployStatus: DeployStatus; deployedAt: string | null }> {
  const batch = store.getBatch(batchId);
  if (!batch) throw new Error(`batch not found: ${batchId}`);

  const deployedAt = deployStatus === "live" ? new Date().toISOString() : batch.deployedAt;
  await store.updateBatch(batchId, {
    deployStatus,
    deployNote: deployNote?.trim() || batch.deployNote,
    deployedAt,
  });
  return { batchId, deployStatus, deployedAt };
}

export function enrichMessages(sessionId?: string) {
  return store.listMessages(sessionId).map((m) => {
    const batch = m.batchId ? store.getBatch(m.batchId) : undefined;
    const lifecycle = batch ? batchLifecycle(batch) : null;
    return {
      ...m,
      lifecycle,
      composedPromptPreview: batch?.composedPrompt
        ? batch.composedPrompt.slice(0, 320)
        : null,
      ...(batch ? cursorDispatchInfo(batch) : {}),
    };
  });
}
