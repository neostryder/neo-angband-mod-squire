import { describe, expect, it } from "vitest";
import { flowFrom, stepAway, stepDown } from "./flow.js";
import type { Loc } from "./grid.js";

/**
 * A tiny walkable rectangle, so the fields under test are readable by hand.
 * Anything outside it is wall.
 */
function box(width: number, height: number, walls: readonly string[] = []): (at: Loc) => boolean {
  const blocked = new Set(walls);
  return (at) =>
    at.x >= 0 &&
    at.y >= 0 &&
    at.x < width &&
    at.y < height &&
    !blocked.has(`${String(at.x)},${String(at.y)}`);
}

describe("flowFrom", () => {
  it("numbers every grid with its king-move distance from the nearest goal", () => {
    const field = flowFrom({ goals: [{ x: 0, y: 0 }], canEnter: box(5, 5) });
    expect(field.distance({ x: 0, y: 0 })).toBe(0);
    expect(field.distance({ x: 1, y: 1 })).toBe(1);
    expect(field.distance({ x: 4, y: 4 })).toBe(4);
    expect(field.reached).toBe(25);
  });

  it("answers for the NEAREST of several goals from one flood", () => {
    const field = flowFrom({
      goals: [
        { x: 0, y: 0 },
        { x: 9, y: 0 },
      ],
      canEnter: box(10, 1),
    });
    expect(field.distance({ x: 1, y: 0 })).toBe(1);
    expect(field.distance({ x: 8, y: 0 })).toBe(1);
    expect(field.distance({ x: 4, y: 0 })).toBe(4);
  });

  it("routes around a wall rather than through it", () => {
    /* A vertical wall at x=1 with a gap at the bottom row. */
    const walls = ["1,0", "1,1", "1,2"];
    const field = flowFrom({ goals: [{ x: 0, y: 0 }], canEnter: box(3, 4, walls) });
    /* Straight across is two grids. The real walk goes down the left side,
     * through the gap on the bottom row, and back up the right side. */
    expect(field.distance({ x: 2, y: 0 })).toBe(6);
  });

  it("reports Infinity for a grid the flood cannot reach", () => {
    const walls = ["1,0", "1,1", "1,2", "1,3"];
    const field = flowFrom({ goals: [{ x: 0, y: 0 }], canEnter: box(3, 4, walls) });
    expect(field.distance({ x: 2, y: 2 })).toBe(Number.POSITIVE_INFINITY);
  });

  it("drops a goal it cannot even stand on, rather than seeding it", () => {
    const field = flowFrom({ goals: [{ x: 9, y: 9 }], canEnter: box(3, 3) });
    expect(field.reached).toBe(0);
    expect(field.distance({ x: 0, y: 0 })).toBe(Number.POSITIVE_INFINITY);
  });

  it("stops at the limit rather than running away with the host", () => {
    const field = flowFrom({ goals: [{ x: 0, y: 0 }], canEnter: box(50, 50), limit: 20 });
    expect(field.reached).toBeLessThanOrEqual(28);
  });
});

describe("stepDown", () => {
  const anywhere = (): boolean => true;

  it("takes the step that gets closer", () => {
    const field = flowFrom({ goals: [{ x: 0, y: 0 }], canEnter: box(5, 5) });
    expect(stepDown(field, { x: 2, y: 2 }, anywhere)?.key).toBe(7);
  });

  it("refuses a sideways move, which is how an errand paces back and forth", () => {
    /* Every grid on this row is the same distance from the two goals at the
     * ends, so nothing is an improvement and the answer must be nothing. */
    const field = flowFrom({ goals: [{ x: 1, y: 0 }], canEnter: box(3, 1) });
    expect(stepDown(field, { x: 1, y: 0 }, anywhere)).toBeNull();
  });

  it("stands still when the only improving step is barred", () => {
    const field = flowFrom({ goals: [{ x: 0, y: 0 }], canEnter: box(5, 5) });
    const occupied = (at: Loc): boolean => !(at.x === 1 && at.y === 1);
    /* From (2,2) exactly one neighbour is closer to (0,0), and something is
     * standing on it. Every other neighbour is the same distance or further, so
     * there is no step that is progress. Answering null here rather than taking
     * a sideways move is what the callers turn into a stop: an errand that
     * cannot get closer has finished, one way or another. */
    expect(stepDown(field, { x: 2, y: 2 }, occupied)).toBeNull();
  });

  it("breaks a tie the same way every time", () => {
    const field = flowFrom({ goals: [{ x: 0, y: 5 }], canEnter: box(11, 11) });
    const first = stepDown(field, { x: 5, y: 5 }, anywhere);
    const again = stepDown(field, { x: 5, y: 5 }, anywhere);
    expect(first?.key).toBe(again?.key);
  });
});

describe("stepAway", () => {
  const anywhere = (): boolean => true;

  it("takes the step that gets further from the threat", () => {
    const field = flowFrom({ goals: [{ x: 0, y: 0 }], canEnter: box(5, 5) });
    /* Five neighbours are one further away; the fixed direction order settles
     * it on the first of them, which is straight down. */
    expect(stepAway(field, { x: 2, y: 2 }, anywhere)?.key).toBe(2);
  });

  it("answers nothing when there is nowhere further to go", () => {
    const field = flowFrom({ goals: [{ x: 0, y: 0 }], canEnter: box(2, 1) });
    expect(stepAway(field, { x: 1, y: 0 }, anywhere)).toBeNull();
  });
});
