import { describe, expect, it } from "vitest";
import overrides from "../../../data/foreign-symbol-overrides.json";
import { isUsListedEquityIsin } from "../excel/instrument-classification";

describe("data/foreign-symbol-overrides.json", () => {
  it("only lists ISINs the US (Finnhub) pricing path covers, each once, with a symbol", () => {
    const isins = overrides.map((o) => o.isin);
    expect(new Set(isins).size).toBe(isins.length);
    for (const o of overrides) {
      expect(isUsListedEquityIsin(o.isin), o.isin).toBe(true);
      expect(o.symbol).toMatch(/^[A-Z][A-Z0-9.\-]{0,9}$/);
      expect(o.companyName.length).toBeGreaterThan(0);
    }
  });
});
