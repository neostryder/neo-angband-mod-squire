import { describe, expect, it } from "vitest";
import { applyDrift } from "./drift.js";
import { defaultPersona } from "./persona.js";

describe("trait drift", () => {
  it("moves the affected traits and leaves the input alone", () => {
    const persona = defaultPersona();
    const result = applyDrift(persona, "near-death", () => 0);
    expect(result.changes).toEqual([{ id: "boldness", from: 50, to: 48 }, { id: "paranoia", from: 50, to: 52 }]);
    expect(persona.sliders.boldness).toBe(50);
    expect(applyDrift(persona, "unique-kill").changes.map((change) => change.id)).toEqual(["pride", "boldness"]);
    expect(applyDrift(persona, "level-up").persona.sliders.composure).toBe(52);
    expect(applyDrift(persona, "fled").persona.sliders.pride).toBe(48);
  });

  it("weights patron events and clamps at the bounds", () => {
    const persona = defaultPersona();
    persona.sliders.drift = 100;
    persona.sliders.gratitude = 100;
    persona.sliders.resentment = 100;
    persona.sliders.devotion = 95;
    expect(applyDrift(persona, "patron-blessing").persona.sliders.devotion).toBe(100);
    expect(applyDrift(persona, "patron-trial").persona.sliders.devotion).toBe(85);
    persona.sliders.drift = 0;
    expect(applyDrift(persona, "near-death").changes).toEqual([]);
  });
});
