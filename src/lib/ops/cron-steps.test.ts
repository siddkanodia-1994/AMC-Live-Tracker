import { describe, expect, it } from "vitest";
import { classifyLiveAumStep, isInstrumentSyncDay } from "./cron-steps";

const stock = (companyName: string, autoMuted = false) => ({ companyName, autoMuted });

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
