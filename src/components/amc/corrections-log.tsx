import { formatPriceInr, formatShortDate } from "@/lib/utils/format";
import type { LiveAumSnapshot } from "@/lib/aum/types";

// Backfill outcome caption for one stale-mapping correction row --
// backfillDatesCount is null for rows predating that column (genuinely
// unrecorded, not zero), a real count for every row since. 0 means the
// mapping fix itself succeeded but DHAN had no historical data to
// backfill, which reads differently from a normal success.
function backfillCaption(backfillDatesCount: number | null): string {
  if (backfillDatesCount === null) return "was stale, historical prices backfilled";
  if (backfillDatesCount === 0) return "was stale — DHAN had no historical data to backfill; recent price history for this stock may still be incomplete";
  return `was stale, ${backfillDatesCount} historical day${backfillDatesCount === 1 ? "" : "s"} backfilled`;
}

export function CorrectionsLog({
  shareAdjustments,
  outageReclaims,
  staleMappingCorrections,
  unresolvedStaleMappings,
}: {
  shareAdjustments: LiveAumSnapshot["shareAdjustments"];
  outageReclaims: LiveAumSnapshot["outageReclaims"];
  staleMappingCorrections: LiveAumSnapshot["staleMappingCorrections"];
  unresolvedStaleMappings: LiveAumSnapshot["unresolvedStaleMappings"];
}) {
  const hasShareAdjustments = shareAdjustments && shareAdjustments.length > 0;
  const hasOutageReclaims = outageReclaims && outageReclaims.length > 0;
  const hasStaleMappingCorrections = staleMappingCorrections && staleMappingCorrections.length > 0;
  const hasUnresolvedStaleMappings = unresolvedStaleMappings && unresolvedStaleMappings.length > 0;

  if (!hasShareAdjustments && !hasOutageReclaims && !hasStaleMappingCorrections && !hasUnresolvedStaleMappings) {
    return <p className="text-sm text-muted-foreground">Nothing to show yet — this fills in automatically as the system detects and self-corrects data issues over time.</p>;
  }

  return (
    <div className="space-y-2">
      <p className="text-sm text-muted-foreground">
        A running record of every automatic correction this app has applied on its own — stock splits/bonuses, DHAN
        outage recoveries, and stale DHAN security-ID fixes.{" "}
        {hasUnresolvedStaleMappings
          ? "The section below needs a look — the self-heal couldn't resolve it automatically. Everything else here is a history, not a to-do list."
          : "Nothing here needs action; it's a history, not a to-do list."}
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
                  {c.oldSecurityId ?? "(none)"} → {c.newSecurityId} ({backfillCaption(c.backfillDatesCount)})
                </li>
              ))}
            </ul>
          </details>
        )}
        {hasUnresolvedStaleMappings && (
          <details className="text-xs text-amber-700 dark:text-amber-400" open>
            <summary className="cursor-pointer font-medium">
              ⚠ {unresolvedStaleMappings.length} stock{unresolvedStaleMappings.length === 1 ? "" : "s"} need manual review — no current DHAN listing found
            </summary>
            <ul className="mt-1 list-disc pl-4 text-muted-foreground">
              {unresolvedStaleMappings.map((u) => (
                <li key={u.isin}>
                  {u.companyName} ({u.isin}) — DHAN has no listing for this ISIN as of the last check (
                  {formatShortDate(u.lastCheckedAt.slice(0, 10))}); stuck since {formatShortDate(u.firstCheckedAt.slice(0, 10))}.
                  Check if this stock delisted, merged, or its ISIN changed.
                </li>
              ))}
            </ul>
          </details>
        )}
      </div>
    </div>
  );
}
