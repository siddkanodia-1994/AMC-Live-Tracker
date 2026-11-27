import { describe, expect, it } from "vitest";
import { classifyDailyCronRun, classifyInstrumentMapGaps, classifyMcx, expectedReportPeriod } from "./probe";

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

describe("classifyDailyCronRun", () => {
  it("fails when no run is recorded for the close date", () => {
    expect(classifyDailyCronRun(undefined, "2026-11-23")).toEqual({ status: "fail", summary: "no daily-snapshot run recorded for 2026-11-23" });
  });

  it("passes through ok and warn runs with their summary", () => {
    expect(classifyDailyCronRun({ status: "ok", summary: "49 AMCs" }, "2026-11-23")).toEqual({ status: "ok", summary: "49 AMCs" });
    expect(classifyDailyCronRun({ status: "warn", summary: "DHAN degraded" }, "2026-11-23").status).toBe("warn");
  });

  it("treats a failed run as a fail", () => {
    expect(classifyDailyCronRun({ status: "fail", summary: "computeLiveAum threw" }, "2026-11-23").status).toBe("fail");
  });
});

describe("classifyMcx", () => {
  const dec = [
    { metal: "gold", tradingSymbol: "GOLD-04Dec2026-FUT", expiryDate: "2026-12-04" },
    { metal: "silver", tradingSymbol: "SILVER-04Dec2026-FUT", expiryDate: "2026-12-04" },
  ];

  it("is ok with a fresh price and contracts more than 7 days out", () => {
    expect(classifyMcx("2026-11-25", "2026-11-25", dec, "2026-11-26").status).toBe("ok");
  });

  it("warns from 7 days before expiry, naming the contracts to roll", () => {
    expect(classifyMcx("2026-11-25", "2026-11-25", dec, "2026-11-26").status).toBe("ok"); // 8 days out
    const r = classifyMcx("2026-11-26", "2026-11-26", dec, "2026-11-27"); // 7 days out
    expect(r.status).toBe("warn");
    expect(r.summary).toContain("GOLD-04Dec2026-FUT on 2026-12-04");
    expect(r.summary).toContain("scripts/seed-mcx-contracts.ts");
    expect(classifyMcx("2026-12-03", "2026-12-03", dec, "2026-12-04").status).toBe("warn"); // expiry day itself
  });

  it("fails once a contract has expired (the price would freeze)", () => {
    const r = classifyMcx("2026-12-04", "2026-12-04", dec, "2026-12-05");
    expect(r.status).toBe("fail");
    expect(r.summary).toContain("EXPIRED");
  });

  it("fails with no tracked contracts, warns on a stale price", () => {
    expect(classifyMcx("2026-11-25", "2026-11-25", [], "2026-11-26").status).toBe("fail");
    expect(classifyMcx("2026-11-20", "2026-11-25", dec, "2026-11-26").status).toBe("warn");
    expect(classifyMcx(null, "2026-11-25", dec, "2026-11-26").status).toBe("warn");
  });
});
