import Link from "next/link";
import { List, MessageSquare } from "lucide-react";
import { BudgetOverview } from "@/components/finance/BudgetOverview";
import { QRBillList } from "@/components/finance/QRBillList";
import { Button } from "@/components/ui/button";

export default function FinancePage() {
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="md-title-large text-[26px] tracking-tight">Finance</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Budget templates, QR bills, and cashflow.
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" asChild>
            <Link href="/finance/transactions">
              <List className="mr-2 h-4 w-4" />
              Transactions
            </Link>
          </Button>
          <Button size="sm" asChild>
            <Link href="/finance/advisor">
              <MessageSquare className="mr-2 h-4 w-4" />
              Advisor
            </Link>
          </Button>
        </div>
      </div>
      <BudgetOverview />
      <QRBillList />
    </div>
  );
}
