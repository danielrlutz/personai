"use client";

import Link from "next/link";
import { MessageSquare } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cfoQrDeepLink, type QrConfirmFields } from "@/lib/qr-confirm";
import { formatCHF, formatDate } from "@/lib/utils";

export function QrConfirmCockpit({
  fields,
  isMarkPaidAction,
  busy,
  onChange,
}: {
  fields: QrConfirmFields;
  isMarkPaidAction: boolean;
  busy?: boolean;
  onChange: (next: QrConfirmFields) => void;
}) {
  return (
    <div className="space-y-3 rounded-lg border border-border/60 bg-background/50 px-3 py-2.5">
      <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
        Zahlteil
      </p>
      <dl className="grid gap-2 text-sm sm:grid-cols-2">
        <div className="min-w-0 sm:col-span-2">
          <dt className="text-[11px] text-muted-foreground">Creditor</dt>
          <dd className="truncate font-medium">{fields.creditorName}</dd>
        </div>
        <div className="min-w-0 sm:col-span-2">
          <dt className="text-[11px] text-muted-foreground">IBAN</dt>
          <dd className="break-all font-mono text-xs tracking-wide">{fields.iban || "—"}</dd>
        </div>
        <div>
          <dt className="text-[11px] text-muted-foreground">Amount</dt>
          <dd className="font-medium tabular-nums">
            {fields.amount != null
              ? formatCHF(fields.amount, fields.currency)
              : `Open · ${fields.currency}`}
          </dd>
        </div>
        <div>
          <dt className="text-[11px] text-muted-foreground">Reference</dt>
          <dd className="break-all font-mono text-xs">
            {fields.reference
              ? `${fields.referenceType ? `${fields.referenceType} · ` : ""}${fields.reference}`
              : "—"}
          </dd>
        </div>
        {fields.dueDate ? (
          <div className="sm:col-span-2">
            <dt className="text-[11px] text-muted-foreground">Due</dt>
            <dd className="text-sm">{formatDate(fields.dueDate)}</dd>
          </div>
        ) : null}
      </dl>

      <div className="space-y-2 border-t border-border/50 pt-2">
        <label className="flex cursor-pointer items-start gap-2.5 text-sm">
          <input
            type="checkbox"
            className="mt-0.5 rounded border-border"
            checked={fields.fileArchive}
            disabled={busy}
            onChange={(e) => onChange({ ...fields, fileArchive: e.target.checked })}
          />
          <span>
            <span className="font-medium">File archive</span>
            <span className="block text-xs text-muted-foreground">
              Commit local archive naming and queue Drive upload.
            </span>
          </span>
        </label>
        {isMarkPaidAction ? (
          <label className="flex cursor-pointer items-start gap-2.5 text-sm">
            <input
              type="checkbox"
              className="mt-0.5 rounded border-border"
              checked={fields.writeLedger}
              disabled={busy}
              onChange={(e) => onChange({ ...fields, writeLedger: e.target.checked })}
            />
            <span>
              <span className="font-medium">Mark paid → ledger</span>
              <span className="block text-xs text-muted-foreground">
                Record the expense transaction when marking paid.
              </span>
            </span>
          </label>
        ) : (
          <label className="flex cursor-pointer items-start gap-2.5 text-sm">
            <input
              type="checkbox"
              className="mt-0.5 rounded border-border"
              checked={fields.markPaid}
              disabled={busy}
              onChange={(e) => onChange({ ...fields, markPaid: e.target.checked })}
            />
            <span>
              <span className="font-medium">Mark paid → ledger</span>
              <span className="block text-xs text-muted-foreground">
                Save bill as paid and write the expense in one confirm.
              </span>
            </span>
          </label>
        )}
      </div>

      <Button size="sm" variant="ghost" className="h-8 px-2" asChild>
        <Link href={cfoQrDeepLink(fields)}>
          <MessageSquare className="mr-1 h-3.5 w-3.5" />
          Ask CFO
        </Link>
      </Button>
    </div>
  );
}
