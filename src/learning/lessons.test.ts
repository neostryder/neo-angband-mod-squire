import { describe, expect, it } from "vitest";
import { applyBlame, blameQuestion, dreadedRaces, fade, lessonFrom, reinforce, retrieve } from "./lessons.js";
import { signatureOf } from "./signature.js";

const signature = signatureOf({ depth: 18, classId: "mage", level: 10, races: ["cave troll"], hp: 20, maxHp: 100, resources: ["phase"] });

describe("lessons", () => {
  it("writes short outcome lines", () => {
    const death = lessonFrom("died", signature, "fight", 100, { race: "a cave troll", action: "fight", depth: 18 });
    expect(death.line).toBe("Died at 900 ft to a cave troll after choosing to fight.");
    expect(death.weight).toBe(1);
    expect(lessonFrom("escaped", signature, "phase", 101).line).toContain("Escaped");
    expect(lessonFrom("near-death", signature, "fight", 102).line).toContain("Nearly died");
    expect(lessonFrom("unique-kill", signature, "fight", 103).line).toContain("Defeated");
    expect(lessonFrom("loss", signature, "fight", 104).line).toContain("Lost ground");
  });

  it("retrieves pinned lessons first and adjusts weights", () => {
    const a = lessonFrom("died", signature, "fight", 1);
    const b = { ...lessonFrom("escaped", signature, "phase", 2), pinned: true };
    expect(retrieve([a, b], signature, 1)).toEqual([b]);
    expect(retrieve([], signature, 4)).toEqual([]);
    expect(retrieve([a], signature, 0)).toEqual([]);
    expect(reinforce(a, true, 0.5).weight).toBe(1.5);
    expect(reinforce(a, false, 0.5).weight).toBe(0.5);
    expect(fade([{ ...a, weight: 0.15 }, b], 3001, 0.5)).toEqual([b]);
  });

  it("offers no blame when death had no preceding records", () => {
    expect(blameQuestion([]).criteria).toEqual({ none_of_these: "No listed decision contributed most to the death." });
    expect(applyBlame({ type: "choice", choice: "none_of_these", confidence: 1, probabilities: {} }, [])).toBeNull();
    const records = [{ id: "1", plan: "fight", summary: "A troll was near." }];
    expect(blameQuestion(records).criteria["1"]).toContain("troll");
    expect(applyBlame({ type: "choice", choice: "1", confidence: 1, probabilities: {} }, records)).toBe("1");
    expect(applyBlame({ type: "choice", choice: "missing", confidence: 1, probabilities: {} }, records)).toBeNull();
  });
});

describe("dreadedRaces", () => {
  it("names the creatures behind deaths and near deaths only", () => {
    const sig = { depthBand: 0, classId: "mage", levelBand: 0, families: [], hpBand: 0 as const, resources: [] };
    const lessons = [
      lessonFrom("died", sig, "fight", 10, { race: "mean-looking mercenary" }),
      lessonFrom("near-death", sig, "shop", 20, { race: "aimless-looking merchant" }),
      lessonFrom("escaped", sig, "phase", 30, { race: "cave spider" }),
    ];
    expect([...dreadedRaces(lessons)].sort()).toEqual(["aimless-looking merchant", "mean-looking mercenary"]);
  });
});
