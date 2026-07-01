import Link from "next/link";
import { Card, CardAction, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { AumDeltaBadge } from "./aum-delta-badge";
import { formatCr } from "@/lib/utils/format";
import type { AmcLiveAum } from "@/lib/aum/types";

export function AmcCard({ amc }: { amc: AmcLiveAum }) {
  return (
    <Link href={`/amc/${amc.slug}`}>
      <Card className="h-full transition-colors hover:border-foreground/30">
        <CardHeader>
          <CardTitle>{amc.overviewName}</CardTitle>
          <CardAction>
            <AumDeltaBadge deltaCr={amc.deltaCr} deltaPct={amc.deltaPct} />
          </CardAction>
        </CardHeader>
        <CardContent className="space-y-1">
          <div className="text-2xl font-semibold tabular-nums">{formatCr(amc.liveAumCr)}</div>
          <div className="text-sm text-muted-foreground">
            Reported: {formatCr(amc.reportedAumCr)}
          </div>
          {amc.stalePricedCount > 0 && (
            <div className="text-xs text-amber-600 dark:text-amber-400">
              {amc.stalePricedCount} holding(s) using stale price
            </div>
          )}
        </CardContent>
      </Card>
    </Link>
  );
}
