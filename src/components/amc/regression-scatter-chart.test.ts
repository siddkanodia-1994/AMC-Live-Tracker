import { describe, expect, it } from "vitest";
import { dateShade } from "./regression-scatter-chart";

describe("dateShade (older -> recent scatter shading)", () => {
  it("runs from the light oldest colour to navy for the newest session", () => {
    expect(dateShade(0)).toBe("rgb(203, 213, 240)");
    expect(dateShade(1)).toBe("rgb(30, 58, 138)");
  });
  it("clamps out-of-range and non-finite positions", () => {
    expect(dateShade(-1)).toBe(dateShade(0));
    expect(dateShade(2)).toBe(dateShade(1));
    expect(dateShade(Number.NaN)).toBe(dateShade(0));
  });
});
