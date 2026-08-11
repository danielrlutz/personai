/**
 * Cursor SDK delivery bridge (Phase 2 skeleton).
 *
 * When CURSOR_API_KEY is set, ready batches are enqueued for sequential
 * Agent.create / agent.send. Without a key the server still runs; dispatch
 * is a no-op with a log line (MCP poll remains the fallback).
 *
 * @cursor/sdk is loaded via dynamic import so it is optional at install time.
 */
import { config } from "../config.js";
import { store } from "../store.js";
import type { Batch } from "../types.js";
import { enqueueDispatch } from "./queue.js";

const dispatchedBatchIds = new Set<string>();

export function isSdkDispatchEnabled(): boolean {
  return Boolean(config.cursorApiKey);
}

export function dispatchedCount(): number {
  return dispatchedBatchIds.size;
}

export function enqueueReadyBatch(batch: Batch): void {
  if (!batch.composedPrompt) {
    console.warn(`[agent-debug] skip dispatch ${batch.id}: empty prompt`);
    return;
  }
  if (dispatchedBatchIds.has(batch.id)) return;

  if (!config.cursorApiKey) {
    console.log(
      `[agent-debug] SDK dispatch idle (no CURSOR_API_KEY) — batch ${batch.id} ready for MCP poll`,
    );
    return;
  }

  dispatchedBatchIds.add(batch.id);
  void enqueueDispatch(async () => {
    await dispatchViaSdk(batch);
  });
}

async function dispatchViaSdk(batch: Batch): Promise<void> {
  const prompt = batch.composedPrompt;
  if (!prompt) return;

  let Agent: {
    create: (opts: Record<string, unknown>) => Promise<{
      send: (p: string) => Promise<{ wait: () => Promise<unknown> }>;
      [Symbol.asyncDispose]?: () => Promise<void>;
      close?: () => Promise<void>;
    }>;
  };

  try {
    const mod = (await import("@cursor/sdk")) as {
      Agent: typeof Agent;
    };
    Agent = mod.Agent;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(
      "[agent-debug] @cursor/sdk not available — install optional dep or use MCP poll.",
      msg,
    );
    dispatchedBatchIds.delete(batch.id);
    throw new Error(`@cursor/sdk missing: ${msg}`);
  }

  const cwd = config.repoPath;
  console.log(
    `[agent-debug] SDK dispatch starting batch=${batch.id} cwd=${cwd}`,
  );

  const agent = await Agent.create({
    apiKey: config.cursorApiKey,
    model: { id: config.cursorModel },
    local: { cwd },
  });

  try {
    const run = await agent.send(prompt);
    await run.wait();
    console.log(`[agent-debug] SDK dispatch finished batch=${batch.id}`);
    // Mark messages so UI can show "dispatched"; keep batch ready until ack.
    for (const mid of batch.messageIds) {
      const msg = store.getMessage(mid);
      if (msg && msg.status !== "acked") {
        await store.updateMessage(mid, { status: "composed" });
      }
    }
  } finally {
    if (typeof agent.close === "function") {
      await agent.close();
    } else if (typeof agent[Symbol.asyncDispose] === "function") {
      await agent[Symbol.asyncDispose]!();
    }
  }
}
