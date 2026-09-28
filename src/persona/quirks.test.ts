import { describe, expect, it } from "vitest";
import { defaultPersona } from "./persona.js";
import { fleesFromNew, forget, mustPickUp, shiftThreat } from "./quirks.js";

describe("quirks", () => {
  it("shifts threat with optimism and a deterministic delusion", () => {
    const persona = defaultPersona();
    persona.sliders.optimism = 80;
    expect(shiftThreat(2, 4, persona, () => 1)).toBe(1);
    persona.quirks.delusional = { on: true, strength: 100 };
    expect(shiftThreat(2, 4, persona, () => 0)).toBe(0);
  });

  it("drops lessons and exposes mandatory habits", () => {
    const persona = defaultPersona();
    persona.quirks.forgetful = { on: true, strength: 100 };
    expect(forget([1, 2, 3], persona, () => 0)).toEqual([]);
    persona.quirks.compulsive.on = true;
    persona.quirks.cowardice.on = true;
    expect(mustPickUp(persona)).toBe(true);
    expect(fleesFromNew(persona)).toBe(true);
  });
});
