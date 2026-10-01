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

  const deepPack = ["a Scroll of Word of Recall", "6 Scrolls of Teleportation", "2 Potions of Healing"];
  const deepPlayer = { cls: "Warrior", depth: 44, maxLevel: 50, maxHp: 500, light: 2, speed: 130, stats: [18, 18, 18, 18, 18, 18], objectFlags: ["SEE_INVIS", "FREE_ACT", "TELEPATHY"] };
  const basicResists = "Provides resistance to acid, lightning, fire, cold and poison. Provides protection from confusion.";
  const deepResists = "Provides resistance to acid, lightning, fire, cold, poison, chaos and disenchantment. Provides protection from blindness and confusion.";

  it.each([45, 47, 98])("allows a prepared character to descend to depth %i", (depth) => {
    const w = suppliedWorld({ map: ROOM, player: deepPlayer, pack: deepPack, inspect: () => deepResists });
    expect(missingPreparation(w.view, depth)).toEqual([]);
  });

  it("starts the HP, speed and large-healing floor after depth 45", () => {
    const w = suppliedWorld({ map: ROOM, player: { ...deepPlayer, maxHp: 499, speed: 114 }, pack: deepPack.slice(0, 2), inspect: () => basicResists });
    expect(missingPreparation(w.view, 45)).toEqual([]);
    expect(missingPreparation(w.view, 47).map((need) => need.reason)).toEqual(["500 maximum hit points", "+5 speed", "large healing"]);
    w.setPlayer({ maxHp: 500, speed: 115 });
    w.setPack([...deepPack, "5 Rations of Food", "a Scroll of Phase Door"]);
    expect(missingPreparation(w.view, 47)).toEqual([]);
  });

  it("requires known deep protections, telepathy, healing and speed at depth 98", () => {
    const w = suppliedWorld({ map: ROOM, player: { ...deepPlayer, speed: 129, objectFlags: ["SEE_INVIS", "FREE_ACT"] }, pack: [...deepPack.slice(0, 2), "a Potion of Healing"], inspect: () => basicResists });
    expect(missingPreparation(w.view, 98).map((need) => need.reason)).toEqual(expect.arrayContaining(["blindness resistance", "chaos and disenchantment resistance", "telepathy", "+20 speed", "two Healing potions or one *Healing* or Life potion"]));
    const unknown = { ...w.view, inspectItem: undefined };
    expect(missingPreparation(unknown, 98).map((need) => need.reason)).toContain("chaos and disenchantment resistance");
  });

  it("requires inspection to report blindness and confusion protection", () => {
    const w = suppliedWorld({ map: ROOM, player: deepPlayer, pack: deepPack, inspect: () => "Provides resistance to acid, lightning, fire, cold, poison, chaos and disenchantment." });
    expect(missingPreparation(w.view, 98).map((need) => need.reason)).toEqual(["poison and confusion resistance", "blindness resistance"]);
  });

  it.each([[55, 115], [56, 115], [59, 115], [60, 120], [80, 120], [81, 130]] as const)("uses attainable cumulative preparation at depth %i", (depth, speed) => {
    const w = suppliedWorld({ map: ROOM, player: { ...deepPlayer, speed }, pack: [...deepPack.slice(0, 2), "a Potion of *Healing*"], inspect: () => deepResists });
    expect(missingPreparation(w.view, depth)).toEqual([]);
    w.setPlayer({ speed: speed - 1 });
    expect(missingPreparation(w.view, depth).map((need) => need.reason)).toContain(`+${String(speed - 110)} speed`);
  });

  it("requires a reachable final-depth stockpile and mana only for large mana pools", () => {
    const w = suppliedWorld({ map: ROOM, player: deepPlayer, pack: deepPack, inspect: () => deepResists });
    expect(missingPreparation(w.view, 100).map((need) => need.reason)).toEqual(["five Healing potions", "fifteen *Healing* or Life potions", "ten Speed potions"]);
    w.setPack(["5 Rations of Food", "a Scroll of Phase Door", ...deepPack.slice(0, 2), "5 Potions of Healing", "15 Potions of *Healing*", "10 Potions of Speed"]);
    expect(missingPreparation(w.view, 100)).toEqual([]);
    w.setPlayer({ maxSp: 101 });
    expect(missingPreparation(w.view, 100).map((need) => need.reason)).toEqual(["fifteen Restore Mana potions"]);
    w.setPack([...w.view.inventory().map((item) => item.label), "15 Potions of Restore Mana"]);
    expect(missingPreparation(w.view, 100)).toEqual([]);
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

  it("starts the level 1 return at one food or one fuel, and never for one cure or one Phase Door", () => {
    const stock = ["2 Potions of Cure Light Wounds", "2 Scrolls of Phase Door", "2 Rations of Food", "2 Wooden Torches (5000 turns)"];
    const w = world({ map: ROOM, player: { depth: 1 }, worn: ["a Wooden Torch (5000 turns)"], pack: stock });
    expect(supplyMargin(w.view)).toBeNull();
    for (let index = 0; index < stock.length; index += 1) {
      w.setPack(stock.map((name, at) => at === index ? name.replace(/^2 /, "1 ") : name));
      if (index < 2) expect(supplyMargin(w.view)).toBeNull();
      else expect(supplyMargin(w.view)).not.toBeNull();
    }
  });

  /* The soak's Ranger read one Phase Door on level 1 at full health and was
   * sent home by Recall, then waited for it 21 times in a row. */
  it("keeps the soak Ranger on level 1 with no cure and one Phase Door left", () => {
    const w = world({ map: ROOM, player: { cls: "Ranger", depth: 1, hp: 26, maxHp: 26 }, worn: ["a Wooden Torch (5000 turns)"], pack: ["a Scroll of Phase Door", "5 Rations of Food", "2 Wooden Torches (5000 turns)", "a Scroll of Word of Recall"] });
    expect(supplyMargin(w.view)).toBeNull();
    w.setPlayer({ depth: 2 });
    expect(supplyMargin(w.view)).toBeNull();
  });

  it.each([[3, 0, 0], [5, 0, 0], [6, 1, 1], [10, 3, 1]] as const)("starts the return at depth %i with %i cures or %i Phase Doors", (depth, cures, phase) => {
    const rest = ["5 Rations of Food", "3 Wooden Torches (5000 turns)", "4 Scrolls of Teleportation"];
    const w = world({ map: ROOM, player: { depth }, worn: ["a Wooden Torch (5000 turns)"], pack: [`${String(cures + 1)} Potions of Cure Light Wounds`, `${String(phase + 1)} Scrolls of Phase Door`, ...rest] });
    expect(supplyMargin(w.view)).toBeNull();
    w.setPack([...(cures > 0 ? [`${String(cures)} Potions of Cure Light Wounds`] : []), `${String(phase + 1)} Scrolls of Phase Door`, ...rest]);
    expect(supplyMargin(w.view)).toBe("healing");
    w.setPack([`${String(cures + 1)} Potions of Cure Light Wounds`, ...(phase > 0 ? [`${String(phase)} Scrolls of Phase Door`] : []), ...rest]);
    expect(supplyMargin(w.view)).toBe("Phase Door");
  });
});
