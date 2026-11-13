// Short market-style abbreviations for the 8 listed-stock AMCs -- used to
// personalize the "AMC SIP flows" summary row and the "AMC SIP Growth"
// table (e.g. "HDFC SIP flows", "NAM SIP Growth" for Nippon) instead of
// the generic "AMC". Deliberately a hardcoded mapping, not a DB column:
// this is a small, fixed, rarely-changing set (the same 8 rows as
// amc_listed_stock), and adding a 9th already requires a code change
// elsewhere (the listed-stock table itself) -- confirmed and chosen by
// the user over each AMC's own tradingSymbol (e.g. "ICICIAMC"), which
// doesn't match the shorter form wanted here (e.g. "IPRU").
const AMC_ABBREVIATIONS: Record<number, string> = {
  1: "HDFC", // HDFC Mutual Fund
  12: "CRAMC", // Canara Robeco Mutual Fund
  4: "NAM", // Nippon India Mutual Fund
  9: "ABSL", // Aditya Birla Sun Life Mutual Fund
  14: "UTI", // UTI Mutual Fund
  3: "SBI", // SBI Mutual Fund
  2: "IPRU", // ICICI Prudential Mutual Fund
  13: "MOAMC", // Motilal Oswal Mutual Fund
};

/** Falls back to "AMC" for any AMC not in the curated list above, rather than throwing. */
export function getAmcAbbreviation(amcId: number): string {
  return AMC_ABBREVIATIONS[amcId] ?? "AMC";
}
