import { describe, expect, it } from "vitest";
import type { MonsterView } from "@rpgm-tools/neo-angband-core";
import { awakeInSight, engageable, inSight, pickTarget, priority } from "./threat.js";

let nextId = 1;

function monster(patch: Partial<MonsterView> & { grid: { x: number; y: number } }): MonsterView {
  return {
    id: nextId++,
    race: "kobold",
    raceIndex: 5,
    visible: true,
    hp: 10,
    maxHp: 10,
    speed: 110,
    asleep: false,
    afraid: false,
    confused: false,
    stunned: false,
    poisoned: false,
    level: 2,
    raceFlags: [],
    spellFlags: [],
    ...patch,
  } as MonsterView;
}

const HERE = { x: 10, y: 10 };
const OPEN = { wakeSleepers: false, reach: 20 };

describe("priority", () => {
  it("falls off sharply with distance, so the near creature wins", () => {
    const near = monster({ grid: { x: 11, y: 10 } });
    const far = monster({ grid: { x: 16, y: 10 } });
    expect(priority(near, HERE)).toBeGreaterThan(priority(far, HERE));
  });

  it("prefers finishing a wounded creature over starting on a fresh one", () => {
    const wounded = monster({ grid: { x: 12, y: 10 }, hp: 1, maxHp: 10 });
    const fresh = monster({ grid: { x: 12, y: 10 }, hp: 10, maxHp: 10 });
    expect(priority(wounded, HERE)).toBeGreaterThan(priority(fresh, HERE));
  });

  it("prices a fleeing creature below one that is standing its ground", () => {
    const fleeing = monster({ grid: { x: 12, y: 10 }, afraid: true });
    const standing = monster({ grid: { x: 12, y: 10 }, afraid: false });
    expect(priority(fleeing, HERE)).toBeLessThan(priority(standing, HERE));
  });

  it("prefers the weaker of two creatures at the same distance", () => {
    const weak = monster({ grid: { x: 12, y: 10 }, level: 1 });
    const strong = monster({ grid: { x: 12, y: 10 }, level: 30 });
    expect(priority(weak, HERE)).toBeGreaterThan(priority(strong, HERE));
  });

  it("lets one step of distance outweigh every other consideration", () => {
    /* The whole shape of the weights: an adjacent healthy deep creature is
     * still a better errand than a wounded weak one a step further off,
     * because the walk is the thing that costs a short errand. */
    const adjacentTough = monster({ grid: { x: 11, y: 10 }, level: 40, hp: 10, maxHp: 10 });
    const furtherEasy = monster({ grid: { x: 12, y: 10 }, level: 1, hp: 1, maxHp: 10 });
    expect(priority(adjacentTough, HERE)).toBeGreaterThan(priority(furtherEasy, HERE));
  });
});

describe("engageable", () => {
  it("refuses a creature the character cannot see", () => {
    expect(engageable(monster({ grid: { x: 11, y: 10 }, visible: false }), OPEN)).toBe(false);
  });

  it("refuses a sleeping creature unless waking them was asked for", () => {
    const sleeper = monster({ grid: { x: 11, y: 10 }, asleep: true });
    expect(engageable(sleeper, OPEN)).toBe(false);
    expect(engageable(sleeper, { ...OPEN, wakeSleepers: true })).toBe(true);
  });
});

describe("pickTarget", () => {
  it("picks the nearest engageable creature", () => {
    const far = monster({ grid: { x: 15, y: 10 } });
    const near = monster({ grid: { x: 11, y: 10 } });
    expect(pickTarget([far, near], HERE, OPEN)?.id).toBe(near.id);
  });

  it("walks past a sleeping creature to reach a waking one", () => {
    const sleeper = monster({ grid: { x: 11, y: 10 }, asleep: true });
    const awake = monster({ grid: { x: 14, y: 10 } });
    expect(pickTarget([sleeper, awake], HERE, OPEN)?.id).toBe(awake.id);
  });

  it("answers nothing when everything in sight is asleep", () => {
    const sleeper = monster({ grid: { x: 11, y: 10 }, asleep: true });
    expect(pickTarget([sleeper], HERE, OPEN)).toBeNull();
  });

  it("ignores a creature beyond the reach it was given", () => {
    const distant = monster({ grid: { x: 60, y: 10 } });
    expect(pickTarget([distant], HERE, OPEN)).toBeNull();
    expect(pickTarget([distant], HERE, { ...OPEN, reach: 100 })?.id).toBe(distant.id);
  });

  it("breaks a tie toward the lower creature id, so the choice is stable", () => {
    const first = monster({ grid: { x: 11, y: 10 } });
    const second = monster({ grid: { x: 9, y: 10 } });
    expect(pickTarget([second, first], HERE, OPEN)?.id).toBe(first.id);
    expect(pickTarget([first, second], HERE, OPEN)?.id).toBe(first.id);
  });
});

describe("in sight", () => {
  it("separates what can be seen from what is also awake", () => {
    const hidden = monster({ grid: { x: 11, y: 10 }, visible: false });
    const sleeping = monster({ grid: { x: 12, y: 10 }, asleep: true });
    const awake = monster({ grid: { x: 13, y: 10 } });
    const all = [hidden, sleeping, awake];
    expect(inSight(all).map((m) => m.id)).toEqual([sleeping.id, awake.id]);
    expect(awakeInSight(all).map((m) => m.id)).toEqual([awake.id]);
  });
});
