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
  assetClass: "gold" | "silver";
  slug: string;
}

const GOLD_ETFS: SeedRow[] = [
  { schemeCode: 153357, isin: "INF579M01BB5", name: "360 ONE Gold ETF", assetClass: "gold", slug: "360-one-gold-etf" },
  { schemeCode: 153826, isin: "INF1J2R01114", name: "Angel One Gold ETF", assetClass: "gold", slug: "angel-one-gold-etf" },
  { schemeCode: 113434, isin: "INF846K01W80", name: "Axis Gold ETF", assetClass: "gold", slug: "axis-gold-etf" },
  { schemeCode: 153930, isin: "INF194KB1KJ7", name: "Bandhan Gold ETF", assetClass: "gold", slug: "bandhan-gold-etf" },
  { schemeCode: 152231, isin: "INF251K01SU9", name: "Baroda BNP Paribas Gold ETF", assetClass: "gold", slug: "baroda-bnp-paribas-gold-etf" },
  { schemeCode: 153933, isin: "INF2KCX01012", name: "Choice Gold ETF", assetClass: "gold", slug: "choice-gold-etf" },
  { schemeCode: 151737, isin: "INF740KA1ZP2", name: "DSP Gold ETF", assetClass: "gold", slug: "dsp-gold-etf" },
  { schemeCode: 152193, isin: "INF754K01SE6", name: "Edelweiss Gold ETF", assetClass: "gold", slug: "edelweiss-gold-etf" },
  { schemeCode: 152957, isin: "INF666M01OE7", name: "Groww Gold ETF", assetClass: "gold", slug: "groww-gold-etf" },
  { schemeCode: 113049, isin: "INF179KC1981", name: "HDFC Gold ETF", assetClass: "gold", slug: "hdfc-gold-etf" },
  { schemeCode: 154294, isin: "INF336L01RX2", name: "HSBC Gold ETF", assetClass: "gold", slug: "hsbc-gold-etf" },
  { schemeCode: 113076, isin: "INF109KC1NT3", name: "ICICI Prudential Gold ETF", assetClass: "gold", slug: "icici-prudential-gold-etf" },
  { schemeCode: 112368, isin: "INF205KA1BP1", name: "Invesco India Gold ETF", assetClass: "gold", slug: "invesco-india-gold-etf" },
  { schemeCode: 106193, isin: "INF174KA1HJ8", name: "Kotak Gold ETF", assetClass: "gold", slug: "kotak-gold-etf" },
  { schemeCode: 151961, isin: "INF767K01SM1", name: "LIC MF Gold ETF", assetClass: "gold", slug: "lic-mf-gold-etf" },
  { schemeCode: 151416, isin: "INF769K01JP9", name: "Mirae Asset Gold ETF", assetClass: "gold", slug: "mirae-asset-gold-etf" },
  { schemeCode: 153780, isin: "INF247L01FY4", name: "Motilal Oswal Gold ETF", assetClass: "gold", slug: "motilal-oswal-gold-etf" },
  { schemeCode: 140088, isin: "INF204KB17I5", name: "Nippon India ETF Gold BeES", assetClass: "gold", slug: "nippon-india-gold-bees" },
  { schemeCode: 107693, isin: "INF082J01408", name: "Quantum Gold ETF", assetClass: "gold", slug: "quantum-gold-etf" },
  { schemeCode: 111954, isin: "INF200KA16D8", name: "SBI Gold ETF", assetClass: "gold", slug: "sbi-gold-etf" },
  { schemeCode: 152284, isin: "INF277KA1976", name: "Tata Gold ETF", assetClass: "gold", slug: "tata-gold-etf" },
  { schemeCode: 154092, isin: "INF2F0001370", name: "The Wealth Company Gold ETF", assetClass: "gold", slug: "the-wealth-company-gold-etf" },
  { schemeCode: 105463, isin: "INF789F1AUX7", name: "UTI Gold ETF", assetClass: "gold", slug: "uti-gold-etf" },
  { schemeCode: 153337, isin: "INF582M01KS4", name: "Union Gold ETF", assetClass: "gold", slug: "union-gold-etf" },
  { schemeCode: 152476, isin: "INF0R8F01042", name: "Zerodha Gold ETF", assetClass: "gold", slug: "zerodha-gold-etf" },
];

const SILVER_ETFS: SeedRow[] = [
  { schemeCode: 153415, isin: "INF579M01BC3", name: "360 ONE Silver ETF", assetClass: "silver", slug: "360-one-silver-etf" },
  { schemeCode: 154205, isin: "INF1J2R01171", name: "Angel One Silver ETF", assetClass: "silver", slug: "angel-one-silver-etf" },
  { schemeCode: 149779, isin: "INF209KB19F6", name: "Aditya Birla Sun Life Silver ETF", assetClass: "silver", slug: "aditya-birla-sun-life-silver-etf" },
  { schemeCode: 150610, isin: "INF846K011K1", name: "Axis Silver ETF", assetClass: "silver", slug: "axis-silver-etf" },
  { schemeCode: 153929, isin: "INF194KB1KI9", name: "Bandhan Silver ETF", assetClass: "silver", slug: "bandhan-silver-etf" },
  { schemeCode: 150523, isin: "INF740KA1ZQ0", name: "DSP Silver ETF", assetClass: "silver", slug: "dsp-silver-etf" },
  { schemeCode: 152212, isin: "INF754K01SF3", name: "Edelweiss Silver ETF", assetClass: "silver", slug: "edelweiss-silver-etf" },
  { schemeCode: 153524, isin: "INF666M01OF4", name: "Groww Silver ETF", assetClass: "silver", slug: "groww-silver-etf" },
  { schemeCode: 150556, isin: "INF179KC1DI2", name: "HDFC Silver ETF", assetClass: "silver", slug: "hdfc-silver-etf" },
  { schemeCode: 149464, isin: "INF109KC1Y56", name: "ICICI Prudential Silver ETF", assetClass: "silver", slug: "icici-prudential-silver-etf" },
  { schemeCode: 150948, isin: "INF174KA1ZD3", name: "Kotak Silver ETF", assetClass: "silver", slug: "kotak-silver-etf" },
  { schemeCode: 151779, isin: "INF769K01KG6", name: "Mirae Asset Silver ETF", assetClass: "silver", slug: "mirae-asset-silver-etf" },
  { schemeCode: 153820, isin: "INF247L01FZ1", name: "Motilal Oswal Silver ETF", assetClass: "silver", slug: "motilal-oswal-silver-etf" },
  { schemeCode: 149758, isin: "INF204KC1402", name: "Nippon India Silver ETF", assetClass: "silver", slug: "nippon-india-silver-etf" },
  { schemeCode: 152725, isin: "INF200KB1217", name: "SBI Silver ETF", assetClass: "silver", slug: "sbi-silver-etf" },
  { schemeCode: 153413, isin: "INF0R8F01091", name: "Zerodha Silver ETF", assetClass: "silver", slug: "zerodha-silver-etf" },
];

async function main() {
  const rows = [...GOLD_ETFS, ...SILVER_ETFS];
  for (const row of rows) {
    await db
      .insert(etfSchemes)
      .values(row)
      .onConflictDoUpdate({
        target: etfSchemes.schemeCode,
        set: { isin: row.isin, name: row.name, assetClass: row.assetClass, slug: row.slug },
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
