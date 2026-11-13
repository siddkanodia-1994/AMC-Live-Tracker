// The Bear / Base / Bull PE valuation (FY28E target, discounted back to
// FY27 and FY26), used by the Fortnightly AMC Update tab and AMC Analytics'
// Target Price. Moved out of fortnightly-update.ts unchanged; it reads only
// these inputs, so any record carrying them works.

export interface ValuationInputs {
  patFy26aCr: number | null;
  patFy28eCr: number | null;
  targetPeBear: number | null;
  targetPeBase: number | null;
  targetPeBull: number | null;
  noOfSharesCr: number | null;
  discountRateFy27Pct: number | null;
  discountRateFy26Pct: number | null;
}

// ---------------------------------------------------------------------
// Valuation formulas -- pure arithmetic over manual fields only
// ---------------------------------------------------------------------

export interface ScenarioValues {
  bear: number | null;
  base: number | null;
  bull: number | null;
}

export interface ValuationBlock {
  cagr2yPct: number | null;
  fy28TargetMcapCr: ScenarioValues;
  fy28TargetPriceInr: ScenarioValues;
  fy28UpsidePct: ScenarioValues;
  fy27DiscountedPriceInr: ScenarioValues;
  fy27UpsidePct: ScenarioValues;
  fy26DiscountedPriceInr: ScenarioValues;
  fy26UpsidePct: ScenarioValues;
}

function mapScenario(pe: ScenarioValues, fn: (v: number) => number | null): ScenarioValues {
  return {
    bear: pe.bear === null ? null : fn(pe.bear),
    base: pe.base === null ? null : fn(pe.base),
    bull: pe.bull === null ? null : fn(pe.bull),
  };
}

export function computeValuationBlock(manual: ValuationInputs, cmpInr: number | null): ValuationBlock {
  const cagr2yPct =
    manual.patFy26aCr !== null && manual.patFy28eCr !== null && manual.patFy26aCr > 0
      ? Math.pow(manual.patFy28eCr / manual.patFy26aCr, 1 / 2) - 1
      : null;

  const targetPe: ScenarioValues = { bear: manual.targetPeBear, base: manual.targetPeBase, bull: manual.targetPeBull };

  const fy28TargetMcapCr = mapScenario(targetPe, (pe) => (manual.patFy28eCr === null ? null : manual.patFy28eCr * pe));
  const fy28TargetPriceInr = mapScenario(
    { bear: fy28TargetMcapCr.bear, base: fy28TargetMcapCr.base, bull: fy28TargetMcapCr.bull },
    (mcap) => (manual.noOfSharesCr === null || manual.noOfSharesCr === 0 ? null : mcap / manual.noOfSharesCr)
  );
  const upsideVs = (target: ScenarioValues): ScenarioValues =>
    mapScenario(target, (price) => (cmpInr === null || cmpInr === 0 ? null : price / cmpInr - 1));

  const fy27Divisor = manual.discountRateFy27Pct === null ? null : 1 + manual.discountRateFy27Pct;
  const fy27DiscountedPriceInr = mapScenario(
    { bear: fy28TargetPriceInr.bear, base: fy28TargetPriceInr.base, bull: fy28TargetPriceInr.bull },
    (price) => (fy27Divisor === null || fy27Divisor === 0 ? null : price / fy27Divisor)
  );

  const fy26Divisor =
    manual.discountRateFy27Pct === null || manual.discountRateFy26Pct === null
      ? null
      : (1 + manual.discountRateFy27Pct) * (1 + manual.discountRateFy26Pct);
  const fy26DiscountedPriceInr = mapScenario(
    { bear: fy28TargetPriceInr.bear, base: fy28TargetPriceInr.base, bull: fy28TargetPriceInr.bull },
    (price) => (fy26Divisor === null || fy26Divisor === 0 ? null : price / fy26Divisor)
  );

  return {
    cagr2yPct,
    fy28TargetMcapCr,
    fy28TargetPriceInr,
    fy28UpsidePct: upsideVs(fy28TargetPriceInr),
    fy27DiscountedPriceInr,
    fy27UpsidePct: upsideVs(fy27DiscountedPriceInr),
    fy26DiscountedPriceInr,
    fy26UpsidePct: upsideVs(fy26DiscountedPriceInr),
  };
}
