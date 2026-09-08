// One-off seed for etf_schemes: every currently-active Gold ETF and Silver
// ETF scheme (FOF wrappers excluded -- those are a different product, not
// the ETF itself), verified directly against api.tigzig.com/mf/v1's own
// category filter and cross-checked against DHAN's public ETF listing.
// Safe to re-run (upserts on scheme_code). "quant Silver ETF" (scheme code
// 154625, launched 2026-08-25) is deliberately omitted: it has no ISIN and
// no disclosed quarter yet, so there's nothing to seed until AMFI publishes
// its first AAUM figure -- add it once that happens.
import { db } from "../src/lib/db/client";
import { etfSchemes } from "../src/lib/db/schema";

interface SeedRow {
  schemeCode: number;
  isin: string;
  name: string;
  amc: string;
  assetClass: "gold" | "silver";
  slug: string;
}

// amc matches the equity Overview tab's amcs.overviewName exactly where that
// AMC also runs a scheme tracked there, so the same AMC identity reads
// consistently across tabs. A few ETF-only entrants (Angel One, Choice) have
// no equity counterpart in amcs yet -- for those, "<Name> Mutual Fund"
// follows the same naming convention as a best-effort placeholder.
const GOLD_ETFS: SeedRow[] = [
  { schemeCode: 153357, isin: "INF579M01BB5", name: "360 ONE Gold ETF", amc: "360 ONE Mutual Fund", assetClass: "gold", slug: "360-one-gold-etf" },
  { schemeCode: 153826, isin: "INF1J2R01114", name: "Angel One Gold ETF", amc: "Angel One Mutual Fund", assetClass: "gold", slug: "angel-one-gold-etf" },
  { schemeCode: 113434, isin: "INF846K01W80", name: "Axis Gold ETF", amc: "Axis Mutual Fund", assetClass: "gold", slug: "axis-gold-etf" },
  { schemeCode: 153930, isin: "INF194KB1KJ7", name: "Bandhan Gold ETF", amc: "Bandhan Mutual Fund", assetClass: "gold", slug: "bandhan-gold-etf" },
  { schemeCode: 152231, isin: "INF251K01SU9", name: "Baroda BNP Paribas Gold ETF", amc: "Baroda BNP Paribas Mutual Fund", assetClass: "gold", slug: "baroda-bnp-paribas-gold-etf" },
  { schemeCode: 153933, isin: "INF2KCX01012", name: "Choice Gold ETF", amc: "Choice Mutual Fund", assetClass: "gold", slug: "choice-gold-etf" },
  { schemeCode: 151737, isin: "INF740KA1ZP2", name: "DSP Gold ETF", amc: "DSP Mutual Fund", assetClass: "gold", slug: "dsp-gold-etf" },
  { schemeCode: 152193, isin: "INF754K01SE6", name: "Edelweiss Gold ETF", amc: "Edelweiss Mutual Fund", assetClass: "gold", slug: "edelweiss-gold-etf" },
  { schemeCode: 152957, isin: "INF666M01OE7", name: "Groww Gold ETF", amc: "Groww Mutual Fund", assetClass: "gold", slug: "groww-gold-etf" },
  { schemeCode: 113049, isin: "INF179KC1981", name: "HDFC Gold ETF", amc: "HDFC Mutual Fund", assetClass: "gold", slug: "hdfc-gold-etf" },
  { schemeCode: 154294, isin: "INF336L01RX2", name: "HSBC Gold ETF", amc: "HSBC Mutual Fund", assetClass: "gold", slug: "hsbc-gold-etf" },
  { schemeCode: 113076, isin: "INF109KC1NT3", name: "ICICI Prudential Gold ETF", amc: "ICICI Prudential Mutual Fund", assetClass: "gold", slug: "icici-prudential-gold-etf" },
  { schemeCode: 112368, isin: "INF205KA1BP1", name: "Invesco India Gold ETF", amc: "Invesco Mutual Fund", assetClass: "gold", slug: "invesco-india-gold-etf" },
  { schemeCode: 106193, isin: "INF174KA1HJ8", name: "Kotak Gold ETF", amc: "Kotak Mahindra Mutual Fund", assetClass: "gold", slug: "kotak-gold-etf" },
  { schemeCode: 151961, isin: "INF767K01SM1", name: "LIC MF Gold ETF", amc: "LIC Mutual Fund", assetClass: "gold", slug: "lic-mf-gold-etf" },
  { schemeCode: 151416, isin: "INF769K01JP9", name: "Mirae Asset Gold ETF", amc: "Mirae Asset Mutual Fund", assetClass: "gold", slug: "mirae-asset-gold-etf" },
  { schemeCode: 153780, isin: "INF247L01FY4", name: "Motilal Oswal Gold ETF", amc: "Motilal Oswal Mutual Fund", assetClass: "gold", slug: "motilal-oswal-gold-etf" },
  { schemeCode: 140088, isin: "INF204KB17I5", name: "Nippon India ETF Gold BeES", amc: "Nippon India Mutual Fund", assetClass: "gold", slug: "nippon-india-gold-bees" },
  { schemeCode: 107693, isin: "INF082J01408", name: "Quantum Gold ETF", amc: "Quantum Mutual Fund", assetClass: "gold", slug: "quantum-gold-etf" },
  { schemeCode: 111954, isin: "INF200KA16D8", name: "SBI Gold ETF", amc: "SBI Mutual Fund", assetClass: "gold", slug: "sbi-gold-etf" },
  { schemeCode: 152284, isin: "INF277KA1976", name: "Tata Gold ETF", amc: "Tata Mutual Fund", assetClass: "gold", slug: "tata-gold-etf" },
  { schemeCode: 154092, isin: "INF2F0001370", name: "The Wealth Company Gold ETF", amc: "The Wealth Company Mutual Fund", assetClass: "gold", slug: "the-wealth-company-gold-etf" },
  { schemeCode: 105463, isin: "INF789F1AUX7", name: "UTI Gold ETF", amc: "UTI Mutual Fund", assetClass: "gold", slug: "uti-gold-etf" },
  { schemeCode: 153337, isin: "INF582M01KS4", name: "Union Gold ETF", amc: "Union Mutual Fund", assetClass: "gold", slug: "union-gold-etf" },
  { schemeCode: 152476, isin: "INF0R8F01042", name: "Zerodha Gold ETF", amc: "Zerodha Mutual Fund", assetClass: "gold", slug: "zerodha-gold-etf" },
];

const SILVER_ETFS: SeedRow[] = [
  { schemeCode: 153415, isin: "INF579M01BC3", name: "360 ONE Silver ETF", amc: "360 ONE Mutual Fund", assetClass: "silver", slug: "360-one-silver-etf" },
  { schemeCode: 154205, isin: "INF1J2R01171", name: "Angel One Silver ETF", amc: "Angel One Mutual Fund", assetClass: "silver", slug: "angel-one-silver-etf" },
  { schemeCode: 149779, isin: "INF209KB19F6", name: "Aditya Birla Sun Life Silver ETF", amc: "Aditya Birla Sun Life Mutual Fund", assetClass: "silver", slug: "aditya-birla-sun-life-silver-etf" },
  { schemeCode: 150610, isin: "INF846K011K1", name: "Axis Silver ETF", amc: "Axis Mutual Fund", assetClass: "silver", slug: "axis-silver-etf" },
  { schemeCode: 153929, isin: "INF194KB1KI9", name: "Bandhan Silver ETF", amc: "Bandhan Mutual Fund", assetClass: "silver", slug: "bandhan-silver-etf" },
  { schemeCode: 150523, isin: "INF740KA1ZQ0", name: "DSP Silver ETF", amc: "DSP Mutual Fund", assetClass: "silver", slug: "dsp-silver-etf" },
  { schemeCode: 152212, isin: "INF754K01SF3", name: "Edelweiss Silver ETF", amc: "Edelweiss Mutual Fund", assetClass: "silver", slug: "edelweiss-silver-etf" },
  { schemeCode: 153524, isin: "INF666M01OF4", name: "Groww Silver ETF", amc: "Groww Mutual Fund", assetClass: "silver", slug: "groww-silver-etf" },
  { schemeCode: 150556, isin: "INF179KC1DI2", name: "HDFC Silver ETF", amc: "HDFC Mutual Fund", assetClass: "silver", slug: "hdfc-silver-etf" },
  { schemeCode: 149464, isin: "INF109KC1Y56", name: "ICICI Prudential Silver ETF", amc: "ICICI Prudential Mutual Fund", assetClass: "silver", slug: "icici-prudential-silver-etf" },
  { schemeCode: 150948, isin: "INF174KA1ZD3", name: "Kotak Silver ETF", amc: "Kotak Mahindra Mutual Fund", assetClass: "silver", slug: "kotak-silver-etf" },
  { schemeCode: 151779, isin: "INF769K01KG6", name: "Mirae Asset Silver ETF", amc: "Mirae Asset Mutual Fund", assetClass: "silver", slug: "mirae-asset-silver-etf" },
  { schemeCode: 153820, isin: "INF247L01FZ1", name: "Motilal Oswal Silver ETF", amc: "Motilal Oswal Mutual Fund", assetClass: "silver", slug: "motilal-oswal-silver-etf" },
  { schemeCode: 149758, isin: "INF204KC1402", name: "Nippon India Silver ETF", amc: "Nippon India Mutual Fund", assetClass: "silver", slug: "nippon-india-silver-etf" },
  { schemeCode: 152725, isin: "INF200KB1217", name: "SBI Silver ETF", amc: "SBI Mutual Fund", assetClass: "silver", slug: "sbi-silver-etf" },
  // TigZig lists these two under the literal name "... Silver Exchange Traded
  // Fund" rather than "... Silver ETF" (same quirk their Gold ETF entries
  // above already normalize away) -- missed by the original keyword search
  // that seeded this list, caught by cross-checking against DHAN's own
  // listing, confirmed both have a valid June-2026 AAUM and live NAV.
  { schemeCode: 152285, isin: "INF277KA1984", name: "Tata Silver ETF", amc: "Tata Mutual Fund", assetClass: "silver", slug: "tata-silver-etf" },
  { schemeCode: 151730, isin: "INF789F1AYK6", name: "UTI Silver ETF", amc: "UTI Mutual Fund", assetClass: "silver", slug: "uti-silver-etf" },
  { schemeCode: 153413, isin: "INF0R8F01091", name: "Zerodha Silver ETF", amc: "Zerodha Mutual Fund", assetClass: "silver", slug: "zerodha-silver-etf" },
];

async function main() {
  const rows = [...GOLD_ETFS, ...SILVER_ETFS];
  for (const row of rows) {
    await db
      .insert(etfSchemes)
      .values(row)
      .onConflictDoUpdate({
        target: etfSchemes.schemeCode,
        set: { isin: row.isin, name: row.name, amc: row.amc, assetClass: row.assetClass, slug: row.slug },
      });
  }
  console.log(`Seeded ${GOLD_ETFS.length} Gold ETFs and ${SILVER_ETFS.length} Silver ETFs (${rows.length} total).`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("ETF scheme seed failed:", err);
    process.exit(1);
  });
