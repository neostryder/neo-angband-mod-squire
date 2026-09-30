import { describe, expect, it } from "vitest";
import type { StoreView } from "@rpgm-tools/neo-angband-core";
import { FEAT, world } from "../harness.js";
import { readSorted } from "./read.js";
import { sortByCode } from "./sort.js";
import { bannedGoals, inStore, readBans, readHpLine, underHpLine } from "./vocab.js";

const SHOP = { feat: FEAT.GENERAL, featName: "General Store", isHome: false, owner: { name: "Bilbo", purse: 5000 }, stock: [] } as unknown as StoreView;

describe("the hit point line an instruction names", () => {
  it("reads a number, a percentage or a share, and nothing from feet, gold or levels", () => {
    expect(readHpLine("Rest when below 30 HP")).toEqual({ kind: "hp", value: 30 });
    expect(readHpLine("drink a potion if you drop below 25%")).toEqual({ kind: "share", value: 0.25 });
    expect(readHpLine("Flee when under half")).toEqual({ kind: "share", value: 0.5 });
    expect(readHpLine("run when you are under a third of your health")).toEqual({ kind: "share", value: 1 / 3 });
    expect(readHpLine("Never go below 500 ft")).toBeNull();
    expect(readHpLine("Never keep under 100 gold")).toBeNull();
    expect(readHpLine("Rest when you are wounded")).toBeNull();
  });

  it("tests hit points against the named line, and against half when none is named", () => {
    expect(underHpLine({ kind: "hp", value: 30 }, 29, 200)).toBe(true);
    expect(underHpLine({ kind: "hp", value: 30 }, 30, 200)).toBe(false);
    expect(underHpLine({ kind: "share", value: 0.25 }, 24, 100)).toBe(true);
    expect(underHpLine({ kind: "share", value: 0.25 }, 40, 100)).toBe(false);
    expect(underHpLine(undefined, 50, 100)).toBe(true);
    expect(underHpLine(undefined, 51, 100)).toBe(false);
  });

  it("is kept on the sorted form, which counts it as a hit point trigger", () => {
    const sorted = sortByCode("Rest when under 40 HP").sorted;
    expect(sorted.trigger).toBe("low-hp");
    expect(sorted.hpBelow).toEqual({ kind: "hp", value: 40 });
    expect(sortByCode("Flee when under half").sorted.trigger).toBe("low-hp");
    expect(readSorted(JSON.parse(JSON.stringify(sorted))).hpBelow).toEqual({ kind: "hp", value: 40 });
  });
});

describe("item-use bans", () => {
  it("reads the verb, the item and the condition", () => {
    expect(readBans("Never read unknown scrolls in a fight")).toEqual([{ verb: "read", item: "unknown", when: "fight" }]);
    expect(readBans("Don't quaff potions of Salt Water")).toEqual([{ verb: "quaff", item: "salt water", when: "always" }]);
    expect(readBans("never use unknown wands")).toEqual([{ verb: "aim", item: "unknown", when: "always" }]);
    expect(readBans("Do not zap rods while fighting")).toEqual([{ verb: "zap", item: null, when: "fight" }]);
    expect(readBans("Always rest when you are wounded")).toEqual([]);
  });

  it("sorts a ban as an avoid response and keeps it through a save", () => {
    const sorted = sortByCode("Never read unknown scrolls in a fight").sorted;
    expect(sorted.response).toBe("avoid");
    expect(sorted.bans).toEqual([{ verb: "read", item: "unknown", when: "fight" }]);
    expect(readSorted(JSON.parse(JSON.stringify(sorted))).bans).toEqual(sorted.bans);
  });

  it("names the offered options a ban forbids, only under its condition", () => {
    const offers = [
      { goal: "phase", criteria: "Read the unknown Scroll to see what it does." },
      { goal: "teleport", criteria: "Read a Scroll of Teleportation." },
      { goal: "heal", criteria: "Quaff a Potion of Cure Light Wounds." },
      { goal: "fight", criteria: "Attack the orc." },
    ];
    const unknownInFight = readBans("Never read unknown scrolls in a fight");
    expect(bannedGoals(unknownInFight, offers, true)).toEqual(["phase"]);
    expect(bannedGoals(unknownInFight, offers, false)).toEqual([]);
    expect(bannedGoals(readBans("never read scrolls of teleportation"), offers, false)).toEqual(["teleport"]);
    expect(bannedGoals(readBans("never quaff potions"), offers, false)).toEqual(["heal"]);
  });
});

describe("standing in a store", () => {
  it("is true on a store entrance in town and false elsewhere in town", () => {
    const w = world({ map: ["#####", "#@G.#", "#####"], player: { depth: 0 }, stores: [SHOP] });
    expect(inStore(w.view)).toBe(false);
    w.moveTo({ x: 2, y: 1 });
    expect(inStore(w.view)).toBe(true);
    w.setPlayer({ depth: 1 });
    expect(inStore(w.view)).toBe(false);
  });
});
