import { formatCr, formatPct } from "@/lib/utils/format";
import type { HoldingLiveView } from "@/lib/aum/types";

export function SectorBreakdown({ holdings }: { holdings: HoldingLiveView[] }) {
  const bySector = new Map<string, number>();
  let total = 0;

  for (const h of holdings) {
    bySector.set(h.sector, (bySector.get(h.sector) ?? 0) + h.liveMarketValueCr);
    total += h.liveMarketValueCr;
  }

  const rows = [...bySector.entries()]
    .map(([sector, valueCr]) => ({ sector, valueCr, pct: total !== 0 ? valueCr / total : 0 }))
    .sort((a, b) => b.valueCr - a.valueCr);

  return (
    <div className="space-y-2">
      {rows.map((row) => (
        <div key={row.sector} className="space-y-1">
          <div className="flex items-center justify-between text-sm">
            <span>{row.sector}</span>
            <span className="text-muted-foreground tabular-nums">
              {formatCr(row.valueCr)} · {formatPct(row.pct)}
            </span>
          </div>
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
            <div
              className="h-full rounded-full bg-primary"
              style={{ width: `${Math.min(100, Math.max(0, row.pct * 100))}%` }}
            />
          </div>
        </div>
      ))}
    </div>
  );
}
