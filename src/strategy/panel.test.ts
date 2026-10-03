import { describe, expect, it } from "vitest";
import { AIMS_EMPTY, AIMS_HEADING, aimLines, concernFor, panelLines } from "./panel.js";
import { world } from "../harness.js";
import type { Aim } from "./aims.js";

const book: Aim = { kind: "spellbook", label: "next spellbook", detail: "", how: "save", price: 100, depth: null };
const dive: Aim = { kind: "depth", label: "depth target", detail: "", how: "dive", price: null, depth: 3 };
const hunt: Aim = { kind: "free-action", label: "free action", detail: "", how: "hunt", price: null, depth: null };
const carried: Aim = { kind: "armour", label: "armour for empty slots", detail: "", how: "try", price: null, depth: null };

describe("aim panel lines", () => {
  it("names the section briefly and says so when there are no aims", () => {
    expect(AIMS_HEADING).toBe("Intent");
    expect(aimLines([], { gold: 0, depth: 0 })).toEqual([AIMS_EMPTY]);
  });

  it("numbers the aims in rank order with how each is pursued", () => {
    expect(aimLines([book, hunt, carried, dive], { gold: 30, depth: 2 })).toEqual([
      "1. Next spellbook: save 100 gold (have 30)",
      "2. Free action: hunt in the dungeon",
      "3. Armour for empty slots: try what is in the pack",
      "4. Depth target: reach 150 ft (now 100 ft)",
    ]);
  });

  it("says buy once the gold covers the price", () => {
    expect(aimLines([book], { gold: 100, depth: 0 })).toEqual(["1. Next spellbook: buy for 100 gold"]);
  });

  it("shows the intent card above the aims, with the long-term goal only when the switch is on", () => {
    const near = "Rest to full. 10 of 40 hit points. Chosen on reaching a new level.";
    const mid = "Depth target. Dungeon level 2 of 3. Chosen on reaching a new level.";
    const long = "Win the game. Chosen on the first look at this character.";
    const concern = { depth: 3, reason: "working light" };
    const next = { actions: 37, depth: 5, capped: false };
    const state = { gold: 0, depth: 2 };
    expect(panelLines([dive], state, { near, mid, long, showLong: false, concern, next })).toEqual([
      `Near-term goal: ${near}`,
      `Mid-term goal: ${mid}`,
      "Concern: the character still lacks working light for dungeon level 3.",
      "Next check: after 37 more actions, or on first reaching dungeon level 5.",
      "1. Depth target: reach 150 ft (now 100 ft)",
    ]);
    expect(panelLines([dive], state, { near, mid, long, showLong: true, concern: null, next })).toEqual([
      `Near-term goal: ${near}`,
      `Mid-term goal: ${mid}`,
      `Long-term goal: ${long}`,
      "Next check: after 37 more actions, or on first reaching dungeon level 5.",
      "1. Depth target: reach 150 ft (now 100 ft)",
    ]);
    expect(panelLines([dive], state, { near: null, mid: null, long, showLong: false, next: { actions: 1, depth: 5, capped: false } })).toEqual(["1. Depth target: reach 150 ft (now 100 ft)"]);
    expect(panelLines([dive], state, { near, long: null, showLong: true, next: { actions: 1, depth: 5, capped: true } })).toContain("Next check: on another dungeon level. Squire already dropped two aims on this one.");
    expect(panelLines([], state, { near: "", long: "", showLong: true })).toEqual([AIMS_EMPTY]);
  });

  it("names the first hard gap for the next level down as the concern, else the first soft one", () => {
    const dark = world({ map: ["#####", "#.@.#", "#####"], player: { depth: 2, level: 10, maxLevel: 10, maxHp: 100, hp: 100 } });
    expect(concernFor(dark.view)).toEqual({ depth: 3, reason: "working light" });
    const town = world({ map: ["#####", "#.@.#", "#####"], player: { depth: 0 } });
    expect(concernFor(town.view)).toBeNull();
  });
});
