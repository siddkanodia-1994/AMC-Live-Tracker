import { formatPriceInr, formatShortDate } from "@/lib/utils/format";
import type { LiveAumSnapshot } from "@/lib/aum/types";

export function CorrectionsLog({
  shareAdjustments,
  outageReclaims,
  staleMappingCorrections,
}: {
  shareAdjustments: LiveAumSnapshot["shareAdjustments"];
  outageReclaims: LiveAumSnapshot["outageReclaims"];
  staleMappingCorrections: LiveAumSnapshot["staleMappingCorrections"];
}) {
  const hasShareAdjustments = shareAdjustments && shareAdjustments.length > 0;
  const hasOutageReclaims = outageReclaims && outageReclaims.length > 0;
  const hasStaleMappingCorrections = staleMappingCorrections && staleMappingCorrections.length > 0;

  if (!hasShareAdjustments && !hasOutageReclaims && !hasStaleMappingCorrections) {
    return <p className="text-sm text-muted-foreground">Nothing to show yet — this fills in automatically as the system detects and self-corrects data issues over time.</p>;
  }

  return (
    <div className="space-y-2">
      <p className="text-sm text-muted-foreground">
        A running record of every automatic correction this app has applied on its own — stock splits/bonuses, DHAN
        outage recoveries, and stale DHAN security-ID fixes. Nothing here needs action; it&apos;s a history, not a
        to-do list.
      </p>
      <div className="space-y-3 rounded-lg border bg-card p-4">
        {hasShareAdjustments && (
          <details className="text-xs text-muted-foreground" open>
            <summary className="cursor-pointer font-medium text-foreground">
              {shareAdjustments.length} stock{shareAdjustments.length === 1 ? "" : "s"} auto-adjusted for a split/bonus
            </summary>
            <ul className="mt-1 list-disc pl-4">
              {shareAdjustments.map((s) => (
                <li key={s.isin}>
                  {s.companyName} — {s.multiplier >= 1 ? `×${s.multiplier.toFixed(1)}` : `÷${(1 / s.multiplier).toFixed(1)}`}{" "}
                  split detected {formatShortDate(s.firstDetectedOn)} ({formatPriceInr(s.priceBeforeInr)} →{" "}
                  {formatPriceInr(s.priceAfterInr)}). Manage in Admin if this was detected incorrectly.
                </li>
              ))}
            </ul>
          </details>
        )}
        {hasOutageReclaims && (
          <details className="text-xs text-muted-foreground" open>
            <summary className="cursor-pointer font-medium text-foreground">
              {outageReclaims.length} day{outageReclaims.length === 1 ? "" : "s"} auto-corrected after a DHAN outage
            </summary>
            <ul className="mt-1 list-disc pl-4">
              {outageReclaims.map((r) => (
                <li key={`${r.kind}-${r.snapshotDate}`}>
                  {formatShortDate(r.snapshotDate)} —{" "}
                  {r.kind === "amc_isin"
                    ? `${r.correctedIsinCount ?? 0} stock price${(r.correctedIsinCount ?? 0) === 1 ? "" : "s"} replaced with DHAN's real historical close`
                    : `${(r.indexKeysCorrected ?? []).join(", ")} level backfilled from DHAN's real historical close`}
                  {r.detail ? ` (${r.detail})` : ""}
                </li>
              ))}
            </ul>
          </details>
        )}
        {hasStaleMappingCorrections && (
          <details className="text-xs text-muted-foreground" open>
            <summary className="cursor-pointer font-medium text-foreground">
              {staleMappingCorrections.length} stock DHAN mapping{staleMappingCorrections.length === 1 ? "" : "s"} auto-corrected
            </summary>
            <ul className="mt-1 list-disc pl-4">
              {staleMappingCorrections.map((c) => (
                <li key={`${c.isin}-${c.correctedAt}`}>
                  {formatShortDate(c.correctedAt.slice(0, 10))} — {c.companyName}: DHAN security ID{" "}
                  {c.oldSecurityId ?? "(none)"} → {c.newSecurityId} (was stale, historical prices backfilled)
                </li>
              ))}
            </ul>
          </details>
        )}
      </div>
    </div>
  );
}
