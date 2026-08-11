/**
 * Single-flight sequential queue for Cursor SDK dispatches.
 * Ensures only one agent run is in flight at a time.
 */

type Job = () => Promise<void>;

let chain: Promise<void> = Promise.resolve();
let depth = 0;
let lastError: string | null = null;

export function enqueueDispatch(job: Job): Promise<void> {
  depth += 1;
  const run = chain.then(async () => {
    try {
      await job();
      lastError = null;
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);
      console.error("[agent-debug] dispatch job failed:", lastError);
    } finally {
      depth = Math.max(0, depth - 1);
    }
  });
  // Keep the chain alive even if a job fails.
  chain = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

export function dispatchQueueSnapshot(): {
  pending: number;
  lastError: string | null;
} {
  return { pending: depth, lastError };
}
