import { describe, expect, it } from "vitest";
import { world } from "../harness.js";
import { createLevelPacing, levelBudget, stairLeash } from "./pacing.js";

describe("level game-turn budgets", () => {
  it("limits the level 1 Warrior to 500 unproductive game turns instead of 89,000", () => {
    const w = world({ map: ["#####", "#<@>#", "#####"], player: { level: 1, maxLevel: 1 } });
    const pacing = createLevelPacing();
    pacing.observe(w.view, w.terrain);
    w.advance(499);
    expect(pacing.observe(w.view, w.terrain).expired).toBe(false);
    w.advance(1);
    expect(pacing.observe(w.view, w.terrain)).toMatchObject({ expired: true, review: true });
    w.advance(88500);
    expect(pacing.observe(w.view, w.terrain)).toMatchObject({ expired: true, review: false });
  });

  it.each(["experience", "gold", "supplies", "frontier"])("credits new %s once", (progress) => {
    const w = world({ map: ["#######", "#<@.. #", "#######"], player: { level: 1, maxLevel: 1 }, pack: ["a Potion of Cure Light Wounds"] });
    const pacing = createLevelPacing();
    pacing.observe(w.view, w.terrain);
    w.advance(490);
    if (progress === "experience") w.setPlayer({ exp: 101 });
    if (progress === "gold") w.setPlayer({ gold: 101 });
    if (progress === "supplies") w.setPack(["2 Potions of Cure Light Wounds"]);
    if (progress === "frontier") w.moveTo({ x: 4, y: 1 });
    pacing.observe(w.view, w.terrain);
    w.advance(499);
    expect(pacing.observe(w.view, w.terrain).expired).toBe(false);
    w.advance(1);
    expect(pacing.observe(w.view, w.terrain).expired).toBe(true);
  });

  it("resets on a fresh same-depth floor but repeated arrival messages do not reset the clock", () => {
    const w = world({ map: ["@"], player: { level: 1 } });
    const pacing = createLevelPacing();
    pacing.observe(w.view);
    w.advance(500);
    expect(pacing.observe(w.view).expired).toBe(true);
    w.setMessages(["This place seems reasonably safe."]);
    expect(pacing.observe(w.view)).toMatchObject({ expired: false, fresh: true });
    w.advance(500);
    expect(pacing.observe(w.view)).toMatchObject({ expired: true, fresh: false });
  });

  it("puts a hard cap on a level even when small gains continue", () => {
    const w = world({ map: ["@"], player: { level: 1 } });
    const pacing = createLevelPacing();
    pacing.observe(w.view);
    for (let count = 1; count <= 4; count += 1) {
      w.advance(500);
      w.setPlayer({ exp: 100 + count });
      expect(pacing.observe(w.view).expired).toBe(count === 4);
    }
  });

  it("uses a 12-step leash at level 1 and a 24-step leash at level 5", () => {
    expect(stairLeash(1)).toBe(12);
    expect(stairLeash(5)).toBe(24);
    expect(stairLeash(20)).toBe(Infinity);
    expect(levelBudget(30)).toBe(10000);
  });
});
