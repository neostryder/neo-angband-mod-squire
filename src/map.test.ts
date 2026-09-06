import { describe, expect, it } from "vitest";
import { world } from "./harness.js";
import {
  frontiers,
  hasFloorObject,
  isClosedDoor,
  isKnownGround,
  isRoutable,
  isWalkable,
  knownDownStairs,
  standingOnHarm,
} from "./map.js";

describe("reading the map", () => {
  const w = world({
    map: [
      "#######",
      "#.+.~>#",
      "#.@..*#",
      "#..   #",
      "#######",
    ],
  });

  it("counts remembered, walkable, non-burning ground as ground", () => {
    expect(isKnownGround(w.view, w.terrain, { x: 1, y: 2 })).toBe(true);
    expect(isKnownGround(w.view, w.terrain, { x: 0, y: 0 })).toBe(false);
    expect(isKnownGround(w.view, w.terrain, { x: 3, y: 3 })).toBe(false);
    expect(isKnownGround(w.view, w.terrain, { x: 4, y: 1 })).toBe(false);
  });

  it("treats a remembered closed door as a door and not as ground", () => {
    expect(isClosedDoor(w.view, w.terrain, { x: 2, y: 1 })).toBe(true);
    expect(isKnownGround(w.view, w.terrain, { x: 2, y: 1 })).toBe(false);
  });

  it("routes through a door, because a shut door is not the end of the floor", () => {
    expect(isRoutable(w.view, w.terrain, { x: 2, y: 1 })).toBe(true);
    expect(isRoutable(w.view, w.terrain, { x: 0, y: 0 })).toBe(false);
  });

  it("refuses to walk into a grid a creature is standing on", () => {
    const occupied = world({
      map: ["#####", "#...#", "#.@.#", "#####"],
      monsters: [{ grid: { x: 3, y: 2 } }],
    });
    expect(isRoutable(occupied.view, occupied.terrain, { x: 3, y: 2 })).toBe(true);
    expect(isWalkable(occupied.view, occupied.terrain, { x: 3, y: 2 })).toBe(false);
    expect(isWalkable(occupied.view, occupied.terrain, { x: 1, y: 2 })).toBe(true);
  });

  it("does not read the character's own grid as occupied", () => {
    /* The view reports the engine's own -1 on the player's square, which is not
     * a creature standing in the way. */
    expect(isWalkable(w.view, w.terrain, { x: 2, y: 2 })).toBe(true);
  });

  it("knows when the character is standing on ground that burns", () => {
    const lava = world({ map: ["###", "#~#", "###"] });
    lava.moveTo({ x: 1, y: 1 });
    expect(standingOnHarm(lava.view, lava.terrain, { x: 1, y: 1 })).toBe(true);
    expect(standingOnHarm(w.view, w.terrain, { x: 2, y: 2 })).toBe(false);
  });

  it("finds the down staircases the character remembers", () => {
    expect(knownDownStairs(w.view, w.terrain)).toEqual([{ x: 5, y: 1 }]);
  });

  it("sees something lying on a grid", () => {
    expect(hasFloorObject(w.view, { x: 5, y: 2 })).toBe(true);
    expect(hasFloorObject(w.view, { x: 1, y: 2 })).toBe(false);
  });
});

describe("frontiers", () => {
  it("are remembered ground standing next to something unexplored", () => {
    const w = world({
      map: [
        "#####",
        "#...#",
        "#.@.#",
        "#..  ",
        "#####",
      ],
    });
    const found = frontiers(w.view, w.terrain).map((at) => `${String(at.x)},${String(at.y)}`);
    expect(found).toContain("2,3");
    expect(found).not.toContain("1,1");
  });

  it("do not include the edge of the map, which is not unexplored", () => {
    const w = world({ map: ["...", ".@.", "..."] });
    expect(frontiers(w.view, w.terrain)).toEqual([]);
  });

  it("are empty when everything reachable has been seen", () => {
    const w = world({ map: ["#####", "#...#", "#.@.#", "#####"] });
    expect(frontiers(w.view, w.terrain)).toEqual([]);
  });

  it("do not count unexplored space behind a remembered wall", () => {
    /* The unknown grids are there, and no remembered ground touches them, so
     * there is nothing to walk to and the floor reads as finished. */
    const w = world({
      map: [
        "#######",
        "#.@#  #",
        "#..#  #",
        "#######",
      ],
    });
    expect(frontiers(w.view, w.terrain)).toEqual([]);
  });
});
