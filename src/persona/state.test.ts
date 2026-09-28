import { describe, expect, it } from "vitest";
import { defaultPersona } from "./persona.js";
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
