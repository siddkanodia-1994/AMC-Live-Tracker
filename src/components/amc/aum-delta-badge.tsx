import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { formatDeltaCr, formatPct } from "@/lib/utils/format";

export function AumDeltaBadge({ deltaCr, deltaPct }: { deltaCr: number; deltaPct: number }) {
  const isFlat = Math.abs(deltaCr) < 0.01;
  const isPositive = deltaCr > 0;

  return (
    <Badge
      variant="outline"
      className={cn(
        "font-mono",
        !isFlat && isPositive && "border-emerald-500/40 text-emerald-600 dark:text-emerald-400",
        !isFlat && !isPositive && "border-red-500/40 text-red-600 dark:text-red-400"
      )}
      title={formatDeltaCr(deltaCr)}
    >
      {formatPct(deltaPct, { alwaysSign: true })}
    </Badge>
  );
}
