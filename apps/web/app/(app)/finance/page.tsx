import Link from "next/link";
import { List, MessageSquare } from "lucide-react";
import { BudgetOverview } from "@/components/finance/BudgetOverview";
import { QRBillList } from "@/components/finance/QRBillList";
import { Button } from "@/components/ui/button";

export default function FinancePage() {
  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Finance</h1>
          <p className="mt-1 text-muted-foreground">Budget overview, QR bills, and cashflow.</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" asChild>
            <Link href="/finance/transactions">
              <List className="mr-2 h-4 w-4" />
              Transactions
            </Link>
          </Button>
          <Button asChild>
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
