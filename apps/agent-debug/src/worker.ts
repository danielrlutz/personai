import { config } from "./config.js";
import { composeReadyBatches, flushTimedOutBatches } from "./inbox.js";

let timer: NodeJS.Timeout | null = null;
let running = false;

async function tick(): Promise<void> {
  if (running) return;
  running = true;
  try {
    await flushTimedOutBatches();
    await composeReadyBatches();
  } catch (err) {
    console.error("[agent-debug] worker tick failed", err);
  } finally {
    running = false;
  }
}

export function startWorker(): void {
  if (timer) return;
  void tick();
  timer = setInterval(() => void tick(), config.workerMs);
  timer.unref?.();
}

export function stopWorker(): void {
  if (timer) clearInterval(timer);
  timer = null;
}
