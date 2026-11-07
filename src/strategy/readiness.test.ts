import type { AgentView } from "@rpgm-tools/neo-angband-core";
import { describe, expect, it } from "vitest";
import { suppliedWorld, world } from "../harness.js";
import { candidateAims } from "./aims.js";
import { basketWants, descentPolicy, descentGaps, descentWait, gapFacts, missingEssentials, missingPreparation, readinessThreshold, supplies, supplyMargin, shallowDiveReady } from "./readiness.js";
import { archetype, defaultPersona } from "../persona/persona.js";

const ROOM = ["#####", "#<@>#", "#####"];

describe("arrival supply consistency", () => {
  it.each(["Warrior", "Blackguard", "Rogue", "Priest", "Druid", "Paladin", "Ranger", "Mage", "Necromancer"])("lets a prepared %s stay on DL6 and DL10", (cls) => {
    for (const depth of [6, 10]) {
      const w = suppliedWorld({ map: ROOM, player: { cls, depth: depth - 1, level: 30, maxLevel: 30, hp: 100, maxHp: 100, light: 2, objectFlags: ["SEE_INVIS"] }, pack: ["3 Potions of Cure Critical Wounds", "2 Scrolls of Teleportation", "a Scroll of Word of Recall"] });
      expect(missingPreparation(w.view, depth)).toEqual([]);
      w.setPlayer({ depth });
      expect(supplyMargin(w.view)).toBeNull();
      w.setPack(["5 Rations of Food", "2 Wooden Torches (5000 turns)", "3 Potions of Cure Critical Wounds", "3 Scrolls of Phase Door", "a Scroll of Teleportation"]);
      expect(supplyMargin(w.view)).toBeNull();
    }
  });

  it.each(["Warrior", "Necromancer"])("keeps a shallow %s above the DL5 return floors", (cls) => {
    const w = world({ map: ROOM, player: { cls, classFlags: cls === "Necromancer" ? ["UNLIGHT"] : [], depth: 4, level: 4, maxLevel: 4, hp: 40, maxHp: 40 }, worn: ["a Wooden Torch (5000 turns)"], pack: ["5 Flasks of Oil", "4 Rations of Food", "2 Wooden Torches (5000 turns)", "2 Potions of Cure Light Wounds", "a Scroll of Phase Door"] });
    expect(missingPreparation(w.view, 5, null, 0, true)).toEqual([]);
    w.setPlayer({ depth: 5 });
    expect(supplyMargin(w.view)).toBeNull();
    w.setPlayer({ depth: 4 });
    w.setPack(["5 Flasks of Oil", "4 Rations of Food", "2 Wooden Torches (5000 turns)", "2 Potions of Cure Light Wounds"]);
    expect(shallowDiveReady(w.view)).toBe(false);
    w.setPack(["5 Flasks of Oil", "3 Rations of Food", "2 Wooden Torches (5000 turns)", "2 Potions of Cure Light Wounds"]);
    expect(missingPreparation(w.view, 5, null, 0, true).length).toBeGreaterThan(0);
    w.setPack(["5 Flasks of Oil", "4 Rations of Food", "2 Wooden Torches (5000 turns)"]);
    expect(missingPreparation(w.view, 5, null, 0, true).length).toBeGreaterThan(0);
  });
});

describe("descent pace", () => {
  it.each([
    [2, 10, 10, 1, 1, 1], [3, 16, 15, 1, 1, 1], [4, 22, 20, 2, 2, 2],
    [5, 28, 25, 2, 2, 2], [6, 34, 30, 3, 3, 3], [7, 40, 35, 4, 4, 4],
    [8, 46, 40, 4, 4, 4], [9, 52, 45, 5, 5, 5], [10, 58, 50, 6, 6, 6],
  ])("applies growing kit-based HP and level floors for DL%i", (depth, warriorHp, mageHp, warriorLevel, mageLevel, pacedLevel) => {
    const persona = defaultPersona();
    for (const [cls, hp, normal] of [["Warrior", warriorHp, warriorLevel], ["Mage", mageHp, mageLevel]] as const) {
      const w = suppliedWorld({ map: ROOM, player: { cls, depth: depth - 1, level: pacedLevel, maxLevel: pacedLevel, hp, maxHp: hp, light: 2, objectFlags: ["SEE_INVIS"] }, pack: ["5 Flasks of Oil", "a Scroll of Word of Recall", "3 Potions of Cure Critical Wounds", "2 Scrolls of Teleportation"] });
      const wait = descentWait(persona);
      expect(missingPreparation(w.view, depth, persona, wait)).toEqual([]);
      const before = missingPreparation(w.view, depth, persona, wait - 0.01).filter((gap) => gap.kind === "level");
      expect(before.map((gap) => gap.reason)).toEqual(normal > pacedLevel ? [`maximum character level ${String(normal)}`] : []);
      w.setPlayer({ hp: hp - 1, maxHp: hp - 1 });
      expect(descentGaps(w.view, depth, persona, wait).hard.some((gap) => gap.kind === "hp")).toBe(true);
      w.setPlayer({ hp, maxHp: hp, maxLevel: pacedLevel - 1 });
      expect(descentGaps(w.view, depth, persona, wait).hard.map((gap) => gap.kind)).toContain("level");
    }
  });

  it("uses ambition to shorten the wait without changing the HP floor", () => {
    expect(descentWait(archetype("diver"))).toBeLessThan(descentWait(archetype("coward")));
    expect(descentWait(defaultPersona())).toBeCloseTo(1);
  });

  it.each(["poison", "cut", "escapes", "ranged"])("retains %s preparation when a shallow caster waits", (gap) => {
    const w = suppliedWorld({ map: ROOM, player: { cls: "Mage", depth: 1, level: 1, maxLevel: 1, hp: 13, maxHp: 13 }, pack: ["5 Flasks of Oil"] });
    if (gap === "poison") w.setPlayer({ status: { poisoned: 1 } });
    if (gap === "cut") w.setPlayer({ status: { cut: 1 } });
    if (gap === "escapes") w.setPack(["5 Flasks of Oil", "3 Potions of Cure Light Wounds", "5 Rations of Food"]);
    if (gap === "ranged") w.setPack(["3 Potions of Cure Light Wounds", "3 Scrolls of Phase Door", "5 Rations of Food"]);
    expect(missingPreparation(w.view, 2, null, 30).length).toBeGreaterThan(0);
  });

  it("admits a level 1 character with oil, a cure and an escape without waiting on DL1", () => {
    const w = suppliedWorld({ map: ROOM, player: { cls: "Warrior", depth: 1, level: 1, maxLevel: 1, hp: 13, maxHp: 13 }, pack: ["5 Flasks of Oil"] });
    expect(missingPreparation(w.view, 2)).toEqual([]);
  });
});

describe("prepared depths", () => {
  it("lowers the early readiness bar during an XP drought and retains a survival minimum", () => {
    const bold = archetype("berserker");
    const cautious = archetype("coward");
    expect(readinessThreshold(null, 2, 500)).toBeLessThan(readinessThreshold(null, 2));
    expect(readinessThreshold(bold, 2, 100000)).toBeGreaterThanOrEqual(0.2);
    expect(readinessThreshold(cautious, 2, 100000)).toBeGreaterThan(readinessThreshold(bold, 2, 100000));
    expect(readinessThreshold(null, 5, 100000)).toBe(readinessThreshold(null, 5));
  });

  it("scales depth 3 class floors with drive and admits a healthy level 4 Rogue", () => {
    const w = suppliedWorld({ map: ROOM, player: { cls: "Rogue", depth: 2, level: 4, maxLevel: 4, hp: 65, maxHp: 65 } });
    expect(missingPreparation(w.view, 3)).toEqual([]);
    expect(missingPreparation(w.view, 3, archetype("berserker"))).toEqual([]);
    expect(missingPreparation(w.view, 3, archetype("coward")).some((gap) => gap.kind === "level")).toBe(true);
  });

  it.each([2, 3])("keeps a level floor for the level 1 Warrior at depth %i", (depth) => {
    const w = suppliedWorld({ map: ROOM, player: { cls: "Warrior", level: 1, maxLevel: 1, hp: 20, maxHp: 20 } });
    expect(missingPreparation(w.view, depth).map((need) => need.kind)).toEqual(["level"]);
  });

  it("opens depth 2 at the survival floor, maximum level 3, light and five food units", () => {
    const w = suppliedWorld({ map: ROOM, player: { level: 3, maxLevel: 3, hp: 30, maxHp: 30, light: 1 } });
    expect(missingPreparation(w.view, 2)).toEqual([]);
    w.setPack(["a Ration of Food"]);
    expect(missingPreparation(w.view, 2).map((need) => need.kind)).toContain("food");
  });

  it.each([
    ["Warrior", 10], ["Blackguard", 10], ["Rogue", 10], ["Priest", 10],
    ["Druid", 10], ["Paladin", 10], ["Ranger", 10], ["Mage", 10], ["Necromancer", 10],
  ] as const)("opens depth 2 for %s at its attainable early HP floor", (cls, maxHp) => {
    const w = suppliedWorld({ map: ROOM, player: { cls, level: 3, maxLevel: 3, hp: maxHp, maxHp }, pack: ["5 Flasks of Oil"] });
    expect(missingPreparation(w.view, 2)).toEqual([]);
    w.setPlayer({ maxHp: maxHp - 1 });
    expect(missingPreparation(w.view, 2).map((gap) => gap.kind)).toEqual(["hp"]);
  });

  it("scales the early HP floor with persona drive while keeping food and light mandatory", () => {
    const w = suppliedWorld({ map: ROOM, player: { cls: "Mage", level: 3, maxLevel: 3, hp: 20, maxHp: 20 }, pack: ["5 Flasks of Oil"] });
    expect(missingPreparation(w.view, 2, archetype("berserker"))).toEqual([]);
    expect(missingPreparation(w.view, 2, archetype("coward")).map((gap) => gap.kind)).toEqual(["hp"]);
    w.setPack([]);
    expect(descentGaps(w.view, 2, archetype("berserker")).hard.map((gap) => gap.kind)).toContain("food");
  });

  it.each([
    ["Warrior", 16, 1], ["Blackguard", 16, 1], ["Rogue", 15, 1],
    ["Priest", 15, 1], ["Druid", 15, 1], ["Paladin", 16, 1],
    ["Ranger", 16, 1], ["Mage", 15, 1], ["Necromancer", 15, 1],
  ] as const)("uses the depth 3 class floor for %s", (cls, maxHp, maxLevel) => {
    const w = suppliedWorld({ map: ROOM, player: { cls, level: 1, maxLevel, maxHp, hp: maxHp }, pack: ["5 Flasks of Oil"] });
    expect(missingPreparation(w.view, 3)).toEqual([]);
    w.setPlayer({ maxHp: maxHp - 1 });
    expect(missingPreparation(w.view, 3).map((need) => need.kind)).toContain("hp");
    w.setPlayer({ maxHp, maxLevel: maxLevel - 1 });
    expect(missingPreparation(w.view, 3).map((need) => need.kind)).toContain("level");
  });

  it.each([
    ["Warrior", 28, 2], ["Blackguard", 28, 2], ["Rogue", 25, 2],
    ["Priest", 25, 2], ["Druid", 25, 2], ["Paladin", 28, 2],
    ["Ranger", 28, 2], ["Mage", 25, 2], ["Necromancer", 25, 2],
  ] as const)("uses the dungeon depth 5 class floor for %s", (cls, maxHp, maxLevel) => {
    const w = suppliedWorld({ map: ROOM, player: { cls, depth: 4, maxLevel, maxHp, hp: maxHp }, pack: ["a Scroll of Word of Recall", "5 Flasks of Oil"] });
    expect(missingPreparation(w.view, 5)).toEqual([]);
    w.setPlayer({ maxHp: maxHp - 1 });
    expect(missingPreparation(w.view, 5).map((need) => need.kind)).toContain("hp");
    w.setPlayer({ maxHp, maxLevel: maxLevel - 1 });
    expect(missingPreparation(w.view, 5).map((need) => need.kind)).toContain("level");
  });

  it("uses usable cures and escapes through DL10 without demanding deep equipment", () => {
    const w = suppliedWorld({ map: ROOM, player: { level: 8, maxLevel: 8, depth: 9, hp: 60, maxHp: 60 }, pack: ["5 Flasks of Oil"] });
    expect(missingPreparation(w.view, 10)).toEqual([]);
    w.setPack(["5 Flasks of Oil", "5 Rations of Food", "3 Potions of Cure Light Wounds"]);
    expect(missingPreparation(w.view, 10).map((gap) => gap.kind)).toContain("phase");
  });

  it("never treats mapping or detection of objects as invisible detection at deeper destinations", () => {
    const w = suppliedWorld({ map: ROOM, player: { maxLevel: 20 }, pack: ["a Scroll of Magic Mapping", "a Rod of Treasure Location"] });
    expect(missingPreparation(w.view, 11).map((need) => need.kind)).toContain("protection");
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
    const missing: AgentView = { ...w.view };
    delete missing.inspectItem;
    expect(missingPreparation(missing, 21).map((need) => need.reason)).toContain("fire resistance and two other basic resistances");
  });

  it("makes the missing HP and supplies an acquisition aim", () => {
    const w = world({ map: ROOM, player: { level: 1, maxLevel: 1, maxHp: 18 } });
    const aim = candidateAims(w.view).find((entry) => entry.kind === "preparation");
    expect(aim?.detail).toContain("maximum character level 3");
    expect(aim?.detail).toContain("2 food units");
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

  it("counts race and class protection from blindness and confusion beside worn items", () => {
    const resists = "Provides resistance to acid, lightning, fire, cold, poison, chaos and disenchantment.";
    const w = suppliedWorld({ map: ROOM, player: deepPlayer, pack: deepPack, inspect: () => resists });
    expect(missingPreparation(w.view, 60).map((need) => need.reason)).toEqual(["poison and confusion resistance", "blindness resistance"]);
    w.setPlayer({ objectFlags: [...deepPlayer.objectFlags, "PROT_BLIND", "PROT_CONF"] });
    expect(missingPreparation(w.view, 60)).toEqual([]);
  });

  it("requires known deep protections, telepathy, healing and speed at depth 98", () => {
    const w = suppliedWorld({ map: ROOM, player: { ...deepPlayer, speed: 129, objectFlags: ["SEE_INVIS", "FREE_ACT"] }, pack: [...deepPack.slice(0, 2), "a Potion of Healing"], inspect: () => basicResists });
    expect(missingPreparation(w.view, 98).map((need) => need.reason)).toEqual(expect.arrayContaining(["blindness resistance", "chaos and disenchantment resistance", "telepathy", "+20 speed", "two Healing potions or one *Healing* or Life potion"]));
    const unknown: AgentView = { ...w.view };
    delete unknown.inspectItem;
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
    expect(missingPreparation(w.view, 100).map((need) => need.reason)).toEqual(["5 Healing potions", "15 *Healing* or Life potions", "10 Speed potions"]);
    w.setPack(["5 Rations of Food", "a Scroll of Phase Door", ...deepPack.slice(0, 2), "5 Potions of Healing", "15 Potions of *Healing*", "10 Potions of Speed"]);
    expect(missingPreparation(w.view, 100)).toEqual([]);
    w.setPlayer({ maxSp: 101 });
    expect(missingPreparation(w.view, 100).map((need) => need.reason)).toEqual(["15 Restore Mana potions"]);
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

  it("never sends a character home from level 1 with the basket the town just filled, whatever the persona", () => {
    for (const persona of [archetype("berserker"), null, archetype("tourist")]) {
      const w = world({ map: ROOM, player: { depth: 0, light: 1 }, worn: ["a Wooden Torch (5000 turns)"] });
      const want = basketWants(persona);
      w.setPack([`${String(want.healing)} Potions of Cure Light Wounds`, `${String(want.phase)} Scrolls of Phase Door`, `${String(want.food)} Rations of Food`, `${String(want.light)} Wooden Torches (5000 turns)`]);
      expect(missingEssentials(w.view, persona)).toEqual([]);
      w.setPlayer({ depth: 1 });
      expect(supplyMargin(w.view, persona)).toBeNull();
    }
  });

  it("keeps one cure, escape and spare fuel, and returns when food falls below the persona floor", () => {
    const stock = ["2 Potions of Cure Light Wounds", "2 Scrolls of Phase Door", "2 Rations of Food", "2 Wooden Torches (5000 turns)"];
    const w = world({ map: ROOM, player: { depth: 1 }, worn: ["a Wooden Torch (5000 turns)"], pack: stock });
    expect(supplyMargin(w.view)).toBeNull();
    for (let index = 0; index < stock.length; index += 1) {
      w.setPack(stock.map((name, at) => at === index ? name.replace(/^2 /, "1 ") : name));
      if (index === 2) expect(supplyMargin(w.view)).not.toBeNull();
      else expect(supplyMargin(w.view)).toBeNull();
    }
  });

  /* The soak's Ranger read one Phase Door on level 1 at full health and was
   * sent home by Recall, then waited for it 21 times in a row. */
  it("returns the shallow Ranger before its last Phase Door is its only defence", () => {
    const w = world({ map: ROOM, player: { cls: "Ranger", depth: 1, hp: 26, maxHp: 26 }, worn: ["a Wooden Torch (5000 turns)"], pack: ["a Scroll of Phase Door", "5 Rations of Food", "2 Wooden Torches (5000 turns)", "a Scroll of Word of Recall"] });
    expect(supplyMargin(w.view)).toBe("healing and Phase Door");
    w.setPlayer({ depth: 2 });
    expect(supplyMargin(w.view)).toBe("healing and Phase Door");
  });

  it.each([[3, 0, 0], [5, 0, 0], [6, 0, 0], [10, 0, 0]] as const)("starts the return at depth %i with %i cures or %i Phase Doors", (depth, cures, phase) => {
    const rest = ["5 Rations of Food", "3 Wooden Torches (5000 turns)", "4 Scrolls of Teleportation"];
    const w = world({ map: ROOM, player: { depth }, worn: ["a Wooden Torch (5000 turns)"], pack: [`${String(cures + 1)} Potions of Cure Light Wounds`, `${String(phase + 1)} Scrolls of Phase Door`, ...rest] });
    expect(supplyMargin(w.view)).toBeNull();
    w.setPack([...(cures > 0 ? [`${String(cures)} Potions of Cure Light Wounds`] : []), `${String(phase + 1)} Scrolls of Phase Door`, ...rest]);
    expect(supplyMargin(w.view)).toBe("healing");
    w.setPack([`${String(cures + 1)} Potions of Cure Light Wounds`, ...(phase > 0 ? [`${String(phase)} Scrolls of Phase Door`] : []), ...rest]);
    expect(supplyMargin(w.view)).toBeNull();
  });
});

describe("descent gaps", () => {
  it.each(["Mage", "Necromancer"])("requires an affordable ranged attack for a fragile %s", (cls) => {
    const w = suppliedWorld({ map: ROOM, player: { cls, depth: 1, level: 1, maxLevel: 1, hp: 13, maxHp: 13 } });
    expect(descentGaps(w.view, 2).hard.map((gap) => gap.kind)).toContain("protection");
    w.setPack(["5 Flasks of Oil", "5 Rations of Food", "3 Potions of Cure Light Wounds", "a Scroll of Phase Door"]);
    expect(descentGaps(w.view, 2).hard).toEqual([]);
  });

  it("raises capacity with destination depth while admitting DL2 immediately", () => {
    const w = suppliedWorld({ map: ROOM, player: { depth: 1, level: 1, maxLevel: 1, hp: 13, maxHp: 13 }, pack: ["5 Flasks of Oil"] });
    expect(descentGaps(w.view, 2).hard).toEqual([]);
    expect(descentGaps(w.view, 4).hard.map((gap) => gap.kind)).toContain("level");
    expect(descentGaps(w.view, 4).hard.map((gap) => gap.kind)).toContain("hp");
  });

  it("keeps light and food outside the readiness answer", () => {
    const w = suppliedWorld({ map: ROOM, player: { depth: 1, light: 0 } });
    w.setPack(["5 Flasks of Oil"]);
    expect(descentGaps(w.view, 2).hard.map((gap) => gap.kind)).toEqual(["light", "food"]);
  });

  it("states the next depth's preparation and its improvement", () => {
    const w = suppliedWorld({ map: ROOM, player: { depth: 1, level: 1, maxLevel: 1, hp: 30, maxHp: 30 } });
    expect(gapFacts(w.view)).toContain("maximum character level 3");
    w.setPack(["5 Flasks of Oil", "5 Rations of Food", "a Potion of Cure Light Wounds", "a Scroll of Phase Door"]);
    expect(gapFacts(w.view)).toBe("The character is prepared for dungeon level 2 (shallow).");
    w.setPlayer({ depth: 0 });
    expect(gapFacts(w.view)).toBeUndefined();
  });

  it("asks a cautious persona to be surer than a driven one, within bounds", () => {
    const [coward, plain, berserker] = [readinessThreshold(archetype("coward")), readinessThreshold(null), readinessThreshold(archetype("berserker"))];
    expect(coward).toBeGreaterThan(plain);
    expect(plain).toBeGreaterThan(berserker);
    expect(Math.min(coward, plain, berserker)).toBeGreaterThanOrEqual(0.3);
    expect(Math.max(coward, plain, berserker)).toBeLessThanOrEqual(0.85);
  });
});

describe("persona descent preparation", () => {
  it.each(["Warrior", "Blackguard", "Rogue", "Priest", "Druid", "Paladin", "Ranger", "Mage", "Necromancer"])("uses the same situation to distinguish timid, default, bold and careless %s characters", (cls) => {
    const w = suppliedWorld({ map: ROOM, player: { cls, depth: 1, level: 1, maxLevel: 1, hp: 13, maxHp: 13 }, pack: ["5 Flasks of Oil"] });
    const timid = archetype("coward");
    const normal = defaultPersona();
    const bold = archetype("diver");
    const careless = defaultPersona();
    careless.sliders.impulsiveness = 100;
    careless.sliders.selfpreservation = 0;
    careless.sliders.patience = 0;
    careless.quirks.forgetful = { on: true, strength: 100 };
    expect(shallowDiveReady(w.view, 2, timid)).toBe(false);
    expect(shallowDiveReady(w.view, 2, normal)).toBe(true);
    expect(shallowDiveReady(w.view, 2, bold)).toBe(true);
    expect(shallowDiveReady(w.view, 2, careless)).toBe(true);
    expect(descentPolicy(timid).risk).toBeLessThan(descentPolicy(normal).risk);
    expect(descentPolicy(normal).risk).toBeLessThan(descentPolicy(bold).risk);
    expect(descentPolicy(bold).risk).toBeLessThan(descentPolicy(careless).risk);
    w.setPack(["5 Flasks of Oil", "2 Rations of Food", "a Wooden Torch (5000 turns)"]);
    expect(missingPreparation(w.view, 2, normal).length).toBeGreaterThan(0);
    expect(missingPreparation(w.view, 2, careless)).toEqual([]);
  });

  it.each(["poison", "cut", "blind", "confused", "afraid"])("keeps %s out of planned descent for every persona", (status) => {
    const w = suppliedWorld({ map: ROOM, player: { depth: 1, status: { [status === "poison" ? "poisoned" : status]: 1 } }, pack: ["5 Flasks of Oil"] });
    for (const persona of [null, archetype("coward"), archetype("diver")]) expect(shallowDiveReady(w.view, 2, persona)).toBe(false);
  });
});

describe("shallow dives without gold", () => {
  it.each([1, 2, 3])("requires training and reserves at a seen staircase on DL%i", (depth) => {
    const w = world({ map: ROOM, player: { cls: "Warrior", depth, level: 1, maxLevel: 1, hp: 36, maxHp: 36 }, worn: ["a Wooden Torch (5000 turns)"], pack: ["5 Flasks of Oil", "5 Rations of Food", "a Wooden Torch (5000 turns)"] });
    expect(missingPreparation(w.view, depth + 1, null, 0, true).some((gap) => gap.kind === "level")).toBe(depth === 3);
    w.setPlayer({ level: 4, maxLevel: 4 });
    expect(shallowDiveReady(w.view)).toBe(false);
    w.setPack(["5 Flasks of Oil", "5 Rations of Food", "a Wooden Torch (5000 turns)", "2 Potions of Cure Light Wounds", "a Scroll of Phase Door"]);
    expect(missingPreparation(w.view, depth + 1, null, 0, true)).toEqual([]);
    w.setPlayer({ hp: 28 });
    expect(shallowDiveReady(w.view)).toBe(false);
  });

  it.each(["oil", "spell", "launcher"])("accepts a usable %s attack", (attack) => {
    const w = world({ map: ROOM, player: { cls: "Mage", depth: 1, level: 4, maxLevel: 4, hp: 12, maxHp: 12, sp: 1, maxSp: 1 }, worn: ["a Wooden Torch (5000 turns)", ...(attack === "launcher" ? ["a Short Bow"] : [])], spells: attack === "spell" ? [{ name: "Magic Missile", sidx: 0, mana: 1 }] : [], pack: ["2 Potions of Cure Light Wounds", "a Scroll of Phase Door", "5 Rations of Food", "a Wooden Torch (5000 turns)", ...(attack === "oil" ? ["5 Flasks of Oil"] : attack === "launcher" ? ["5 Arrows"] : [])] });
    expect(missingPreparation(w.view, 2, null, 0, true)).toEqual([]);
    if (attack === "spell") w.setPlayer({ sp: 0 });
    else w.setPack(["2 Potions of Cure Light Wounds", "5 Rations of Food", "a Wooden Torch (5000 turns)", attack === "oil" ? "a Flask of Oil" : "5 Bolts"]);
    expect(missingPreparation(w.view, 2, null, 0, true).length).toBeGreaterThan(0);
  });

  it.each(["hp", "food", "fuel", "poison", "deep"])("retains the %s limit", (gap) => {
    const w = world({ map: ROOM, player: { cls: "Mage", depth: gap === "deep" ? 5 : 1, level: 4, maxLevel: 4, hp: gap === "hp" ? 11 : 12, maxHp: gap === "hp" ? 11 : 12, status: { poisoned: gap === "poison" ? 1 : 0 } }, worn: ["a Wooden Torch (5000 turns)"], pack: ["2 Potions of Cure Light Wounds", "5 Flasks of Oil", gap === "food" ? "a Ration of Food" : "5 Rations of Food", ...(gap === "fuel" ? [] : ["a Wooden Torch (5000 turns)"])] });
    expect(missingPreparation(w.view, w.view.player().depth + 1, null, 0, true).length).toBeGreaterThan(0);
  });
});

it.each([["Warrior", 10], ["Rogue", 10], ["Priest", 10], ["Mage", 10]] as const)("keeps the relaxed DL2 HP floor for %s", (cls, hp) => {
  const w = world({ map: ROOM, player: { cls, depth: 1, level: 4, maxLevel: 4, hp, maxHp: hp }, worn: ["a Wooden Torch (5000 turns)"], pack: ["2 Potions of Cure Light Wounds", "a Scroll of Phase Door", "5 Flasks of Oil", "5 Rations of Food", "a Wooden Torch (5000 turns)"] });
  expect(missingPreparation(w.view, 2, null, 0, true)).toEqual([]);
  w.setPlayer({ hp: hp - 1, maxHp: hp - 1 });
  expect(missingPreparation(w.view, 2, null, 0, true).length).toBeGreaterThan(0);
});

describe("shallow Necromancer preparation", () => {
  it.each([1, 2, 3])("accepts UNLIGHT, Nether Bolt, two rations and 80 percent HP on DL%i", (depth) => {
    const w = world({ map: ROOM, player: { cls: "Necromancer", classFlags: ["UNLIGHT"], light: 0, depth, level: 4, maxLevel: 4, hp: 32, maxHp: 40, sp: 1, maxSp: 1 }, spells: [{ name: "Nether Bolt", sidx: 0, mana: 1 }, { name: "Phase Door", sidx: 1, mana: 0, fail: 0 }], pack: ["2 Rations of Food", "2 Potions of Cure Light Wounds"] });
    expect(supplies(w.view)).toMatchObject({ lastingLight: true, workingLight: false, food: 2 });
    expect(missingPreparation(w.view, depth + 1, null, 0, true)).toEqual([]);
    expect(missingPreparation(w.view, depth + 1).some((gap) => gap.kind === "light")).toBe(false);
    w.setPlayer({ hp: 31 });
    expect(shallowDiveReady(w.view)).toBe(false);
  });

  it.each(["mana", "food", "hunger", "light"])("retains the %s guard for a shallow caster", (gap) => {
    const w = world({ map: ROOM, player: { cls: "Necromancer", classFlags: gap === "light" ? [] : ["UNLIGHT"], light: 0, depth: 1, level: 4, maxLevel: 4, hp: 20, maxHp: 20, sp: gap === "mana" ? 0 : 1, maxSp: 1, status: { food: gap === "hunger" ? 1 : 5000 } }, spells: [{ name: "Nether Bolt", sidx: 0, mana: 1 }, { name: "Phase Door", sidx: 1, mana: 0, fail: 0 }], pack: ["2 Potions of Cure Light Wounds", gap === "food" ? "a Ration of Food" : "2 Rations of Food"] });
    expect(missingPreparation(w.view, 2, null, 0, true).length).toBeGreaterThan(0);
  });
});
