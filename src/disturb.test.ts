import { describe, expect, it } from "vitest";
import { createTravelWatch, createWatcher, openings, TRAVEL_INTERRUPTS, type TravelWatchOptions, type WatchOptions } from "./disturb.js";
import { world } from "./harness.js";

const ROOM = ["#####", "#...#", "#.@.#", "#...#", "#####"];

const WATCH: WatchOptions = {
  stopOnAnyDamage: true,
  stopOnNewCreature: true,
  stopOnLowHealth: true,
  retreatFraction: 0.5,
};

describe("createWatcher", () => {
  it("stops for a big blow or a run of small ones when asked to", () => {
    const opts: WatchOptions = { ...WATCH, stopOnAnyDamage: false, stopOnLowHealth: false, stopOnDamageShare: 0.1 };
    const w = world({ map: ROOM, player: { hp: 100, maxHp: 100 } });
    const watcher = createWatcher(w.view, opts);
    w.setPlayer({ hp: 95 });
    expect(watcher.check(w.view)).toBeNull();
    w.setPlayer({ hp: 84 });
    expect(watcher.check(w.view)?.reason).toBe("hurt");
    const small = createWatcher(w.view, opts);
    for (const hp of [80, 76, 72, 68]) {
      w.setPlayer({ hp });
      expect(small.check(w.view)).toBeNull();
    }
    w.setPlayer({ hp: 64 });
    expect(small.check(w.view)?.reason).toBe("hurt");
  });

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
    expect(stop?.detail).toContain("Cave spider");
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

/* A corridor that forks south at x 4, with a staircase 26 steps east of the start: out of sight until the walk closes in. */
const FORK = [
  "#############################",
  "#@.........................>#",
  "####.########################",
  "####.########################",
  "#############################",
];

function travel(mode: TravelWatchOptions["mode"], extra: Partial<TravelWatchOptions> = {}, spec: Partial<Parameters<typeof world>[0]> = {}) {
  const w = world({ map: FORK, ...spec });
  return { w, watch: createTravelWatch(w.view, { mode, terrain: w.terrain, ...extra }) };
}

describe("TRAVEL_INTERRUPTS", () => {
  it("is the fixed list, in the order it is checked", () => {
    expect(TRAVEL_INTERRUPTS.map((entry) => entry.id)).toEqual(["new-hostile", "hp-change", "status-change", "important-message", "target-moved", "item", "branch", "stair", "failed-command"]);
    expect(Object.isFrozen(TRAVEL_INTERRUPTS)).toBe(true);
  });

  it("travels on while nothing changes", () => {
    for (const mode of ["rest", "run", "pathfind", "explore"] as const) {
      const { w, watch } = travel(mode);
      w.moveTo({ x: 2, y: 1 });
      expect(watch.check(w.view)).toBeNull();
    }
  });

  it("new-hostile: stops for a creature that can hurt the character, not for a harmless one", () => {
    const { w, watch } = travel("run", { harmless: (m) => m.race === "white worm mass" });
    w.setMonsters([{ id: 2, grid: { x: 6, y: 1 }, race: "white worm mass" }]);
    expect(watch.check(w.view)).toBeNull();
    w.setMonsters([{ id: 2, grid: { x: 6, y: 1 }, race: "white worm mass" }, { id: 3, grid: { x: 7, y: 1 }, race: "cave spider" }]);
    expect(watch.check(w.view)).toEqual({ id: "new-hostile", detail: "Cave spider came into view." });
  });

  it("hp-change: stops for lost hit points, but not for the trickle of poison", () => {
    const { w, watch } = travel("rest", {}, { player: { hp: 50, maxHp: 50 } });
    w.setPlayer({ hp: 48 });
    expect(watch.check(w.view)?.id).toBe("hp-change");
    const poisoned = travel("rest", {}, { player: { hp: 50, maxHp: 50, status: { poisoned: 5 } } });
    poisoned.w.setPlayer({ hp: 49 });
    expect(poisoned.watch.check(poisoned.w.view)).toBeNull();
    poisoned.w.setPlayer({ hp: 46 });
    expect(poisoned.watch.check(poisoned.w.view)?.id).toBe("hp-change");
    const cut = travel("rest", {}, { player: { hp: 200, maxHp: 200, status: { cut: 120 } } });
    cut.w.setPlayer({ hp: 194 });
    expect(cut.watch.check(cut.w.view)).toBeNull();
    cut.w.setPlayer({ hp: 187 });
    expect(cut.watch.check(cut.w.view)?.id).toBe("hp-change");
  });

  it("status-change: stops when an effect starts and when one ends", () => {
    const { w, watch } = travel("explore", {}, { player: { status: { afraid: 3 } } });
    w.setPlayer({ status: { afraid: 3, confused: 2 } });
    expect(watch.check(w.view)).toEqual({ id: "status-change", detail: "The character is confused." });
    w.setPlayer({ status: { afraid: 0, confused: 2 } });
    expect(watch.check(w.view)).toEqual({ id: "status-change", detail: "The character is no longer afraid." });
  });

  it("important-message: stops when the game prints something new", () => {
    const { w, watch } = travel("pathfind");
    w.setMessages(["You hear a door burst open!"]);
    expect(watch.check(w.view)?.id).toBe("important-message");
    expect(watch.check(w.view)).toBeNull();
  });

  it("target-moved: a walk to an object stops when the object is gone", () => {
    const loot = { x: 10, y: 1 };
    const { w, watch } = travel("pathfind", { target: loot, destinations: [loot] }, { floor: [{ ...loot, name: "Flask of oil" }] });
    w.moveTo({ x: 3, y: 1 });
    expect(watch.check(w.view)).toBeNull();
    w.setFloor([]);
    expect(watch.check(w.view)?.id).toBe("target-moved");
    const arrived = travel("pathfind", { target: loot, destinations: [loot] }, { floor: [{ ...loot, name: "Flask of oil" }] });
    arrived.w.moveTo(loot);
    arrived.w.setFloor([]);
    expect(arrived.watch.check(arrived.w.view)).toBeNull();
  });

  it("item: stops for an object coming into view or underfoot, not for the one the walk is heading to", () => {
    const { w, watch } = travel("explore");
    w.setFloor([{ x: 8, y: 1, name: "Flask of oil" }]);
    expect(watch.check(w.view)).toEqual({ id: "item", detail: "An object came into view." });
    w.moveTo({ x: 8, y: 1 });
    expect(watch.check(w.view)).toEqual({ id: "item", detail: "The character is standing on an object." });
    const loot = { x: 12, y: 1 };
    const walk = travel("pathfind", { target: loot, destinations: [loot] });
    walk.w.setFloor([{ ...loot, name: "Flask of oil" }]);
    expect(walk.watch.check(walk.w.view)).toBeNull();
    const remembered = travel("pathfind", {}, { floor: [{ x: 25, y: 1, name: "Flask of oil" }] });
    remembered.w.moveTo({ x: 8, y: 1 });
    expect(remembered.watch.check(remembered.w.view)).toBeNull();
  });

  it("branch: a run or an exploring walk stops where the way forks; a walk to a known place does not", () => {
    expect(openings(world({ map: FORK }).view, world({ map: FORK }).terrain, { x: 2, y: 1 })).toBe(2);
    for (const mode of ["run", "explore"] as const) {
      const { w, watch } = travel(mode);
      w.moveTo({ x: 4, y: 1 });
      expect(watch.check(w.view)).toEqual({ id: "branch", detail: "The way forks here." });
      expect(watch.check(w.view)).toBeNull();
    }
    for (const mode of ["rest", "pathfind"] as const) {
      const { w, watch } = travel(mode);
      w.moveTo({ x: 4, y: 1 });
      expect(watch.check(w.view)).toBeNull();
    }
  });

  it("stair: stops for a staircase coming into view, but not for the one the walk is heading to", () => {
    const w = world({ map: FORK });
    const hidden = new Set(["27,1"]);
    const view = { ...w.view, cell: (x: number, y: number) => {
      const cell = w.view.cell(x, y);
      return cell !== null && hidden.has(`${String(x)},${String(y)}`) ? { ...cell, known: false, inView: false } : cell;
    } };
    const watch = createTravelWatch(view, { mode: "pathfind", terrain: w.terrain });
    w.moveTo({ x: 8, y: 1 });
    expect(watch.check(view)).toBeNull();
    hidden.clear();
    expect(watch.check(view)).toEqual({ id: "stair", detail: "A staircase came into view." });
    const remembered = travel("pathfind");
    remembered.w.moveTo({ x: 8, y: 1 });
    expect(remembered.watch.check(remembered.w.view)).toBeNull();
    const descent = travel("pathfind", { destinations: [{ x: 27, y: 1 }] });
    descent.w.moveTo({ x: 8, y: 1 });
    expect(descent.watch.check(descent.w.view)).toBeNull();
    descent.w.moveTo({ x: 27, y: 1 });
    expect(descent.watch.check(descent.w.view)).toBeNull();
  });

  it("failed-command: stops when the last command did not do what it should have", () => {
    const { w, watch } = travel("rest");
    expect(watch.check(w.view, "The walk left the character where it was.")).toEqual({ id: "failed-command", detail: "The walk left the character where it was." });
  });
});
