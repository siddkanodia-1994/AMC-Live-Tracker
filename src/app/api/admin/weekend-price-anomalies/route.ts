import { NextResponse } from "next/server";
import { withAdminAuth } from "@/lib/api/with-admin-auth";
import { getWeekendPriceAnomalies } from "@/lib/aum/weekend-price-anomalies";

// Read-only detection check for the Admin page's "Weekend Price Anomalies"
// card -- see weekend-price-anomalies.ts for what this flags and why.
export const GET = withAdminAuth(async () => {
  const anomalies = await getWeekendPriceAnomalies();
  return NextResponse.json({ anomalies });
});
