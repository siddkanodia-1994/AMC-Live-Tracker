// The Stock Correlation table's "AUM what-if" columns: plug any AUM into an
// AMC's fitted regression line (Price = slope × AUM MA + intercept, see
// regression-engine.ts) and read off the implied share price and its upside
// vs the current price. Pure, so the table can recompute on every keystroke
// without re-running the regression itself.

export interface RegressionLine {
  slope: number;
  intercept: number;
  // The AUM range the line was actually fitted on -- an input outside it is
  // an extrapolation, flagged in the table.
  driverMin: number;
  driverMax: number;
}

export interface AumWhatIf {
  targetPrice: number;
  upsidePct: number | null;
  outOfRange: boolean;
}

export function computeAumWhatIf(line: RegressionLine, aumCr: number, currentPrice: number | null): AumWhatIf {
  const targetPrice = line.slope * aumCr + line.intercept;
  return {
    targetPrice,
    upsidePct: currentPrice ? (targetPrice - currentPrice) / currentPrice : null,
    outOfRange: aumCr < line.driverMin || aumCr > line.driverMax,
  };
}

// Well above any AMC's AUM (the largest is ~₹5 lakh cr); rejects typos.
// Shared with the saved-defaults validation so the page never keeps a
// value "Save as default" would refuse.
export const MAX_AUM_INPUT_CR = 1e8;

/** "4,80,000", "480000", "4,80,000 cr", "₹ 480000.5" -> number; null if blank, non-numeric, <= 0 or >= MAX_AUM_INPUT_CR. */
export function parseAumInput(text: string): number | null {
  const cleaned = text.replace(/[₹,\s]/g, "").replace(/cr$/i, "");
  if (cleaned === "" || !/^\d*\.?\d+$/.test(cleaned)) return null;
  const value = Number(cleaned);
  return Number.isFinite(value) && value > 0 && value < MAX_AUM_INPUT_CR ? value : null;
}
