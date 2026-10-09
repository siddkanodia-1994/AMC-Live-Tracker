import { asc, sql } from "drizzle-orm";
import { db } from "../db/client";
import { industryMonthlyFlow } from "../db/schema";

export interface MonthlyFlowPoint {
  monthEndDate: string;
  sipContributionsCr: number;
  equityNetFlowsCr: number;
  // Always derived, never stored -- see schema.ts's comment on this table.
  equityBulkFlowsCr: number;
}

export async function upsertMonthlyFlow(
  monthEndDate: string,
  sipContributionsCr: number,
  equityNetFlowsCr: number
): Promise<void> {
  await db
    .insert(industryMonthlyFlow)
    .values({
      monthEndDate,
      sipContributionsCr: String(sipContributionsCr),
      equityNetFlowsCr: String(equityNetFlowsCr),
    })
    .onConflictDoUpdate({
      target: industryMonthlyFlow.monthEndDate,
      set: {
        sipContributionsCr: sql`excluded.sip_contributions_cr`,
        equityNetFlowsCr: sql`excluded.equity_net_flows_cr`,
        computedAt: sql`now()`,
      },
    });
}

export async function getAllMonthlyFlows(): Promise<MonthlyFlowPoint[]> {
  const rows = await db
    .select()
    .from(industryMonthlyFlow)
    .orderBy(asc(industryMonthlyFlow.monthEndDate));
  return rows.map((r) => {
    const sip = Number(r.sipContributionsCr);
    const netFlow = Number(r.equityNetFlowsCr);
    return {
      monthEndDate: r.monthEndDate,
      sipContributionsCr: sip,
      equityNetFlowsCr: netFlow,
      equityBulkFlowsCr: netFlow - sip,
    };
  });
}
