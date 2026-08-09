import Link from "next/link";
import { List, MessageSquare } from "lucide-react";
import { BudgetOverview } from "@/components/finance/BudgetOverview";
import { QRBillList } from "@/components/finance/QRBillList";
import { ConfirmGate } from "@/components/confirm/ConfirmGate";
import { Button } from "@/components/ui/button";
import { PageEnter } from "@/components/motion/PageEnter";

export default function FinancePage() {
  return (
    <PageEnter className="mx-auto max-w-5xl space-y-6">
      <div className="page-header flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <h1 className="page-title">Finance</h1>
          <p className="page-subtitle">
            Budgets, Swiss QR bills, and cash flow. Saving payments needs your confirmation.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" size="sm" asChild>
            <Link href="/finance/transactions/">
              <List className="mr-1.5 h-4 w-4" />
              Transactions
            </Link>
          </Button>
          <Button size="sm" asChild>
            <Link href="/team/?specialist=cfo">
              <MessageSquare className="mr-1.5 h-4 w-4" />
              Ask finance
            </Link>
          </Button>
        </div>
      </div>
      <ConfirmGate />
      <div className="space-y-4">
        <BudgetOverview />
        <QRBillList />
      </div>
    </PageEnter>
  );
}
