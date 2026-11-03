import { describe, expect, it } from "vitest";
import { classifyInstrumentMapGaps, expectedReportPeriod } from "./probe";

describe("expectedReportPeriod", () => {
  it("expects month M's vendor file only after the 15th of M+1", () => {
    expect(expectedReportPeriod("2026-11-03")).toEqual({ period: "2026-09", graceOver: false });
    expect(expectedReportPeriod("2026-11-16")).toEqual({ period: "2026-10", graceOver: false });
    expect(expectedReportPeriod("2026-11-25")).toEqual({ period: "2026-10", graceOver: true });
    expect(expectedReportPeriod("2027-01-20")).toEqual({ period: "2026-12", graceOver: false });
  });
});

describe("classifyInstrumentMapGaps", () => {
  const gap = (name: string, valueCr: number) => ({ isin: `INE${name}`, name, valueCr });

  it("is ok with no gaps", () => {
    expect(classifyInstrumentMapGaps(0, 0, []).status).toBe("ok");
  });

  it("stays ok at exactly ₹500 cr total and ₹200 cr in one ISIN", () => {
    expect(classifyInstrumentMapGaps(3, 500, [gap("A", 200), gap("B", 200), gap("C", 100)]).status).toBe("ok");
  });

  it("warns when the total crosses ₹500 cr even if every ISIN is small", () => {
    const r = classifyInstrumentMapGaps(4, 500.01, [gap("A", 150), gap("B", 150), gap("C", 150)]);
    expect(r.status).toBe("warn");
    expect(r.summary).toContain("total > ₹500 cr");
    expect(r.summary).not.toContain("one ISIN");
  });

  it("warns when one ISIN crosses ₹200 cr even if the total is small", () => {
    const r = classifyInstrumentMapGaps(2, 250, [gap("A", 200.01), gap("B", 49.99)]);
    expect(r.status).toBe("warn");
    expect(r.summary).toContain("one ISIN > ₹200 cr");
    expect(r.summary).not.toContain("total >");
  });

  it("lists only the top 3 by value in the summary", () => {
    const r = classifyInstrumentMapGaps(30, 683.31, [gap("HEG Graphite", 616.48), gap("TVS Pref", 66.61), gap("Crescent", 0.096), gap("Siyaram", 0.073)]);
    expect(r.status).toBe("warn");
    expect(r.summary).toBe(
      "30 priceable ISIN(s) unmapped, ₹683 cr held at reported value (total > ₹500 cr, one ISIN > ₹200 cr); top: HEG Graphite ₹616 cr; TVS Pref ₹67 cr; Crescent ₹0.10 cr"
    );
  });
});
