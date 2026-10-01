import { describe, expect, it } from "vitest";
import { suppliedWorld, world } from "../harness.js";
import { candidateAims } from "./aims.js";
import { missingEssentials, missingPreparation, supplies, supplyMargin } from "./readiness.js";

const ROOM = ["#####", "#<@>#", "#####"];

describe("prepared depths", () => {
  it.each([2, 3])("rejects the soak's level 1 Warrior with 20 maximum HP at depth %i", (depth) => {
    const w = suppliedWorld({ map: ROOM, player: { cls: "Warrior", level: 1, maxLevel: 1, hp: 20, maxHp: 20 } });
    expect(missingPreparation(w.view, depth).map((need) => need.kind)).toEqual(expect.arrayContaining(["level", "hp"]));
  });

  it("opens depth 2 at 30 maximum HP, maximum level 2, light and five food units", () => {
    const w = suppliedWorld({ map: ROOM, player: { level: 2, maxLevel: 2, hp: 10, maxHp: 30, light: 1 } });
    expect(missingPreparation(w.view, 2)).toEqual([]);
    w.setPack(["4 Rations of Food"]);
    expect(missingPreparation(w.view, 2).map((need) => need.kind)).toContain("food");
  });

  it.each([
    ["Warrior", 50, 4], ["Blackguard", 50, 4], ["Rogue", 50, 8],
    ["Priest", 40, 9], ["Druid", 40, 9], ["Paladin", 50, 4],
    ["Ranger", 50, 4], ["Mage", 60, 11], ["Necromancer", 60, 11],
  ] as const)("uses the depth 3 class floor for %s", (cls, maxHp, maxLevel) => {
    const w = suppliedWorld({ map: ROOM, player: { cls, level: 1, maxLevel, maxHp, hp: maxHp } });
    expect(missingPreparation(w.view, 3)).toEqual([]);
    w.setPlayer({ maxHp: maxHp - 1 });
    expect(missingPreparation(w.view, 3).map((need) => need.kind)).toContain("hp");
    w.setPlayer({ maxHp, maxLevel: maxLevel - 1 });
    expect(missingPreparation(w.view, 3).map((need) => need.kind)).toContain("level");
  });

  it.each([
    ["Warrior", 60, 6], ["Blackguard", 60, 6], ["Rogue", 60, 10],
    ["Priest", 60, 15], ["Druid", 60, 15], ["Paladin", 60, 6],
    ["Ranger", 60, 6], ["Mage", 80, 15], ["Necromancer", 80, 15],
  ] as const)("uses the dungeon depth 5 class floor for %s", (cls, maxHp, maxLevel) => {
    const w = suppliedWorld({ map: ROOM, player: { cls, depth: 4, maxLevel, maxHp, hp: maxHp }, pack: ["a Scroll of Word of Recall"] });
    expect(missingPreparation(w.view, 5)).toEqual([]);
    w.setPlayer({ maxHp: maxHp - 1 });
    expect(missingPreparation(w.view, 5).map((need) => need.kind)).toContain("hp");
    w.setPlayer({ maxHp, maxLevel: maxLevel - 1 });
    expect(missingPreparation(w.view, 5).map((need) => need.kind)).toContain("level");
  });

  it("keeps Recall and Phase Door as cumulative requirements from depths 5 and 6", () => {
    const w = suppliedWorld({ map: ROOM, player: { level: 9, maxLevel: 9, depth: 4 } });
    expect(missingPreparation(w.view, 5).map((need) => need.kind)).toContain("recall");
    w.setPack(["5 Rations of Food", "3 Potions of Cure Light Wounds", "a Scroll of Word of Recall"]);
    expect(missingPreparation(w.view, 5)).toEqual([]);
    expect(missingPreparation(w.view, 6).map((need) => need.kind)).toContain("phase");
  });

  it("requires light radius 2, critical cures, long escapes and invisible detection at depth 10", () => {
    const w = suppliedWorld({ map: ROOM, player: { level: 10, maxLevel: 10, depth: 9, light: 1 }, pack: ["a Scroll of Word of Recall"] });
    expect(missingPreparation(w.view, 10).map((need) => need.kind)).toEqual(expect.arrayContaining(["light", "healing", "phase", "protection"]));
    w.setPlayer({ light: 2, objectFlags: ["SEE_INVIS"] });
    w.setPack(["5 Rations of Food", "3 Potions of Cure Critical Wounds", "a Scroll of Phase Door", "a Scroll of Word of Recall", "2 Scrolls of Teleportation"]);
    expect(missingPreparation(w.view, 10)).toEqual([]);
  });

  it("accepts reliable invisible detection and keeps the Mage's extra level floor", () => {
    const w = suppliedWorld({ map: ROOM, player: { cls: "Mage", depth: 9, level: 15, maxLevel: 15, maxHp: 80, sp: 10, maxSp: 10 }, spells: [{ name: "Detection", sidx: 0, fail: 5 }], pack: ["3 Potions of Cure Critical Wounds", "2 Scrolls of Teleportation", "a Scroll of Word of Recall"] });
    expect(missingPreparation(w.view, 10)).toEqual([]);
    w.setPlayer({ maxLevel: 14 });
    expect(missingPreparation(w.view, 10).map((need) => need.kind)).toContain("level");
  });

  it("never treats mapping or detection of objects as detection of invisible attackers", () => {
    const w = suppliedWorld({ map: ROOM, player: { maxLevel: 20 }, pack: ["a Scroll of Magic Mapping", "a Rod of Treasure Location"] });
    expect(missingPreparation(w.view, 10).map((need) => need.kind)).toContain("protection");
  });

  it("requires Free Action at depth 20 and refuses unknown later protections", () => {
    const w = suppliedWorld({ map: ROOM, player: { maxLevel: 30, objectFlags: ["SEE_INVIS"] }, pack: ["a Scroll of Word of Recall", "2 Scrolls of Teleportation"] });
    expect(missingPreparation(w.view, 20).map((need) => need.reason)).toContain("Free Action");
    w.setPlayer({ objectFlags: ["SEE_INVIS", "FREE_ACT"] });
    expect(missingPreparation(w.view, 20)).toEqual([]);
    expect(missingPreparation(w.view, 21).map((need) => need.reason)).toContain("fire resistance and two other basic resistances");
  });

  it("reads a list of inspected elemental resistances and keeps missing inspection conservative", () => {
    const w = suppliedWorld({ map: ROOM, player: { maxLevel: 30, objectFlags: ["SEE_INVIS", "FREE_ACT"] }, pack: ["a Scroll of Word of Recall", "2 Scrolls of Teleportation"], inspect: () => "Provides resistance to acid, lightning, fire and cold." });
    expect(missingPreparation(w.view, 21)).toEqual([]);
    const missing = { ...w.view, inspectItem: undefined };
    expect(missingPreparation(missing, 21).map((need) => need.reason)).toContain("fire resistance and two other basic resistances");
  });

  it("makes the missing HP and supplies an acquisition aim", () => {
    const w = world({ map: ROOM, player: { level: 1, maxLevel: 1, maxHp: 20 } });
    const aim = candidateAims(w.view).find((entry) => entry.kind === "preparation");
    expect(aim?.detail).toContain("30 maximum hit points");
    expect(aim?.detail).toContain("five food units");
  });
});

describe("supply evidence and margins", () => {
  it("counts all cure grades and ignores unidentified items and exhausted torches", () => {
    const w = world({ map: ROOM, pack: ["a Potion of Cure Light Wounds", "a Potion of Cure Serious Wounds", "a Light Blue Potion", "2 Wooden Torches (0 turns)"] });
    expect(supplies(w.view)).toMatchObject({ cures: 2, fuel: 0 });
    expect(missingEssentials(w.view).map((need) => need.kind)).not.toContain("healing");
  });

  it("uses equipped light and real fuel when town reports radius zero", () => {
    const w = world({ map: ROOM, player: { depth: 0, light: 0 }, worn: ["a Wooden Torch (5000 turns)"], pack: ["2 Wooden Torches (5000 turns)", "a Flask of Oil"] });
    expect(supplies(w.view)).toMatchObject({ workingLight: true, fuel: 2 });
    expect(missingEssentials(w.view).map((need) => need.kind)).not.toContain("light");
    expect(supplyMargin(w.view)).toBeNull();
  });

  it("counts only the fuel the wielded light can use", () => {
    const torch = world({ map: ROOM, player: { depth: 0, light: 0 }, worn: ["a Wooden Torch (5000 turns)"], pack: ["2 Flasks of Oil"] });
    expect(supplies(torch.view).fuel).toBe(0);
    expect(missingEssentials(torch.view).map((need) => need.kind)).toContain("light");
    const lantern = world({ map: ROOM, player: { depth: 0, light: 0 }, worn: ["a Lantern (7500 turns)"], pack: ["2 Flasks of Oil", "a Wooden Torch (5000 turns)"] });
    expect(supplies(lantern.view)).toMatchObject({ workingLight: true, fuel: 2 });
  });

  it("does not count a burnt-out torch as working light", () => {
    const w = world({ map: ROOM, player: { depth: 0, light: 0 }, worn: ["a Wooden Torch (0 turns)"], pack: ["2 Wooden Torches (5000 turns)"] });
    expect(supplies(w.view).workingLight).toBe(false);
    expect(missingEssentials(w.view).map((need) => need.kind)).toContain("light");
  });

  it("accepts a permanent equipped light without fuel", () => {
    const w = world({ map: ROOM, player: { depth: 0, light: 0 }, worn: ["the Phial"] });
    expect(supplies(w.view)).toMatchObject({ workingLight: true, lastingLight: true, fuel: 0 });
    expect(missingEssentials(w.view).map((need) => need.kind)).not.toContain("light");
  });

  it("counts known staff charges but never guesses the charges of an unnamed or uncharged staff", () => {
    const w = world({ map: ROOM, pack: ["a Staff of Teleportation (2 charges)", "a Staff of Teleportation", "a Staff of Teleportation (0 charges)"] });
    expect(supplies(w.view).escapes).toBe(2);
  });

  it("counts reliable short escape spells separately from long escapes", () => {
    const w = world({ map: ROOM, player: { sp: 10, maxSp: 10 }, spells: [{ name: "Phase Door", sidx: 0, mana: 2, fail: 10 }, { name: "Teleport Self", sidx: 1, mana: 5, fail: 30 }] });
    expect(supplies(w.view)).toMatchObject({ phase: 2, escapes: 0 });
    w.setPlayer({ sp: 0 });
    expect(supplies(w.view).phase).toBe(0);
  });

  it("starts the shallow return at one cure, one phase, one food or one fuel", () => {
    const stock = ["2 Potions of Cure Light Wounds", "2 Scrolls of Phase Door", "2 Rations of Food", "2 Wooden Torches (5000 turns)"];
    const w = world({ map: ROOM, worn: ["a Wooden Torch (5000 turns)"], pack: stock });
    expect(supplyMargin(w.view)).toBeNull();
    for (let index = 0; index < stock.length; index += 1) {
      w.setPack(stock.map((name, at) => at === index ? name.replace(/^2 /, "1 ") : name));
      expect(supplyMargin(w.view)).not.toBeNull();
    }
  });
});
