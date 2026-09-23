import { NextResponse } from "next/server";
import { getBacktestDefaults, setBacktestDefaults, type BacktestDefaults } from "@/lib/backtest/backtest-defaults";
import { RANGE_OPTIONS, type RangeOption } from "@/lib/aum/date-range";
import type { ExitRule, PositionSizing } from "@/lib/backtest/engine";

const EXIT_RULES: ExitRule[] = ["fixed_holding", "mean_revert", "combo"];
const POSITION_SIZINGS: PositionSizing[] = ["equal_weight", "fixed_capital"];

// Deliberately NOT wrapped in withAdminAuth -- same explicit "any visitor
// can save" product choice already made for the Stock Correlation tab's
// own default (see stock-correlation-defaults/route.ts).
export async function GET() {
  const defaults = await getBacktestDefaults();
  return NextResponse.json(defaults);
}

function requireFiniteNumber(body: Record<string, unknown>, field: string, predicate: (n: number) => boolean, message: string): number | { error: string } {
  const value = Number(body[field]);
  if (!Number.isFinite(value) || !predicate(value)) return { error: message };
  return value;
}

export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });

  const amcSlug = body.amcSlug;
  if (typeof amcSlug !== "string" || amcSlug.length === 0) {
    return NextResponse.json({ error: "amcSlug must be a non-empty string" }, { status: 400 });
  }

  const range = body.range;
  if (!RANGE_OPTIONS.some((o) => o.value === range)) {
    return NextResponse.json({ error: `range must be one of ${RANGE_OPTIONS.map((o) => o.value).join(", ")}` }, { status: 400 });
  }

  const thresholdsInput = body.thresholdsInput;
  if (typeof thresholdsInput !== "string" || thresholdsInput.trim().length === 0) {
    return NextResponse.json({ error: "thresholdsInput must be a non-empty string" }, { status: 400 });
  }

  const exitRule = body.exitRule;
  if (!EXIT_RULES.includes(exitRule as ExitRule)) {
    return NextResponse.json({ error: `exitRule must be one of ${EXIT_RULES.join(", ")}` }, { status: 400 });
  }

  const positionSizing = body.positionSizing;
  if (!POSITION_SIZINGS.includes(positionSizing as PositionSizing)) {
    return NextResponse.json({ error: `positionSizing must be one of ${POSITION_SIZINGS.join(", ")}` }, { status: 400 });
  }

  const maDays = requireFiniteNumber(body, "maDays", (n) => n >= 2, "maDays must be a number >= 2");
  if (typeof maDays !== "number") return NextResponse.json(maDays, { status: 400 });

  const holdingDays = requireFiniteNumber(body, "holdingDays", (n) => n >= 1, "holdingDays must be a number >= 1");
  if (typeof holdingDays !== "number") return NextResponse.json(holdingDays, { status: 400 });

  const meanRevertTargetZ = requireFiniteNumber(body, "meanRevertTargetZ", () => true, "meanRevertTargetZ must be a finite number");
  if (typeof meanRevertTargetZ !== "number") return NextResponse.json(meanRevertTargetZ, { status: 400 });

  const entryLagDays = requireFiniteNumber(body, "entryLagDays", (n) => n >= 1, "entryLagDays must be a number >= 1");
  if (typeof entryLagDays !== "number") return NextResponse.json(entryLagDays, { status: 400 });

  const transactionCostBps = requireFiniteNumber(body, "transactionCostBps", (n) => n >= 0, "transactionCostBps must be a number >= 0");
  if (typeof transactionCostBps !== "number") return NextResponse.json(transactionCostBps, { status: 400 });

  const initialCapital = requireFiniteNumber(body, "initialCapital", (n) => n > 0, "initialCapital must be a positive number");
  if (typeof initialCapital !== "number") return NextResponse.json(initialCapital, { status: 400 });

  const positionSizeFraction = requireFiniteNumber(body, "positionSizeFraction", (n) => n >= 1 && n <= 100, "positionSizeFraction must be a number between 1 and 100");
  if (typeof positionSizeFraction !== "number") return NextResponse.json(positionSizeFraction, { status: 400 });

  const fixedCapitalPerTrade = requireFiniteNumber(body, "fixedCapitalPerTrade", (n) => n > 0, "fixedCapitalPerTrade must be a positive number");
  if (typeof fixedCapitalPerTrade !== "number") return NextResponse.json(fixedCapitalPerTrade, { status: 400 });

  const defaults: BacktestDefaults = {
    amcSlug,
    range: range as RangeOption,
    thresholdsInput,
    maDays,
    exitRule: exitRule as ExitRule,
    holdingDays,
    meanRevertTargetZ,
    entryLagDays,
    transactionCostBps,
    initialCapital,
    positionSizing: positionSizing as PositionSizing,
    positionSizeFraction,
    fixedCapitalPerTrade,
  };
  await setBacktestDefaults(defaults);
  return NextResponse.json(defaults);
}
