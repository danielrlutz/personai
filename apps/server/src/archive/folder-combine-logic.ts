/**
 * Pure helpers for Drive folder combine (no Drive / DB I/O).
 */

export type CombineConflictAction =
  | "keep_destination"
  | "keep_incoming"
  | "keep_both"
  | "skip";

export type CombineFileDecision = {
  action: CombineConflictAction;
  /** Only honored with keep_incoming — trashes the existing destination item. */
  trashOther?: boolean;
};

/** Split "report.pdf" → { base: "report", ext: ".pdf" }; folders keep full name as base. */
export function splitFileName(name: string, isFolder: boolean): { base: string; ext: string } {
  if (isFolder) return { base: name, ext: "" };
  const idx = name.lastIndexOf(".");
  if (idx <= 0) return { base: name, ext: "" };
  return { base: name.slice(0, idx), ext: name.slice(idx) };
}

/** Windows Explorer–style: "file.pdf" → "file (1).pdf". */
export function nextAutoRename(name: string, taken: Set<string>, isFolder = false): string {
  const lowerTaken = new Set([...taken].map((n) => n.toLowerCase()));
  if (!lowerTaken.has(name.toLowerCase())) return name;
  const { base, ext } = splitFileName(name, isFolder);
  const m = /^(.*?) \((\d+)\)$/.exec(base);
  const stem = m ? m[1]! : base;
  let n = m ? Number(m[2]) + 1 : 1;
  for (;;) {
    const candidate = `${stem} (${n})${ext}`;
    if (!lowerTaken.has(candidate.toLowerCase())) return candidate;
    n += 1;
  }
}

/** Rename destination aside so incoming can keep its name (no delete). */
export function nextKeptAsideName(name: string, taken: Set<string>, isFolder = false): string {
  const { base, ext } = splitFileName(name, isFolder);
  let n = 1;
  for (;;) {
    const candidate = `${base} (kept ${n})${ext}`;
    if (![...taken].some((t) => t.toLowerCase() === candidate.toLowerCase())) {
      return candidate;
    }
    n += 1;
  }
}

export function resolveDecision(
  hasConflict: boolean,
  decision: CombineFileDecision | undefined,
): CombineConflictAction {
  if (!hasConflict) return "keep_both"; // unused — non-conflicts always move
  const action = decision?.action ?? "keep_both";
  if (
    action === "keep_destination" ||
    action === "keep_incoming" ||
    action === "keep_both" ||
    action === "skip"
  ) {
    return action;
  }
  return "keep_both";
}
