import { describe, expect, it } from "vitest";
import { durbinWatson, fitOls } from "./regression";

describe("fitOls", () => {
  it("recovers an exact line with R² = 1", () => {
    const xs = [1, 2, 3, 4, 5];
    const ys = xs.map((x) => 2.5 * x + 10);
    const fit = fitOls(xs, ys)!;
    expect(fit.slope).toBeCloseTo(2.5, 12);
    expect(fit.intercept).toBeCloseTo(10, 12);
    expect(fit.r2).toBeCloseTo(1, 12);
    expect(fit.residuals.every((r) => Math.abs(r) < 1e-9)).toBe(true);
  });

  it("matches a hand-computed noisy fit", () => {
    // x̄ = 2.5, ȳ = 3.5; Sxy = 4, Sxx = 5 → slope 0.8, intercept 1.5
    const fit = fitOls([1, 2, 3, 4], [2, 4, 3, 5])!;
    expect(fit.slope).toBeCloseTo(0.8, 12);
    expect(fit.intercept).toBeCloseTo(1.5, 12);
    expect(fit.r2).toBeCloseTo(0.64, 12);
  });

  it("returns null for degenerate input", () => {
    expect(fitOls([1], [1])).toBeNull();
    expect(fitOls([2, 2, 2], [1, 2, 3])).toBeNull();
    expect(fitOls([1, 2], [1])).toBeNull();
  });
});

describe("durbinWatson", () => {
  it("is ~2 for alternating residuals' opposite and 0 for constant ones", () => {
    expect(durbinWatson([1, 1, 1, 1])).toBe(0);
    expect(durbinWatson([1, -1, 1, -1])).toBeCloseTo(3, 12); // Σ(Δe)²=12, Σe²=4
  });
});
