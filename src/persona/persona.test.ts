import { describe, expect, it } from "vitest";
import { PARAMETERS } from "./catalog.js";
import { exportPersona, importPersona } from "./file.js";
import { ARCHETYPES, archetype, defaultPersona, neutralPersona, normalize, presetRule, randomPersona } from "./persona.js";

describe("persona", () => {
  it("sets defaults", () => {
    const persona = defaultPersona("Ada");
    expect(persona.name).toBe("Ada");
    expect(persona.sliders.strength).toBe(35);
    expect(persona.sliders.selfpreservation).toBe(55);
    expect(persona.sliders.boldness).toBe(65);
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
    expect(Object.keys(ARCHETYPES)).toEqual(["coward", "berserker", "miser", "scholar", "zealot", "tourist", "diver", "completionist", "paranoid"]);
    expect(archetype("coward").quirks.cowardice.on).toBe(true);
    expect(archetype("berserker").sliders.boldness).toBe(90);
    expect(archetype("miser").sliders.greed).toBe(95);
    expect(archetype("scholar").lists.elements).toContain("magic");
    expect(archetype("zealot").sliders.devotion).toBe(95);
    expect(archetype("tourist").sliders.levelfeel).toBe(90);
    expect(defaultPersona().lists.elements).toEqual([]);
  });

  it("reads a persona saved before Law to Chaos and Good to Evil as neutral on both", () => {
    const old = JSON.parse(JSON.stringify(defaultPersona("Old"))) as { sliders: Record<string, number> };
    delete old.sliders["lawchaos"];
    delete old.sliders["goodevil"];
    old.sliders["boldness"] = 80;
    const read = normalize(old);
    expect(read.sliders.lawchaos).toBe(50);
    expect(read.sliders.goodevil).toBe(50);
    expect(read.sliders.boldness).toBe(80);
    expect(read.preset).toBeNull();
    expect(normalize({ ...defaultPersona(), sliders: { lawchaos: 90, goodevil: 5 } }).sliders).toMatchObject({ lawchaos: 90, goodevil: 5 });
  });

  it("rolls every slider, the new axes included, within the random range", () => {
    let seed = 1;
    const rng = () => {
      seed = (seed * 16807) % 2147483647;
      return seed / 2147483647;
    };
    const seen: Record<string, Set<number>> = {};
    for (let i = 0; i < 40; i += 1) {
      const rolled = randomPersona(rng);
      for (const parameter of PARAMETERS) {
        if (parameter.kind !== "slider") continue;
        const value = rolled.sliders[parameter.id];
        expect(value).toBeGreaterThanOrEqual(20);
        expect(value).toBeLessThanOrEqual(80);
        (seen[parameter.id] ??= new Set()).add(value);
      }
    }
    for (const parameter of PARAMETERS) if (parameter.kind === "slider") expect(seen[parameter.id]!.size, parameter.id).toBeGreaterThan(5);
    expect(randomPersona(() => 0).sliders).toMatchObject({ lawchaos: 20, goodevil: 20 });
    expect(randomPersona(() => 0.999).sliders).toMatchObject({ lawchaos: 80, goodevil: 80 });
    expect(randomPersona(rng).preset).toBeNull();
  });

  it("gives every preset a short plain play rule and remembers the preset through a save", () => {
    for (const id of Object.keys(ARCHETYPES) as (keyof typeof ARCHETYPES)[]) {
      const persona = archetype(id);
      expect(persona.preset).toBe(id);
      const rule = presetRule(persona);
      expect(rule).toMatch(/^[a-z][ -~]*[a-z]$/);
      expect(rule!.length).toBeLessThanOrEqual(60);
      const file = importPersona(exportPersona(persona));
      expect(file.ok && file.persona.preset).toBe(id);
      expect(normalize(JSON.parse(JSON.stringify(persona))).preset).toBe(id);
    }
    expect(presetRule(archetype("coward"))).toBe("retreats at the first real loss of hit points");
    expect(presetRule(archetype("diver"))).toBe("ignores minor loot and heads down");
    expect(presetRule(archetype("completionist"))).toBe("maps the whole level and keeps identify scrolls");
    expect(presetRule(archetype("paranoid"))).toBe("will not fight a unique without an escape path");
    expect(normalize({ preset: "hero" }).preset).toBeNull();
    expect(normalize({ preset: "toString" }).preset).toBeNull();
    expect(presetRule(defaultPersona())).toBeNull();
  });

  it("keeps the preset when a lever is edited by hand", () => {
    const edited = normalize({ ...archetype("diver"), sliders: { ...archetype("diver").sliders, greed: 90 } });
    expect(edited.sliders.greed).toBe(90);
    expect(edited.preset).toBe("diver");
  });

  it("starts a neutral persona at the catalog neutral with no quirks or style", () => {
    const neutral = neutralPersona("Nell");
    expect(neutral.name).toBe("Nell");
    for (const parameter of PARAMETERS) {
      if (parameter.kind === "slider") expect(neutral.sliders[parameter.id], parameter.id).toBe("default" in parameter ? parameter.default : 50);
      if (parameter.kind === "quirk") expect(neutral.quirks[parameter.id].on, parameter.id).toBe(false);
      if (parameter.kind === "toggle") expect(neutral.toggles[parameter.id], parameter.id).toBe(parameter.default);
      if (parameter.kind === "list") expect(neutral.lists[parameter.id], parameter.id).toEqual([]);
    }
    expect(neutral.sliders.lawchaos).toBe(50);
    expect(neutral.sliders.goodevil).toBe(50);
    expect(neutral.backstoryCap).toBe(600);
    expect(neutral.preset).toBeNull();
  });
});
