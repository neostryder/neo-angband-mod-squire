import { describe, expect, it } from "vitest";
import { DIRECTIONS, adjacent, directionToward, key, neighbours, steps } from "./grid.js";

describe("grid", () => {
  it("measures distance in king moves, so a diagonal costs one step", () => {
    expect(steps({ x: 0, y: 0 }, { x: 3, y: 3 })).toBe(3);
    expect(steps({ x: 0, y: 0 }, { x: 3, y: 0 })).toBe(3);
    expect(steps({ x: 5, y: 5 }, { x: 5, y: 5 })).toBe(0);
  });

  it("counts a diagonal neighbour as adjacent and a grid as not adjacent to itself", () => {
    expect(adjacent({ x: 1, y: 1 }, { x: 2, y: 2 })).toBe(true);
    expect(adjacent({ x: 1, y: 1 }, { x: 1, y: 1 })).toBe(false);
    expect(adjacent({ x: 1, y: 1 }, { x: 3, y: 1 })).toBe(false);
  });

  it("gives the keypad direction toward a grid, and null for the same grid", () => {
    expect(directionToward({ x: 5, y: 5 }, { x: 5, y: 4 })).toBe(8);
    expect(directionToward({ x: 5, y: 5 }, { x: 6, y: 6 })).toBe(3);
    expect(directionToward({ x: 5, y: 5 }, { x: 0, y: 5 })).toBe(4);
    expect(directionToward({ x: 5, y: 5 }, { x: 5, y: 5 })).toBeNull();
  });

  it("offers all eight steps, orthogonals before diagonals", () => {
    expect(DIRECTIONS).toHaveLength(8);
    expect(DIRECTIONS.slice(0, 4).map((d) => d.key)).toEqual([2, 8, 6, 4]);
    expect(new Set(DIRECTIONS.map((d) => d.key)).size).toBe(8);
    expect(DIRECTIONS.some((d) => d.key === 5)).toBe(false);
  });

  it("lists the eight neighbours in the same fixed order", () => {
    expect(neighbours({ x: 0, y: 0 })).toEqual(
      DIRECTIONS.map((d) => ({ x: d.dx, y: d.dy })),
    );
  });

  it("keys a grid uniquely", () => {
    expect(key({ x: 1, y: 2 })).toBe("1,2");
    expect(key({ x: 12, y: 3 })).not.toBe(key({ x: 1, y: 23 }));
  });
});
