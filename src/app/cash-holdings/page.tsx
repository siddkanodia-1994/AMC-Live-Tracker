import { CashHoldingsTable } from "@/components/cash-holdings/cash-holdings-table";

export const dynamic = "force-dynamic";

export default function CashHoldingsPage() {
  return (
    <div className="mx-auto max-w-6xl space-y-6 px-4 py-8 sm:px-6">
      <div>
        <h1 className="text-2xl font-semibold">Cash Holdings</h1>
        <p className="text-sm text-muted-foreground">Industry-wide Cash &amp; Cash Equivalent % of AUM, by AMC</p>
      </div>
      <CashHoldingsTable />
    </div>
  );
}
