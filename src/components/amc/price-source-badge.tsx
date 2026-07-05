import { Badge } from "@/components/ui/badge";
import type { PriceSource } from "@/lib/aum/types";

const LABELS: Record<PriceSource, string> = {
  live: "Live",
  foreign_live: "Live (US)",
  last_close: "Last Close",
  not_priceable: "Not priced",
  stale_fallback: "Stale",
};

const VARIANT_CLASS: Record<PriceSource, string> = {
  live: "border-emerald-500/40 text-emerald-600 dark:text-emerald-400",
  foreign_live: "border-sky-500/40 text-sky-600 dark:text-sky-400",
  last_close: "border-violet-500/40 text-violet-600 dark:text-violet-400",
  not_priceable: "text-muted-foreground",
  stale_fallback: "border-amber-500/40 text-amber-600 dark:text-amber-400",
};

export function PriceSourceBadge({ source }: { source: PriceSource }) {
  return (
    <Badge variant="outline" className={VARIANT_CLASS[source]}>
      {LABELS[source]}
    </Badge>
  );
}
