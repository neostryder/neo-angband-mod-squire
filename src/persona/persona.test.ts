import { describe, expect, it } from "vitest";
import { ARCHETYPES, archetype, defaultPersona, normalize, randomPersona } from "./persona.js";

describe("persona", () => {
  it("sets defaults", () => {
    const persona = defaultPersona("Ada");
    expect(persona.name).toBe("Ada");
    expect(persona.sliders.strength).toBe(35);
    expect(persona.sliders.selfpreservation).toBe(70);
    expect(persona.toggles.grudges).toBe(true);
    expect(persona.quirks.deathwish).toEqual({ on: false, strength: 50 });
  });

  it("normalizes garbage and bounded fields", () => {
    expect(normalize(null)).toEqual(defaultPersona());
    const persona = normalize({ name: " Test ", sliders: { boldness: 102.7, greed: -5, unknown: 9 },
      lists: { hated: ["  dragons  ", 9, "", "x".repeat(50)] }, quirks: { forgetful: { on: true, strength: 123 } },
      toggles: { grudges: false }, backstoryCap: 5000, backstory: "x".repeat(21_000), mystery: true });
    expect(persona.name).toBe("Test");
    expect(persona.sliders.boldness).toBe(100);
    expect(persona.sliders.greed).toBe(0);
    expect(persona.lists.hated).toEqual(["dragons", "x".repeat(40)]);
    expect(persona.quirks.forgetful).toEqual({ on: true, strength: 100 });
    expect(persona.toggles.grudges).toBe(false);
    expect(persona.backstoryCap).toBe(4000);
    expect(persona.backstory).toHaveLength(20_000);
    expect("mystery" in persona).toBe(false);
  });

  it("uses deterministic random values and excludes death wish", () => {
    const persona = randomPersona(() => 0, "Roll");
    expect(persona.sliders.boldness).toBe(20);
    expect(persona.quirks.forgetful.on).toBe(true);
    expect(persona.quirks.deathwish.on).toBe(false);
    expect(persona.lists.hated).toEqual([]);
    expect(randomPersona(() => 0.999).sliders.boldness).toBe(80);
  });

  it("builds every archetype without changing defaults", () => {
    expect(Object.keys(ARCHETYPES)).toEqual(["coward", "berserker", "miser", "scholar", "zealot", "tourist"]);
    expect(archetype("coward").quirks.cowardice.on).toBe(true);
    expect(archetype("berserker").sliders.boldness).toBe(90);
    expect(archetype("miser").sliders.greed).toBe(95);
    expect(archetype("scholar").lists.elements).toContain("magic");
    expect(archetype("zealot").sliders.devotion).toBe(95);
    expect(archetype("tourist").sliders.levelfeel).toBe(90);
    expect(defaultPersona().lists.elements).toEqual([]);
  });
});
