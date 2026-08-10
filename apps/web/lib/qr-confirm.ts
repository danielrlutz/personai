/** Helpers for Swiss QR-Rechnung confirm cockpit. */

export type QrConfirmFields = {
  creditorName: string;
  iban: string;
  amount: number | null;
  currency: string;
  reference: string | null;
  referenceType: string | null;
  dueDate: string | null;
  fileArchive: boolean;
  /** ledger.write qr_bill: mark paid + expense on confirm */
  markPaid: boolean;
  /** qr.mark_paid: write expense transaction */
  writeLedger: boolean;
  kind: "qr_bill" | null;
};

function payloadRecord(payload: unknown): Record<string, unknown> {
  return payload && typeof payload === "object" ? (payload as Record<string, unknown>) : {};
}

export function isQrConfirm(action: string, payload: unknown): boolean {
  if (action === "qr.mark_paid") return true;
  if (action !== "ledger.write") return false;
  return payloadRecord(payload).kind === "qr_bill";
}

export function qrFieldsFromPayload(action: string, payload: unknown): QrConfirmFields {
  const p = payloadRecord(payload);
  const amountRaw = p.amount;
  const amount =
    typeof amountRaw === "number" && Number.isFinite(amountRaw)
      ? amountRaw
      : typeof amountRaw === "string" && amountRaw.trim() && Number.isFinite(Number(amountRaw))
        ? Number(amountRaw)
        : null;
  const isMarkPaid = action === "qr.mark_paid";
  return {
    creditorName: String(p.creditorName ?? p.entity ?? "Unknown"),
    iban: String(p.iban ?? ""),
    amount,
    currency: String(p.currency ?? "CHF"),
    reference: p.reference ? String(p.reference) : null,
    referenceType: p.referenceType ? String(p.referenceType) : null,
    dueDate: p.dueDate ? String(p.dueDate).slice(0, 10) : null,
    fileArchive: isMarkPaid ? p.fileArchive === true : p.fileArchive !== false,
    markPaid: p.markPaid === true,
    writeLedger: p.writeLedger !== false,
    kind: p.kind === "qr_bill" ? "qr_bill" : null,
  };
}

/** Prefill prompt for CFO Team chat deep-link. */
export function buildCfoQrPrompt(fields: QrConfirmFields): string {
  const lines = [
    "Please review this Swiss QR-Rechnung (Zahlteil):",
    `Creditor: ${fields.creditorName}`,
    fields.iban ? `IBAN: ${fields.iban}` : null,
    fields.amount != null
      ? `Amount: ${fields.amount} ${fields.currency}`
      : `Amount: open (${fields.currency})`,
    fields.reference
      ? `Reference${fields.referenceType ? ` (${fields.referenceType})` : ""}: ${fields.reference}`
      : "Reference: (none)",
    fields.dueDate ? `Due: ${fields.dueDate}` : null,
    "",
    "Flag anything odd before I confirm archive / paid → ledger.",
  ];
  return lines.filter((l) => l !== null).join("\n");
}

export function cfoQrDeepLink(fields: QrConfirmFields): string {
  const q = encodeURIComponent(buildCfoQrPrompt(fields));
  return `/team/?specialist=cfo&q=${q}`;
}
