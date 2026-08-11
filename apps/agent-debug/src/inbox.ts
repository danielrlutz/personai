import { randomUUID } from "node:crypto";
import { config } from "./config.js";
import { detectWaitSignal, looksLikeFollowUp } from "./batching.js";
import { captionImage, ensureThumbPath } from "./caption.js";
import { composeBatchPrompt } from "./compose.js";
import { store } from "./store.js";
import type { Batch, ImageMeta, InboxMessage, StatusSnapshot } from "./types.js";

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
};

export async function postMessage(input: PostMessageInput): Promise<{
  message: InboxMessage;
  batch: Batch;
}> {
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
      ackedAt: null,
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
      composeError: null,
    });
    for (const mid of batch.messageIds) {
      await store.updateMessage(mid, { status: "composed" });
    }
    return store.getBatch(batchId)!;
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
      prompt: b.composedPrompt,
      messageIds: b.messageIds,
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
    })),
    pendingMessages,
  };
}

export async function ack(ids: {
  batchIds?: string[];
  messageIds?: string[];
}): Promise<{ ackedBatches: string[]; ackedMessages: string[] }> {
  const ackedBatches: string[] = [];
  const ackedMessages: string[] = [];
  const now = new Date().toISOString();

  for (const id of ids.batchIds ?? []) {
    const batch = store.getBatch(id);
    if (!batch) continue;
    await store.updateBatch(id, { state: "acked", ackedAt: now });
    ackedBatches.push(id);
    for (const mid of batch.messageIds) {
      await store.updateMessage(mid, { status: "acked" });
      ackedMessages.push(mid);
    }
  }

  for (const mid of ids.messageIds ?? []) {
    const msg = store.getMessage(mid);
    if (!msg || msg.status === "acked") continue;
    await store.updateMessage(mid, { status: "acked" });
    ackedMessages.push(mid);
  }

  return { ackedBatches, ackedMessages };
}
