// Runs the Gold/Silver ETF historical daily-AUM backfill for every scheme
// (or a single scheme, via --slug) -- fetches each scheme's full NAV
// history from TigZig, then calls computeEtfHistoricalAumEstimatesForScheme
// per scheme (src/lib/etf/historical-backfill.ts). Safe to re-run: every
// write is an upsert keyed on (schemeId, snapshotDate).
//
// Usage:
//   npm run run-etf-historical-backfill
//   npm run run-etf-historical-backfill -- --slug=hdfc-gold-etf
import { asc, eq } from "drizzle-orm";
import { db } from "../src/lib/db/client";
import { etfSchemes, etfExitAumAnchor } from "../src/lib/db/schema";
import { fetchFullNavHistory } from "../src/lib/etf/tigzig-client";
import { computeEtfHistoricalAumEstimatesForScheme } from "../src/lib/etf/historical-backfill";

async function main() {
  const slugArg = process.argv.find((a) => a.startsWith("--slug="))?.split("=")[1];

  const schemes = slugArg
    ? await db.select().from(etfSchemes).where(eq(etfSchemes.slug, slugArg))
    : await db.select().from(etfSchemes);

  if (schemes.length === 0) {
    console.error(slugArg ? `No etfSchemes row for slug "${slugArg}"` : "No etfSchemes rows found");
    process.exit(1);
  }

  // Each scheme's own anchor range determines the NAV window to fetch --
  // fetch per-scheme since inception dates vary by years across schemes.
  console.log(`Fetching NAV history + computing estimates for ${schemes.length} scheme(s)...`);

  const results: Awaited<ReturnType<typeof computeEtfHistoricalAumEstimatesForScheme>>[] = [];

  for (const scheme of schemes) {
    const anchors = await db
      .select({ anchorDate: etfExitAumAnchor.anchorDate })
      .from(etfExitAumAnchor)
      .where(eq(etfExitAumAnchor.schemeId, scheme.id))
      .orderBy(asc(etfExitAumAnchor.anchorDate));

    if (anchors.length < 2) {
      console.log(`[${scheme.name}] only ${anchors.length} anchor(s) -- skipping (need >= 2).`);
      continue;
    }

    const since = anchors[0].anchorDate;
    const to = anchors[anchors.length - 1].anchorDate;
    const navMap = await fetchFullNavHistory([scheme.schemeCode], since, to);
    const navHistory = navMap.get(scheme.schemeCode) ?? [];

    if (navHistory.length === 0) {
      console.log(`[${scheme.name}] no NAV history returned from TigZig for ${since}..${to} -- skipping.`);
      continue;
    }

    const result = await computeEtfHistoricalAumEstimatesForScheme(
      scheme.id,
      navHistory.map((n) => ({ date: n.date, nav: n.nav }))
    );
    results.push(result);

    console.log(
      `[${scheme.name}] anchors=${result.anchorsUsed} segments=${result.segmentsComputed} rows=${result.rowsWritten} range=${result.firstWrittenDate}..${result.lastWrittenDate}` +
        (result.warnings.length > 0 ? ` warnings=${result.warnings.length}` : "") +
        (result.detectedSplits.length > 0 ? ` SPLITS=${result.detectedSplits.length}` : "")
    );
    for (const w of result.warnings) console.log(`    - ${w}`);
    for (const s of result.detectedSplits) console.log(`    - NAV split detected on ${s.date}: raw ratio ${s.rawRatio.toFixed(3)} -> matched ${s.matchedRatio}x`);
  }

  const totalRows = results.reduce((sum, r) => sum + r.rowsWritten, 0);
  const totalWarnings = results.reduce((sum, r) => sum + r.warnings.length, 0);
  const totalSplits = results.reduce((sum, r) => sum + r.detectedSplits.length, 0);
  console.log(`\nDone. ${results.length} scheme(s) processed, ${totalRows} total rows written, ${totalWarnings} warning(s), ${totalSplits} NAV split(s) detected and adjusted for.`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  });
