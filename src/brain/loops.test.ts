import type { StoreView } from "@rpgm-tools/neo-angband-core";
import { describe, expect, it } from "vitest";
import { FEAT, itemNamed, world } from "../harness.js";
import { createLoopGuard, EQUIP_FLIP_TURNS, normalName } from "./loops.js";

const ROOM = ["#########", "#.......#", "#...@...#", "#.......#", "#########"];

describe("loop guard", () => {
  it("finds the same choice made in the same state three times running", () => {
    const w = world({ map: ROOM, monsters: [{ grid: { x: 6, y: 2 }, hp: 10 }] });
    const guard = createLoopGuard();
    guard.chose("throw_oil", w.view);
    w.advance(10);
    guard.chose("throw_oil", w.view);
    expect(guard.detect(w.view)).toBeNull();
    w.advance(10);
    guard.chose("throw_oil", w.view);
    expect(guard.detect(w.view)).toMatchObject({ kind: "repeat", tactic: "throw_oil" });
    guard.reset();
    expect(guard.detect(w.view)).toBeNull();
  });

  it("does not count a change in the creature's health, or waiting, as a repeat", () => {
    const w = world({ map: ROOM, monsters: [{ grid: { x: 6, y: 2 }, hp: 10 }] });
    const guard = createLoopGuard();
    for (const hp of [10, 8, 6]) {
      w.setMonsters([{ grid: { x: 6, y: 2 }, hp }]);
      guard.chose("throw_oil", w.view);
    }
    expect(guard.detect(w.view)).toBeNull();
    for (let i = 0; i < 3; i++) guard.chose("rest", w.view);
    expect(guard.detect(w.view)).toBeNull();
  });

  it("reads a creature's health as the health bar shows it, so a scratch that leaves the bar unchanged still repeats", () => {
    const w = world({ map: ROOM, monsters: [{ grid: { x: 6, y: 2 }, hp: 100, maxHp: 100 }] });
    const guard = createLoopGuard();
    for (const hp of [100, 99, 98]) {
      w.setMonsters([{ grid: { x: 6, y: 2 }, hp, maxHp: 100 }]);
      guard.chose("throw_oil", w.view);
    }
    expect(guard.detect(w.view)).toMatchObject({ kind: "repeat", tactic: "throw_oil" });
  });

  it("finds a walk back and forth between a few squares and names the goal chosen most there", () => {
    const w = world({ map: ROOM });
    const guard = createLoopGuard();
    const path = [{ x: 3, y: 2 }, { x: 4, y: 2 }, { x: 3, y: 2 }, { x: 4, y: 2 }, { x: 5, y: 2 }, { x: 4, y: 2 }, { x: 3, y: 2 }, { x: 4, y: 2 }];
    path.forEach((grid, i) => {
      w.moveTo(grid);
      w.advance(5);
      guard.chose(i % 2 === 0 ? "explore" : "retreat", w.view);
    });
    const found = guard.detect(w.view);
    expect(found).toMatchObject({ kind: "cycle", tactic: "retreat" });
    expect(found?.detail).toContain("back and forth between 3 squares");
  });

  it("does not take a steady walk across a room for a cycle", () => {
    const w = world({ map: ROOM });
    const guard = createLoopGuard();
    for (let x = 1; x <= 7; x++) {
      w.moveTo({ x, y: x % 2 === 0 ? 1 : 2 });
      guard.chose("explore", w.view);
    }
    w.moveTo({ x: 7, y: 3 });
    guard.chose("explore", w.view);
    expect(guard.detect(w.view)).toBeNull();
  });

  it("finds going up and down between the same two levels", () => {
    const w = world({ map: ROOM, player: { depth: 3 } });
    const guard = createLoopGuard();
    for (const depth of [3, 4, 3, 4, 3, 4]) {
      w.setPlayer({ depth });
      guard.chose("leave_level", w.view);
    }
    expect(guard.detect(w.view)).toMatchObject({ kind: "level_flip", tactic: "leave_level" });
  });

  it("finds swapping the same gear back in within a short time, by shown name", () => {
    const w = world({ map: ROOM, pack: ["a Dagger (1d4) (+0,+0)", "a Main Gauche (1d5) (+0,+0)"] });
    const guard = createLoopGuard();
    guard.command({ code: "wield", args: { handle: 1 } }, w.view);
    w.advance(10);
    guard.command({ code: "wield", args: { handle: 2 } }, w.view);
    expect(guard.detect(w.view)).toBeNull();
    w.advance(10);
    guard.command({ code: "wield", args: { handle: 1 } }, w.view);
    expect(guard.detect(w.view)).toMatchObject({ kind: "equip_flip", tactic: "wear" });
  });

  it("lets a swap back after a long time pass", () => {
    const w = world({ map: ROOM, pack: ["a Dagger (1d4) (+0,+0)", "a Main Gauche (1d5) (+0,+0)"] });
    const guard = createLoopGuard();
    guard.command({ code: "wield", args: { handle: 1 } }, w.view);
    w.advance(EQUIP_FLIP_TURNS);
    guard.command({ code: "wield", args: { handle: 2 } }, w.view);
    w.advance(EQUIP_FLIP_TURNS);
    guard.command({ code: "wield", args: { handle: 1 } }, w.view);
    expect(guard.detect(w.view)).toBeNull();
  });

  it("finds buying back on one town visit what was sold on it", () => {
    const general: StoreView = {
      feat: FEAT.GENERAL, featName: "General Store", isHome: false, owner: { name: "Bilbo", purse: 5000 },
      stock: [{ ...itemNamed("5 Flasks of Oil", 0), index: 0, number: 5, price: 3 }],
    };
    const w = world({ map: ["#####", "#.G.#", "#####"], player: { depth: 0 }, pack: ["a Flask of Oil"], stores: [general] });
    w.moveTo({ x: 2, y: 1 });
    const guard = createLoopGuard();
    guard.command({ code: "shop-sell", args: { handle: 1 } }, w.view);
    expect(guard.detect(w.view)).toBeNull();
    guard.command({ code: "shop-buy", args: { index: 0 } }, w.view);
    expect(guard.detect(w.view)).toMatchObject({ kind: "store_flip", tactic: "shop" });
    guard.reset();
    guard.command({ code: "shop-sell", args: { handle: 1 } }, w.view);
    expect(guard.detect(w.view)).toBeNull();
  });

  it("starts a fresh town visit after a trip into the dungeon", () => {
    const general: StoreView = {
      feat: FEAT.GENERAL, featName: "General Store", isHome: false, owner: { name: "Bilbo", purse: 5000 },
      stock: [{ ...itemNamed("a Flask of Oil", 0), index: 0, number: 1, price: 3 }],
    };
    const w = world({ map: ["#####", "#.G.#", "#####"], player: { depth: 0 }, pack: ["a Flask of Oil"], stores: [general] });
    w.moveTo({ x: 2, y: 1 });
    const guard = createLoopGuard();
    guard.command({ code: "shop-sell", args: { handle: 1 } }, w.view);
    w.setPlayer({ depth: 1 });
    guard.chose("explore", w.view);
    w.setPlayer({ depth: 0 });
    guard.command({ code: "shop-buy", args: { index: 0 } }, w.view);
    expect(guard.detect(w.view)).toBeNull();
  });

  it("matches a stack and a single item by name", () => {
    expect(normalName("5 Flasks of Oil {@v1}")).toBe(normalName("a Flask of Oil"));
    expect(normalName("a Potion of Cure Light Wounds")).toBe(normalName("3 Potions of Cure Light Wounds"));
  });
});
