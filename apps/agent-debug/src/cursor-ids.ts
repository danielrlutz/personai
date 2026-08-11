import os from "node:os";
import path from "node:path";
import { config } from "./config.js";
import type { Batch, CursorDispatchInfo } from "./types.js";

/** Encode repo cwd into Cursor's `.cursor/projects/<slug>` folder name. */
export function cursorProjectSlug(repoPath: string): string {
  const resolved = path.resolve(repoPath);
  const withDrive = resolved.replace(/^([A-Za-z]):[/\\]/, (_, d: string) => `${d.toLowerCase()}-`);
  return withDrive.replace(/[/\\]+/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "");
}

/** Best-effort local transcript path hint (agent-transcripts may use run/agent uuid). */
export function cursorTranscriptHint(
  agentId: string | null | undefined,
  runId?: string | null,
): string | null {
  if (!agentId) return null;
  const slug = cursorProjectSlug(config.repoPath);
  const home = os.homedir();
  const base = path.join(home, ".cursor", "projects", slug, "agent-transcripts");
  const id = runId || agentId;
  return path.join(base, `${id}.jsonl`);
}

export function cursorDispatchInfo(batch: Batch): CursorDispatchInfo {
  return {
    cursorAgentId: batch.cursorAgentId ?? null,
    cursorRunId: batch.cursorRunId ?? null,
    dispatchedAt: batch.dispatchedAt ?? null,
    cursorTranscriptHint: cursorTranscriptHint(
      batch.cursorAgentId,
      batch.cursorRunId,
    ),
  };
}
