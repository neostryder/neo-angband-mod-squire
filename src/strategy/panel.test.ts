import { describe, expect, it } from "vitest";
import { AIMS_EMPTY, AIMS_HEADING, aimLines, panelLines } from "./panel.js";
import type { Aim } from "./aims.js";

const book: Aim = { kind: "spellbook", label: "next spellbook", detail: "", how: "save", price: 100, depth: null };
const dive: Aim = { kind: "depth", label: "depth target", detail: "", how: "dive", price: null, depth: 3 };
const hunt: Aim = { kind: "free-action", label: "free action", detail: "", how: "hunt", price: null, depth: null };
const carried: Aim = { kind: "armour", label: "armour for empty slots", detail: "", how: "try", price: null, depth: null };

describe("aim panel lines", () => {
  it("names the section briefly and says so when there are no aims", () => {
    expect(AIMS_HEADING).toBe("Aims");
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

  it("adds the near-term goal, and the long-term goal only when the switch is on", () => {
    const near = "Rest to full. 10 of 40 hit points. Chosen on reaching a new level.";
    const long = "Win the game. Chosen on the first look at this character.";
    const state = { gold: 0, depth: 2 };
    const hidden = panelLines([dive], state, { near, long, showLong: false });
    expect(hidden.some((line) => line.startsWith("Long-term goal:"))).toBe(false);
    expect(hidden.at(-1)).toBe(`Near-term goal: ${near}`);
    const shown = panelLines([dive], state, { near: null, long, showLong: true });
    expect(shown.at(-1)).toBe(`Long-term goal: ${long}`);
    expect(panelLines([], state, { near: "", long: "", showLong: true })).toEqual([AIMS_EMPTY]);
  });
});