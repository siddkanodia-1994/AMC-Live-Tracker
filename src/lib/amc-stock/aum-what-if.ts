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

// The what-if column's own starting-AUM window -- independent of the tab's
// Moving avg (which the regression line itself is fitted on). 0 = today's
// live AUM, the same figure as the table's Live AUM column.
export const WHAT_IF_AUM_DAYS_OPTIONS = [
  { value: 0, label: "Live (0D)", description: "live AUM (today)" },
  { value: 5, label: "5D avg", description: "5D avg AUM" },
  { value: 10, label: "10D avg", description: "10D avg AUM" },
  { value: 15, label: "15D avg", description: "15D avg AUM" },
  { value: 20, label: "20D avg", description: "20D avg AUM" },
] as const;
export const DEFAULT_WHAT_IF_AUM_DAYS = 5;

export function isWhatIfAumDays(value: unknown): value is number {
  return typeof value === "number" && WHAT_IF_AUM_DAYS_OPTIONS.some((o) => o.value === value);
}

/**
 * The starting AUM for a what-if row: the mean of the last `days` daily AUM
 * values (oldest first, today last), or today's value for 0. With fewer
 * than `days` values on record, falls back to today's value. null if empty.
 */
export function whatIfStartingAum(dailyAumCr: number[], days: number): number | null {
  if (dailyAumCr.length === 0) return null;
  if (days <= 0 || dailyAumCr.length < days) return dailyAumCr[dailyAumCr.length - 1];
  const window = dailyAumCr.slice(-days);
  return window.reduce((a, b) => a + b, 0) / days;
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
