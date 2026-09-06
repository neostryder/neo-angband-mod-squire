import { describe, expect, it } from "vitest";
import { createWatcher, type WatchOptions } from "./disturb.js";
import { world } from "./harness.js";

const ROOM = ["#####", "#...#", "#.@.#", "#...#", "#####"];

const WATCH: WatchOptions = {
  stopOnAnyDamage: true,
  stopOnNewCreature: true,
  stopOnLowHealth: true,
  retreatFraction: 0.5,
};

describe("createWatcher", () => {
  it("reports nothing when nothing has changed", () => {
    const w = world({ map: ROOM });
    const watcher = createWatcher(w.view, WATCH);
    expect(watcher.check(w.view)).toBeNull();
  });

  it("does not stop for what was already in sight at handover", () => {
    const w = world({ map: ROOM, monsters: [{ grid: { x: 1, y: 1 } }] });
    const watcher = createWatcher(w.view, WATCH);
    expect(watcher.check(w.view)).toBeNull();
    expect(watcher.known.has(1)).toBe(true);
  });

  it("stops when a creature that was not there comes into view", () => {
    const w = world({ map: ROOM });
    const watcher = createWatcher(w.view, WATCH);
    w.setMonsters([{ grid: { x: 1, y: 1 }, race: "cave spider" }]);
    const stop = watcher.check(w.view);
    expect(stop?.reason).toBe("creature-appeared");
    expect(stop?.detail).toContain("cave spider");
  });

  it("stops only once for the same creature", () => {
    const w = world({ map: ROOM });
    const watcher = createWatcher(w.view, WATCH);
    w.setMonsters([{ grid: { x: 1, y: 1 } }]);
    expect(watcher.check(w.view)?.reason).toBe("creature-appeared");
    expect(watcher.check(w.view)).toBeNull();
  });

  it("ignores a new creature when the player switched that off", () => {
    const w = world({ map: ROOM });
    const watcher = createWatcher(w.view, { ...WATCH, stopOnNewCreature: false });
    w.setMonsters([{ grid: { x: 1, y: 1 } }]);
    expect(watcher.check(w.view)).toBeNull();
  });

  it("stops on any loss of hit points when asked to", () => {
    const w = world({ map: ROOM, player: { hp: 40, maxHp: 40 } });
    const watcher = createWatcher(w.view, WATCH);
    w.setPlayer({ hp: 39 });
    const stop = watcher.check(w.view);
    expect(stop?.reason).toBe("hurt");
    expect(stop?.detail).toContain("1 damage");
  });

  it("lets a fight take damage but still stops at the retreat line", () => {
    const w = world({ map: ROOM, player: { hp: 40, maxHp: 40 } });
    const watcher = createWatcher(w.view, { ...WATCH, stopOnAnyDamage: false });
    w.setPlayer({ hp: 30 });
    expect(watcher.check(w.view)).toBeNull();
    w.setPlayer({ hp: 20 });
    expect(watcher.check(w.view)?.reason).toBe("hurt");
  });

  it("stops when a status effect lands, and not for one already present", () => {
    const w = world({ map: ROOM, player: { status: { afraid: 10 } } });
    const watcher = createWatcher(w.view, WATCH);
    expect(watcher.check(w.view)).toBeNull();
    w.setPlayer({ status: { confused: 5 } });
    const stop = watcher.check(w.view);
    expect(stop?.reason).toBe("afflicted");
    expect(stop?.detail).toContain("confused");
  });

  it("does not treat the food counter as an affliction", () => {
    const w = world({ map: ROOM, player: { status: { food: 5000 } } });
    const watcher = createWatcher(w.view, WATCH);
    w.setPlayer({ status: { food: 4990 } });
    expect(watcher.check(w.view)).toBeNull();
  });

  it("stops when the floor changes underfoot", () => {
    const w = world({ map: ROOM, player: { depth: 3 } });
    const watcher = createWatcher(w.view, WATCH);
    w.setPlayer({ depth: 4 });
    const stop = watcher.check(w.view);
    expect(stop?.reason).toBe("level-changed");
  });

  it("stops on death before anything else", () => {
    const w = world({ map: ROOM });
    const watcher = createWatcher(w.view, WATCH);
    w.setPlayer({ dead: true, hp: 0, depth: 9 });
    expect(watcher.check(w.view)?.reason).toBe("dead");
  });

  it("can be told to stop reporting a creature as new", () => {
    const w = world({ map: ROOM });
    const watcher = createWatcher(w.view, WATCH);
    watcher.acknowledge(1);
    w.setMonsters([{ grid: { x: 1, y: 1 } }]);
    expect(watcher.check(w.view)).toBeNull();
  });
});
