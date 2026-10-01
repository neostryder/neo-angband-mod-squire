import { describe, expect, it } from "vitest";
import { world } from "../harness.js";
import { canRead, readPack, studyable, unseenSources } from "./pack.js";

const ROOM = ["#####", "#.@.#", "#####"];

describe("unseen response sources", () => {
  it("uses visible names and rejects empty or charging devices and irrelevant spells", () => {
    const w = world({ map: ROOM, player: { sp: 10 },
      pack: ["a pink Potion", "a Scroll of Magic Mapping", "a Rod of Detection (charging)", "a Staff of Detect Evil (0 charges)", "a Rod of Detection (5 turns)", "a Scroll of Detect Invisible"],
      spells: [{ name: "Treasure Detection", sidx: 1 }, { name: "Object Detection", sidx: 2 }, { name: "Spear of Light", sidx: 3 }] });
    expect(unseenSources(w.view, "detect")).toEqual([{ how: "read", handle: 6, name: "a Scroll of Detect Invisible" }]);
    expect(unseenSources(w.view, "see_invisible")).toEqual([]);
    expect(unseenSources(w.view, "light_room")).toEqual([]);
  });

  it.each([{ blind: 1 }, { confused: 1 }])("keeps potions and rods when reading is refused: %j", (status) => {
    const w = world({ map: ROOM, player: { status, sp: 5 }, pack: ["a Scroll of Detect Invisible", "a Rod of Detection", "a Potion of See Invisible"],
      spells: [{ name: "Detect Monsters", sidx: 1 }] });
    expect(unseenSources(w.view, "detect").map((source) => source.how)).toEqual(["rod"]);
    expect(unseenSources(w.view, "see_invisible").map((source) => source.how)).toEqual(["quaff"]);
  });

  it("rejects spells that the current inspection refuses", () => {
    const w = world({ map: ROOM, player: { sp: 5 }, spells: [{ name: "Detect Monsters", sidx: 1 }] });
    Object.assign(w.view, { spellInfo: () => ({ canCastNow: false, mana: 1, failChance: 0, description: "Detects monsters." }) });
    expect(unseenSources(w.view, "detect")).toEqual([]);
  });

  it("requires a known activation effect rather than a passive property", () => {
    const w = world({ map: ROOM, pack: ["a seeing stone"], activations: ["a seeing stone"], inspect: () => "It lets you see invisible creatures. When activated, it shoots fire." });
    expect(unseenSources(w.view, "see_invisible")).toEqual([]);
    const ready = world({ map: ROOM, pack: ["a seeing stone"], activations: ["a seeing stone"], inspect: () => "When activated, it lets you see invisible creatures." });
    expect(unseenSources(ready.view, "see_invisible")).toMatchObject([{ how: "activate", handle: 1 }]);
  });
});

describe("studyable", () => {
  const spells = [{ name: "Magic Missile", sidx: 0, learned: false }, { name: "Detect Monsters", sidx: 1, learned: false }];

  it("offers the next unlearned spell in a carried book", () => {
    const w = world({ map: ROOM, pack: ["a Magic for Beginners"], spells });
    expect(studyable(w.view)?.sidx).toBe(0);
  });

  it("offers nothing more at a level where a study was refused", () => {
    const w = world({ map: ROOM, pack: ["a Magic for Beginners"], spells });
    expect(studyable(w.view, new Set(["5:0"]))).toBeNull();
    expect(studyable(w.view, new Set(["4:0"]))?.sidx).toBe(0);
  });
});

describe("readPack missiles", () => {
  it("keeps only the ammunition the equipped launcher fires", () => {
    const bow = world({ map: ROOM, pack: ["20 Arrows", "12 Iron Shots"], worn: ["a Short Bow (x2) (+0,+0)"] });
    expect(readPack(bow.view).ammo.map((a) => a.name)).toEqual(["20 Arrows"]);
    const sling = world({ map: ROOM, pack: ["20 Arrows"], worn: ["a Sling (x2) (+0,+0)"] });
    expect(readPack(sling.view).ammo).toEqual([]);
    expect(readPack(sling.view).launcher).toBe(true);
  });
});

describe("reading in the dark", () => {
  it("cannot read or cast on a dark grid, as the game refuses both there", () => {
    const map = ["#####", "#.@.#", "#####"];
    expect(canRead(world({ map, player: { light: 2 } }).view)).toBe(true);
    expect(canRead(world({ map, player: { light: 0 } }).view)).toBe(false);
    expect(canRead(world({ map, player: { light: 0, classFlags: ["UNLIGHT"] } as never }).view)).toBe(true);
  });
});
