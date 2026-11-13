import { describe, expect, it } from "vitest";
import { isFitMaDays, resolveFitSettings, type FitSettings } from "./fit-settings";

const stored: FitSettings = { fitRange: "3y", fitMaDays: 45, fitAumOnlyAveraging: true, fitLevelsCorrelation: true, fitSavedAt: "2026-11-01T10:00:00.000Z" };
const NOW = "2026-11-13T10:12:00.000Z";

describe("resolveFitSettings", () => {
  it("keeps every stored value (and its time) when a save omits them, as the other Save buttons do", () => {
    expect(resolveFitSettings({ range: "1y", maDays: 20 }, stored, NOW)).toEqual({ ok: true, value: stored });
  });

  it("keeps the time when another save echoes the same values back", () => {
    const echoed = { fitRange: "3y", fitMaDays: 45, fitAumOnlyAveraging: true, fitLevelsCorrelation: true, fitSavedAt: "ignored" };
    expect(resolveFitSettings(echoed, stored, NOW)).toEqual({ ok: true, value: stored });
  });

  it("stores a changed view with the save time", () => {
    const r = resolveFitSettings({ fitRange: "2y", fitMaDays: 20, fitAumOnlyAveraging: false, fitLevelsCorrelation: false }, stored, NOW);
    expect(r).toEqual({ ok: true, value: { fitRange: "2y", fitMaDays: 20, fitAumOnlyAveraging: false, fitLevelsCorrelation: false, fitSavedAt: NOW } });
  });

  it("rejects a bad value instead of saving it", () => {
    expect(resolveFitSettings({ fitRange: "5y" }, stored, NOW).ok).toBe(false);
    expect(resolveFitSettings({ fitMaDays: 0 }, stored, NOW).ok).toBe(false);
    expect(resolveFitSettings({ fitMaDays: 20.5 }, stored, NOW).ok).toBe(false);
    expect(resolveFitSettings({ fitMaDays: "45" }, stored, NOW).ok).toBe(false);
    expect(resolveFitSettings({ fitLevelsCorrelation: "yes" }, stored, NOW).ok).toBe(false);
  });
});

describe("isFitMaDays", () => {
  it("accepts whole days from 1 to 250", () => {
    expect([1, 45, 250].every(isFitMaDays)).toBe(true);
    expect([0, 251, 4.5, NaN, null].some(isFitMaDays)).toBe(false);
  });
});
