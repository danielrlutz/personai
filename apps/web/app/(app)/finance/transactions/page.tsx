import { TransactionTable } from "@/components/finance/TransactionTable";

export default function TransactionsPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Transactions</h1>
        <p className="mt-1 text-muted-foreground">All income, expenses, and transfers.</p>
      </div>
      <TransactionTable />
    </div>
  );
}
