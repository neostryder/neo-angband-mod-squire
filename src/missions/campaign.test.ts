import { describe, expect, it } from "vitest";
import { campaign } from "./campaign.js";
import { isStop, type Decision } from "../mission.js";
import { run, world } from "../harness.js";

function stopOf(decision: Decision): { reason: string; detail: string } {
  if (!isStop(decision)) throw new Error("expected the errand to stop");
  return decision.stop;
}

function commandOf(decision: Decision): { code: string; dir?: number } {
  if (isStop(decision)) throw new Error(`expected a command, got ${decision.stop.reason}`);
  return decision.command;
}

const HALL = [
  "#########",
  "#.......#",
  "#.@.....#",
  "#.......#",
  "#########",
];

const OPEN_END = [
  "########",
  "#.@....#",
  "#.#### #",
  "########",
];

describe("campaign", () => {
  it("accepts the keyboard without looking at the world first", () => {
    const w = world({ map: HALL });
    expect(run(w, campaign()).begin()).toBeNull();
  });

  it("rests when it is hurt and nothing is awake in sight", () => {
    const w = world({ map: HALL, player: { hp: 5, maxHp: 40 } });
    const errand = run(w, campaign());
    errand.begin();
    expect(commandOf(errand.step())).toEqual({ code: "rest" });
  });

  it("backs away when it is hurt and something is on top of it", () => {
    const w = world({
      map: HALL,
      player: { hp: 5, maxHp: 40 },
      monsters: [{ grid: { x: 3, y: 2 } }],
    });
    const errand = run(w, campaign());
    errand.begin();
    expect(commandOf(errand.step())).toEqual({ code: "walk", dir: 4 });
  });

  it("fights what is next to it when it is healthy", () => {
    const w = world({ map: HALL, monsters: [{ grid: { x: 3, y: 2 } }] });
    const errand = run(w, campaign());
    errand.begin();
    expect(commandOf(errand.step())).toEqual({ code: "melee", dir: 6 });
  });

  it("closes with a creature further off", () => {
    const w = world({ map: HALL, monsters: [{ grid: { x: 6, y: 2 } }] });
    const errand = run(w, campaign());
    errand.begin();
    expect(commandOf(errand.step())).toEqual({ code: "walk", dir: 6 });
  });

  it("picks up what is underfoot, and tries a grid only once", () => {
    const w = world({
      map: ["#########", "#.......#", "#.*.....#", "#.......#", "#########"],
    });
    w.moveTo({ x: 2, y: 2 });
    const errand = run(w, campaign());
    errand.begin();
    expect(commandOf(errand.step())).toEqual({ code: "pickup" });
    expect(stopOf(errand.step()).reason).toBe("done");
  });

  it("leaves it alone when collecting is switched off", () => {
    const w = world({
      map: ["#########", "#.......#", "#.*.....#", "#.......#", "#########"],
    });
    w.moveTo({ x: 2, y: 2 });
    const errand = run(w, campaign(), { collect: false });
    errand.begin();
    expect(stopOf(errand.step()).reason).toBe("done");
  });

  it("explores when there is nothing to fight and nothing to take", () => {
    const w = world({ map: OPEN_END });
    const errand = run(w, campaign());
    errand.begin();
    expect(commandOf(errand.step())).toEqual({ code: "walk", dir: 6 });
  });

  it("takes the stairs it is standing on once the floor is walked out", () => {
    const w = world({ map: ["###", "#>#", "###"] });
    w.moveTo({ x: 1, y: 1 });
    const errand = run(w, campaign());
    errand.begin();
    expect(commandOf(errand.step())).toEqual({ code: "descend" });
  });

  it("walks to the stairs it remembers", () => {
    const w = world({ map: ["#####", "#@.>#", "#####"] });
    const errand = run(w, campaign());
    errand.begin();
    expect(commandOf(errand.step())).toEqual({ code: "walk", dir: 6 });
  });

  it("stays on the floor when descending is switched off", () => {
    const w = world({ map: ["#####", "#@.>#", "#####"] });
    const errand = run(w, campaign(), { descend: false });
    errand.begin();
    expect(stopOf(errand.step()).reason).toBe("done");
  });

  it("does NOT stop when a creature appears, which is the whole difference", () => {
    const w = world({ map: OPEN_END });
    const errand = run(w, campaign());
    errand.begin();
    errand.step();
    w.setMonsters([{ grid: { x: 6, y: 1 }, race: "cave orc" }]);
    expect(commandOf(errand.step()).code).toBe("walk");
  });

  it("does not stop when it takes damage either", () => {
    const w = world({ map: OPEN_END, player: { hp: 40, maxHp: 40 } });
    const errand = run(w, campaign());
    errand.begin();
    errand.step();
    w.setPlayer({ hp: 39 });
    expect(commandOf(errand.step()).code).toBe("walk");
  });

  it("stops when the character dies", () => {
    const w = world({ map: HALL });
    const errand = run(w, campaign());
    errand.begin();
    w.setPlayer({ dead: true });
    expect(stopOf(errand.step()).reason).toBe("dead");
  });

  it("forgets which grids it picked over when the floor changes", () => {
    const w = world({
      map: ["#########", "#.......#", "#.*.....#", "#.......#", "#########"],
    });
    w.moveTo({ x: 2, y: 2 });
    const errand = run(w, campaign());
    errand.begin();
    expect(commandOf(errand.step())).toEqual({ code: "pickup" });
    w.setPlayer({ depth: 2 });
    expect(commandOf(errand.step())).toEqual({ code: "pickup" });
  });

  it("steps off ground that is burning it before anything else", () => {
    const w = world({ map: ["#####", "#.~.#", "#####"], monsters: [{ grid: { x: 3, y: 1 } }] });
    w.moveTo({ x: 2, y: 1 });
    const errand = run(w, campaign());
    errand.begin();
    expect(commandOf(errand.step())).toEqual({ code: "walk", dir: 4 });
  });
});
