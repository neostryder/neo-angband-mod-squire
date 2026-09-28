import { describe, expect, it } from "vitest";
import { defaultPersona } from "../persona/persona.js";
import { chronicleLine, isNotable, notorietyQuestion, notorietyState } from "./chronicle.js";
import type { RunEvent } from "./events.js";

const event: RunEvent = { kind: "unique-kill", turn: 40, depth: 5, text: "Bullroarer the Hobbit", race: "Hobbit" };

describe("Chronicle", () => {
  it("uses the five ordered notoriety levels and the event facts", () => {
    expect(notorietyQuestion(event).criteria).toEqual(["routine", "worth a mention", "notable", "memorable", "legendary"]);
    expect(notorietyState(event, "Mira", 5, 8)).toMatchObject({ persona: "Mira", fact: event.text, race: "Hobbit", level: 8 });
  });

  it.each([
    [0, 2, false], [0, 3, true], [50, 1, false], [50, 2, true], [100, 0, false], [100, 1, true],
  ])("voice %i treats score %i as notable: %s", (voice, score, expected) => {
    expect(isNotable({ type: "score", score, confidence: 1, probabilities: [] }, voice)).toBe(expected);
  });

  it("has three distinct templates for every event kind", () => {
    const persona = defaultPersona("Mira");
    for (const kind of ["kill", "unique-kill", "near-death", "escape", "level-up", "descend",
      "item-found", "death", "divergence", "lesson", "lineage"] as const) {
      const lines = [0, 0.4, 0.9].map((draw) => chronicleLine({ ...event, kind }, persona, () => draw));
      expect(new Set(lines).size, kind).toBe(3);
    }
  });

  it("adds the persona's reaction only for a high voice", () => {
    const persona = defaultPersona("Mira");
    persona.sliders.boldness = 90;
    persona.sliders.chronicle = 100;
    expect(chronicleLine(event, persona, () => 0)).toContain("I earned that story.");
    persona.sliders.boldness = 10;
    expect(chronicleLine(event, persona, () => 0)).toContain("I am glad");
    persona.sliders.chronicle = 0;
    expect(chronicleLine(event, persona, () => 0)).not.toContain("I am glad");
  });
});
