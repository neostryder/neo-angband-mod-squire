import { describe, expect, it } from "vitest";
import { applyBlame, blameQuestion, dreadedRaces, fade, lessonFrom, reinforce, retrieve } from "./lessons.js";
import { signatureOf } from "./signature.js";

const signature = signatureOf({ depth: 18, classId: "mage", level: 10, races: ["cave troll"], hp: 20, maxHp: 100, resources: ["phase"] });

describe("lessons", () => {
  it("writes short outcome lines", () => {
    const death = lessonFrom("died", signature, "fight", 100, { race: "cave troll", action: "fight", depth: 18, level: 10, cls: "Mage" });
    expect(death.line).toBe("A cave troll killed a level 10 mage at 900 ft after choosing to fight; next time avoid it at that depth or keep an escape ready.");
    expect(death.weight).toBe(1);
    expect(lessonFrom("near-death", signature, "fight", 102, { race: "Grip, Farmer Maggot's Dog", depth: 0, level: 1, cls: "Mage", hpLeft: 2, maxHp: 12 }).line)
      .toBe("Grip, Farmer Maggot's Dog brought a level 1 mage down to 2 of 12 HP in town after choosing to fight; next time leave or escape sooner against it.");
    /* Saved lessons of the older kinds still read as they did. */
    expect(lessonFrom("escaped", signature, "phase", 101).line).toContain("Escaped");
    expect(lessonFrom("unique-kill", signature, "fight", 103).line).toContain("Defeated");
    expect(lessonFrom("loss", signature, "fight", 104).line).toContain("Lost ground");
  });

  it("never names resting or passing on every option as the cause", () => {
    for (const decision of ["rest", "none_of_these", "unknown"]) {
      const line = lessonFrom("near-death", signature, decision, 1, { race: "cave spider", depth: 2 }).line;
      expect(line).not.toContain("choosing");
    }
  });

  it("writes what happened, the result and what to do next time", () => {
    const vars = { race: "battle-scarred veteran", level: 1, cls: "Mage", hpLeft: 4, maxHp: 12 };
    expect(lessonFrom("big-hit", signature, "fight", 1, { ...vars, damage: 8, melee: true, closing: true }).line)
      .toBe("A battle-scarred veteran hit a level 1 mage for 8 while it closed to melee, leaving 4 of 12 HP; prefer range or avoid it below 16 HP.");
    expect(lessonFrom("big-hit", signature, "explore", 1, { ...vars, damage: 5, melee: false }).line)
      .toBe("A battle-scarred veteran hit a level 1 mage for 5 from range, leaving 4 of 12 HP; keep out of its line of sight below 10 HP.");
    expect(lessonFrom("disabled", signature, "fight", 1, { ...vars, race: "floating eye", status: "paralyzed" }).line)
      .toBe("A floating eye paralyzed a level 1 mage; fight it only with free action, or not at all.");
    expect(lessonFrom("ability", signature, "fight", 1, { race: "baby blue dragon", ability: "breath" }).line)
      .toBe("A baby blue dragon can breathe; stay out of its line of sight when hurt.");
    expect(lessonFrom("resisted", signature, "cast_attack", 1, { race: "white jelly" }).line)
      .toBe("A white jelly resisted the attack spell; use a different attack on it.");
    expect(lessonFrom("breeding", signature, "fight", 1, { race: "green worm mass", swarm: 9 }).line)
      .toBe("A green worm mass breeds (9 in sight); kill each one at once or take the stairs before it fills the level.");
    expect(lessonFrom("failed-escape", signature, "phase", 1, { ...vars, race: "cave spider", damage: 6 }).line)
      .toBe("A short teleport did not get a level 1 mage clear of a cave spider, which hit for 6, leaving 4 of 12 HP; escape earlier, or use a longer escape.");
  });

  it("keeps one lesson per creature and cause when given a once key", () => {
    const first = lessonFrom("ability", signature, "fight", 10, { race: "kobold archer", ability: "missile" }, "kobold archer:missile");
    const again = lessonFrom("ability", signature, "fight", 99, { race: "kobold archer", ability: "missile" }, "kobold archer:missile");
    expect(again.id).toBe(first.id);
    expect(lessonFrom("died", signature, "fight", 10).id).not.toBe(lessonFrom("died", signature, "fight", 11).id);
  });

  it("names a breeding swarm as the foe", () => {
    const swarm = lessonFrom("near-death", signature, "fight", 105, { race: "green worm mass", depth: 2, swarm: 27 });
    expect(swarm.line).toBe("A swarm of green worm mass (27 in sight) brought the character close to death at 100 ft after choosing to fight; next time leave or escape sooner against it.");
    expect(dreadedRaces([swarm]).has("green worm mass")).toBe(true);
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
