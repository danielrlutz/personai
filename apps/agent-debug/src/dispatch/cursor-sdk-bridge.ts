/**
 * Cursor SDK delivery bridge (Phase 2 skeleton).
 *
 * When CURSOR_API_KEY is set, ready batches are enqueued for sequential
 * Agent.create / agent.send. Without a key the server still runs; dispatch
 * is a no-op with a log line (MCP poll remains the fallback).
 *
 * Poll never consumes prompts — only explicit ack (or SDK success) removes
 * items from the active pending queue.
 *
 * @cursor/sdk is loaded via dynamic import so it is optional at install time.
 */
import { config } from "../config.js";
import { store } from "../store.js";
import type { Batch } from "../types.js";
import { enqueueDispatch } from "./queue.js";

/** In-process guard against double-enqueue within one server lifetime. */
const enqueuedBatchIds = new Set<string>();

export function isSdkDispatchEnabled(): boolean {
  return Boolean(config.cursorApiKey);
}

export function dispatchedCount(): number {
  return store
    .batchesByState("ready")
    .filter((b) => b.dispatchedAt || b.cursorAgentId || b.cursorRunId).length;
}

/** Re-enqueue ready batches that were never dispatched (e.g. key set after compose). */
export function replayUndispatchedReadyBatches(batchId?: string): number {
  let enqueued = 0;
  for (const batch of store.batchesByState("ready")) {
    if (batchId && batch.id !== batchId) continue;
    if (batch.dispatchedAt || !batch.composedPrompt) continue;
    const before = enqueuedBatchIds.has(batch.id);
    enqueueReadyBatch(batch);
    if (!before && enqueuedBatchIds.has(batch.id)) enqueued += 1;
  }
  return enqueued;
}

export function enqueueReadyBatch(batch: Batch): void {
  if (!batch.composedPrompt) {
    console.warn(`[agent-debug] skip dispatch ${batch.id}: empty prompt`);
    return;
  }
  if (enqueuedBatchIds.has(batch.id)) return;

  const latest = store.getBatch(batch.id);
  if (latest?.dispatchedAt) {
    console.log(
      `[agent-debug] skip dispatch ${batch.id}: already dispatched at ${latest.dispatchedAt}`,
    );
    return;
  }

  if (!config.cursorApiKey) {
    console.log(
      `[agent-debug] SDK dispatch idle (no CURSOR_API_KEY) — batch ${batch.id} ready for MCP poll`,
    );
    return;
  }

  enqueuedBatchIds.add(batch.id);
  void enqueueDispatch(async () => {
    await dispatchViaSdk(batch.id);
  });
}

async function dispatchViaSdk(batchId: string): Promise<void> {
  const batch = store.getBatch(batchId);
  if (!batch?.composedPrompt) return;
  if (batch.dispatchedAt) return;

  const prompt = batch.composedPrompt;

  type SDKAgent = {
    readonly agentId: string;
    send: (p: string) => Promise<SDKRun>;
    close?: () => Promise<void>;
    [Symbol.asyncDispose]?: () => Promise<void>;
  };

  type SDKRun = {
    readonly id: string;
    readonly requestId?: string;
    wait: () => Promise<unknown>;
  };

  let Agent: {
    create: (opts: Record<string, unknown>) => Promise<SDKAgent>;
  };

  try {
    const mod = (await import("@cursor/sdk")) as unknown as {
      Agent: {
        create: (opts: Record<string, unknown>) => Promise<SDKAgent>;
      };
    };
    Agent = mod.Agent;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(
      "[agent-debug] @cursor/sdk not available — install optional dep or use MCP poll.",
      msg,
    );
    enqueuedBatchIds.delete(batchId);
    throw new Error(`@cursor/sdk missing: ${msg}`);
  }

  const cwd = config.repoPath;
  console.log(
    `[agent-debug] SDK dispatch starting batch=${batchId} cwd=${cwd}`,
  );

  const agent = await Agent.create({
    apiKey: config.cursorApiKey,
    model: { id: config.cursorModel },
    local: { cwd },
  });

  const cursorAgentId = agent.agentId;

  try {
    const run = await agent.send(prompt);
    const cursorRunId = run.id || run.requestId || null;

    const dispatchedAt = new Date().toISOString();
    await store.updateBatch(batchId, {
      cursorAgentId,
      cursorRunId,
      dispatchedAt,
    });

    console.log(
      `[agent-debug] SDK dispatch running batch=${batchId} agent=${cursorAgentId} run=${cursorRunId ?? "?"}`,
    );

    await run.wait();
    console.log(
      `[agent-debug] SDK dispatch finished batch=${batchId} agent=${cursorAgentId} run=${cursorRunId ?? "?"} — awaiting balcony Done / Mark live`,
    );
  } finally {
    if (typeof agent.close === "function") {
      await agent.close();
    } else if (typeof agent[Symbol.asyncDispose] === "function") {
      await agent[Symbol.asyncDispose]!();
    }
  }
}
