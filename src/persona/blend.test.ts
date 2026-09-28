import { describe, expect, it } from "vitest";
import { applySafetyFloor, blend, jitteredStrength, pick, riskCeiling } from "./blend.js";
import { defaultPersona } from "./persona.js";

describe("decision blending", () => {
  it("blends the union and normalizes", () => {
    expect(blend({ a: 1 }, { b: 1 }, 0.25)).toEqual({ a: 0.75, b: 0.25 });
    expect(blend({ a: 2, b: 2 }, { a: 0, b: 1 }, 1)).toEqual({ a: 0, b: 1 });
  });

  it("jitters with a deterministic draw and computes risk", () => {
    const persona = defaultPersona();
    persona.sliders.volatility = 100;
    expect(jitteredStrength(persona, () => 1)).toBeCloseTo(0.6);
    expect(jitteredStrength(persona, () => 0)).toBeCloseTo(0.1);
    expect(riskCeiling(persona)).toBeCloseTo(0.25);
  });

  it("keeps the least risky option if all exceed the ceiling", () => {
    expect(applySafetyFloor({ a: 0.9, b: 0.1 }, { a: 0.8, b: 0.7 }, 0.2, false))
      .toEqual({ dist: { b: 1 }, removed: ["a"] });
    expect(applySafetyFloor({ a: 1 }, { a: 1 }, 0.2, true).removed).toEqual([]);
    expect(pick({ a: 0.5, b: 0.5 })).toBe("a");
  });

  it("keeps the safest real option rather than only none_of_these", () => {
    const floored = applySafetyFloor(
      { fight: 0.02, retreat: 0.92, explore: 0.01, none_of_these: 0.05 },
      { fight: 0.95, retreat: 0.5, explore: 0.8 },
      0.35,
      false,
    );
    expect(floored.removed).toEqual(["fight", "explore"]);
    expect(pick(floored.dist)).toBe("retreat");
  });
});
