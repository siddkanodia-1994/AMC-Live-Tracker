import { describe, expect, it } from "vitest";
import { classifyLiveAumStep, isInstrumentSyncDay } from "./cron-steps";

const stock = (companyName: string, autoMuted = false) => ({ isin: `IN-${companyName}`, companyName, autoMuted });

describe("classifyLiveAumStep", () => {
  it("26 Nov: two stuck stocks no longer warn, and are named", () => {
    const r = classifyLiveAumStep("degraded", [stock("Dr Agarwals Eye Hospital Ltd."), stock("United Foodbrands Ltd.")], 49);
    expect(r.status).toBe("ok");
    expect(r.summary).toBe("49 AMCs snapshotted, DHAN degraded, 2 on last close (Dr Agarwals Eye Hospital Ltd.; United Foodbrands Ltd.)");
  });

  it("warns above 5 active stocks; muted ones don't count", () => {
    const six = ["A", "B", "C", "D", "E", "F"].map((n) => stock(n));
    expect(classifyLiveAumStep("degraded", six, 49).status).toBe("warn");
    const r = classifyLiveAumStep("degraded", [...six.slice(0, 5), stock("Muted Co", true)], 49);
    expect(r.status).toBe("ok");
    expect(r.summary).toContain("5 on last close");
    expect(r.summary).toContain("1 muted");
  });

  it("warns for one large holding on a stale price, even alone", () => {
    const values = new Map([["IN-Big Bank", 52000], ["IN-United Foodbrands Ltd.", 305.54]]);
    const r = classifyLiveAumStep("degraded", [stock("Big Bank"), stock("United Foodbrands Ltd.")], 49, values);
    expect(r.status).toBe("warn");
    expect(r.summary).toContain("Big Bank ₹52,000 cr");
    expect(r.summary).toContain("United Foodbrands Ltd.");
  });

  it("stays ok at exactly ₹500 cr, and when the large one is muted", () => {
    expect(classifyLiveAumStep("degraded", [stock("Edge Co")], 49, new Map([["IN-Edge Co", 500]])).status).toBe("ok");
    expect(classifyLiveAumStep("degraded", [stock("Big Bank", true)], 49, new Map([["IN-Big Bank", 52000]])).status).toBe("ok");
  });

  it("names only the large ones when more than 5 are stuck", () => {
    const many = ["A", "B", "C", "D", "E", "F"].map((n) => stock(n));
    const r = classifyLiveAumStep("degraded", many, 49, new Map([["IN-C", 900]]));
    expect(r.status).toBe("warn");
    expect(r.summary).toBe("49 AMCs snapshotted, DHAN degraded, 6 on last close (C ₹900 cr)");
  });

  it("a DHAN outage is still a fail; a clean day is ok", () => {
    expect(classifyLiveAumStep("unavailable", [], 49).status).toBe("fail");
    expect(classifyLiveAumStep("ok", [], 49)).toEqual({ status: "ok", summary: "49 AMCs snapshotted, DHAN ok, 0 on last close" });
  });
});

describe("isInstrumentSyncDay", () => {
  it("is Monday by IST date only", () => {
    expect(isInstrumentSyncDay("2026-11-30")).toBe(true); // Monday
    expect(isInstrumentSyncDay("2026-11-27")).toBe(false); // Friday
    expect(isInstrumentSyncDay("2026-12-01")).toBe(false);
  });
});
