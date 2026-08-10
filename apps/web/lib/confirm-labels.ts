/** Human labels for confirmation action codes (API still stores machine keys). */
const ACTION_LABELS: Record<string, string> = {
  "medical.export": "Medical export",
  "ledger.write": "Save to ledger",
  "archive.commit": "File in archive",
  "qr.mark_paid": "Mark bill paid",
  "qr.bill": "QR-Rechnung",
  "career.pdf": "Career PDF",
  "export.generate": "Generate export",
  "document.upload": "Document upload",
  "forge.ship": "Ship code",
  "huddle.propose": "Huddle proposal",
  "premium.spend": "Premium spend (optional cloud)",
  "premium.inference": "Premium inference (optional cloud)",
  "memory.fact": "Remember for later",
  "skill.create": "Add skill",
  "calendar.event": "Calendar (stage locally — Google write not wired)",
  "calendar.event_staged": "Calendar staged locally",
  "fristen.calendar_pack": "Fristen calendar pack (.ics)",
  "legal.frist_kit": "Legal Frist kit",
  "confirm.accept": "Confirmed",
  "confirm.reject": "Rejected",
};

/** Count + singular/plural noun, e.g. countLabel(1, "entry", "entries") → "1 entry". */
export function countLabel(count: number, singular: string, plural: string): string {
  return `${count} ${count === 1 ? singular : plural}`;
}

export function labelForConfirmAction(action: string, payload?: unknown): string {
  const key = action.trim().toLowerCase();
  if (
    key === "ledger.write" &&
    payload &&
    typeof payload === "object" &&
    (payload as { kind?: string }).kind === "qr_bill"
  ) {
    return ACTION_LABELS["qr.bill"];
  }
  if (ACTION_LABELS[key]) return ACTION_LABELS[key];
  // Fallback: medical.export → Medical export
  return action
    .split(/[._]/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join(" ");
}

/** Soften stored summaries (including older queued rows) for display. */
export function humanizeConfirmationSummary(summary: string): string {
  return summary
    .replace(/\((\d+)\s+complaints?\)/gi, (_m, n: string) => {
      const count = Number(n);
      return `(${countLabel(count, "symptom entry", "symptom entries")})`;
    })
    .replace(/\bMark paid \+ ledger:\b/gi, "Mark paid and record payment:")
    .replace(/\bCommit QR bill\b/gi, "Save QR bill")
    .replace(/\bCommit expense\b/gi, "Save expense")
    .replace(/\bUpdate filing memory:\b/gi, "Update how we file:")
    .replace(/\bRemember filing:\b/gi, "Remember how we file:")
    .replace(/\s*→\s*archive\s+/gi, " · file as ")
    .replace(/\s*\(cat\s+(\d+)\)/gi, " (folder $1)")
    .replace(/\s*·\s*Frist\s+(\d{4}-\d{2}-\d{2})/gi, " · deadline (Frist) $1")
    .replace(/\bGenerate career PDF:\b/gi, "Create career PDF:")
    .replace(/\bMEDICAL\.EXPORT\b/gi, "Medical export")
    // Ban shouty Prisma enum leakage in older queued summaries / archive previews
    .replace(/\bBILL\b/g, "Invoice")
    .replace(/\bMEDICAL_RECORD\b/g, "Medical")
    .replace(/\bRECEIPT\b/g, "Quittance");
}

export function labelForEnum(value: string): string {
  return value
    .split(/[._]/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join(" ");
}
