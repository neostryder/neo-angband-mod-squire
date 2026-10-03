import { describe, expect, it } from "vitest";
import { ARCHETYPES, archetype, defaultPersona, type ArchetypeId } from "./persona.js";
import { inCharacterInstructions, personaState } from "./state.js";

describe("persona state", () => {
  it("describes strong traits, lists, and active quirks", () => {
    const persona = defaultPersona("Nia");
    persona.sliders.boldness = 90;
    persona.sliders.curiosity = 30;
    persona.lists.hated = ["orcs"];
    persona.quirks.pyromaniac.on = true;
    const state = personaState(persona, 100);
    expect(state.traits).toContain("Boldness: very bold");
    expect(state.traits).toContain("Curiosity: somewhat incurious");
    expect(state.hated).toBe("orcs");
    expect(state.quirks).toBe("pyromaniac");
    expect(inCharacterInstructions(persona)).toContain("Nia");
  });

  it("limits backstory and omits it at zero weight", () => {
    const persona = defaultPersona();
    persona.backstory = "First sentence. Second sentence keeps going and going.";
    persona.backstoryCap = 10;
    expect(personaState(persona, 100).backstory).toBe("First sentence.");
    persona.sliders.backstory = 0;
    expect(personaState(persona, 100).backstory).toBeUndefined();
  });
});

describe("personaState scope", () => {
  it("never describes Squire's own dials as traits", () => {
    const p = defaultPersona("Beren");
    p.sliders.drift = 100;
    p.sliders.learning = 0;
    p.sliders.devotion = 100;
    const state = personaState(p, 500);
    expect(state["traits"] ?? "").not.toMatch(/drift|Learning|Devotion/i);
  });
});

describe("persona state: law, good and style", () => {
  it("states Law to Chaos and Good to Evil only when strong", () => {
    const p = defaultPersona("Vex");
    p.sliders.lawchaos = 90;
    p.sliders.goodevil = 30;
    const traits = personaState(p, 0)["traits"] ?? "";
    expect(traits).toContain("Law to Chaos: very chaotic");
    expect(traits).toContain("Good to Evil: somewhat good");
    p.sliders.lawchaos = 60;
    p.sliders.goodevil = 40;
    expect(personaState(p, 0)["traits"] ?? "").not.toMatch(/Law to Chaos|Good to Evil/);
  });

  it.each(Object.keys(ARCHETYPES) as ArchetypeId[])("states the %s preset's play rule", (id) => {
    const state = personaState(archetype(id), 0);
    expect(state["play_rule"]).toBe(ARCHETYPES[id].rule);
  });

  it("states no play rule without a preset, and drops it when the preset is cleared", () => {
    expect(personaState(defaultPersona(), 0)).not.toHaveProperty("play_rule");
    expect(personaState({ ...archetype("paranoid"), preset: null }, 0)).not.toHaveProperty("play_rule");
  });
});
