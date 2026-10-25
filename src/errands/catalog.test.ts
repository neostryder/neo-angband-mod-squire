import { describe, expect, it } from "vitest";
import { ERRAND_IDS, errandMenu, isErrandId, unavailable, type ErrandId } from "./catalog.js";
import { ERRAND_TEXT } from "./text.js";
import { world, type World } from "../harness.js";

const reasons = ERRAND_TEXT.reasons;

/** A fully explored room with both staircases. */
const ROOM = [
  "#######",
  "#.@.>.#",
  "#.<...#",
  "#######",
];

/** The same room with unseen floor off to the right. */
const OPEN = [
  "#######",
  "#.@.>.,,",
  "#.<...#",
  "#######",
];

function reasonsFor(w: World): Record<ErrandId, string | null> {
  return Object.fromEntries(errandMenu(w.view, w.terrain).map((entry) => [entry.id, entry.reason])) as Record<ErrandId, string | null>;
}

describe("the errand menu", () => {
  it("lists the eight errands in a fixed order, numbered from 1", () => {
    const menu = errandMenu(world({ map: ROOM }).view, world({ map: ROOM }).terrain);
    expect(menu.map((entry) => entry.id)).toEqual(["loot", "town", "down", "up", "leave", "explore", "clear", "restock"]);
    expect(menu.map((entry) => entry.position)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(menu.map((entry) => entry.label)).toEqual(ERRAND_IDS.map((id) => ERRAND_TEXT.labels[id]));
  });

  it("recognises an errand id", () => {
    expect(isErrandId("loot")).toBe(true);
    expect(isErrandId("shop")).toBe(false);
    expect(isErrandId(3)).toBe(false);
  });

  it("in an explored dungeon room, offers the stairs, the town, leaving and clearing, but not loot, exploring or restocking", () => {
    expect(reasonsFor(world({ map: ROOM }))).toEqual({
      loot: reasons.noLoot,
      town: null,
      down: null,
      up: null,
      leave: null,
      explore: reasons.explored,
      clear: null,
      restock: reasons.notInTown,
    });
  });

  it("offers exploring while unseen ground is reachable", () => {
    expect(reasonsFor(world({ map: OPEN })).explore).toBeNull();
  });

  it("offers loot when something worth taking is known, or lies underfoot", () => {
    const known = world({ map: ["#######", "#.@..*#", "#######"], floor: [{ x: 5, y: 1, name: "a Potion of Cure Light Wounds" }] });
    expect(unavailable("loot", known.view, known.terrain)).toBeNull();
    const underfoot = world({ map: ["#######", "#.@.*.#", "#######"] });
    underfoot.moveTo({ x: 4, y: 1 });
    expect(unavailable("loot", underfoot.view, underfoot.terrain)).toBeNull();
  });

  it("does not offer the staircase the character is already standing on", () => {
    const w = world({ map: ROOM });
    w.moveTo({ x: 4, y: 1 });
    expect(reasonsFor(w).down).toBe(reasons.onDownStair);
    expect(reasonsFor(w).up).toBeNull();
    w.moveTo({ x: 2, y: 2 });
    expect(reasonsFor(w).up).toBe(reasons.onUpStair);
    expect(reasonsFor(w).down).toBeNull();
  });

  it("in town, offers restocking and the way down, and says why the rest cannot start", () => {
    const town = world({ map: ["#########", "#.@..>.G#", "#########"], player: { depth: 0 } });
    expect(reasonsFor(town)).toEqual({
      loot: reasons.noLoot,
      town: reasons.inTown,
      down: null,
      up: reasons.noUpInTown,
      leave: null,
      explore: reasons.explored,
      clear: reasons.townClear,
      restock: null,
    });
  });

  it("offers nothing once the character has died", () => {
    const w = world({ map: OPEN, player: { dead: true } });
    for (const entry of errandMenu(w.view, w.terrain)) expect(entry.reason).toBe(reasons.dead);
  });
});
