/** Pure helpers for Legal Aide Frist kit (scan/confirm → task + calendar + Team deep-link). */

export type FristKitInput = {
  title?: string;
  deadline?: string | null;
  dueDate?: string | null;
  documentId?: string | null;
  archiveName?: string | null;
  description?: string | null;
  entity?: string | null;
};

/** Normalize to YYYY-MM-DD when possible. */
export function fristDay(value: unknown): string | null {
  if (typeof value !== "string" || !value.trim()) return null;
  const day = value.trim().slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(day) ? day : null;
}

export function buildFristKitTitle(input: FristKitInput): string {
  const archiveName = input.archiveName?.trim();
  const entity = input.entity?.trim();
  const explicit = input.title?.trim();
  if (explicit) return explicit.slice(0, 200);
  if (archiveName) return `Deadline (Frist): ${archiveName}`.slice(0, 200);
  if (entity) return `Deadline (Frist): ${entity}`.slice(0, 200);
  return "Deadline (Frist)";
}

/** Checklist opener for Legal Aide — never invents Fristen. */
export function buildFristKitChecklist(input: {
  title: string;
  deadline: string;
  archiveName?: string | null;
  documentId?: string | null;
}): string {
  const lines = [
    "Frist kit — please advise. Use only the deadline below (do not invent Fristen).",
    "",
    `What: ${input.title}`,
    `Deadline (Frist): ${input.deadline}`,
  ];
  if (input.archiveName?.trim()) {
    lines.push(`Document: ${input.archiveName.trim()}`);
  }
  if (input.documentId?.trim()) {
    lines.push(`Document id: ${input.documentId.trim()}`);
  }
  lines.push(
    "",
    "Next actions checklist:",
    "1. What this document/situation is",
    "2. Confirm the Frist date is stated (never invent)",
    "3. Options / risks",
    "4. Concrete next steps before the deadline",
  );
  return lines.join("\n");
}

export function buildLegalAideDeepLink(checklist: string): string {
  const q = encodeURIComponent(checklist.slice(0, 1500));
  return `/team/?specialist=legal_aide&q=${q}`;
}

export function buildFristKitPayload(input: FristKitInput) {
  const deadline = fristDay(input.deadline) ?? fristDay(input.dueDate);
  if (!deadline) {
    throw new Error("Frist kit requires a deadline (Frist) date");
  }
  const title = buildFristKitTitle({ ...input, deadline });
  const archiveName = input.archiveName?.trim() || null;
  const documentId = input.documentId?.trim() || null;
  const description =
    input.description?.trim() ||
    [
      "Frist kit from scan/confirm",
      archiveName ? `Archive: ${archiveName}` : null,
      `Frist: ${deadline}`,
    ]
      .filter(Boolean)
      .join(" · ");
  const checklist = buildFristKitChecklist({
    title,
    deadline,
    archiveName,
    documentId,
  });
  return {
    title,
    deadline,
    documentId,
    archiveName,
    description,
    entity: input.entity?.trim() || null,
    checklist,
    teamHref: buildLegalAideDeepLink(checklist),
  };
}
