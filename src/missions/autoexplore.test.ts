import { describe, expect, it } from "vitest";
import { autoexplore } from "./autoexplore.js";
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

/** A corridor with unexplored ground off its right-hand end. */
const CORRIDOR = [
  "########",
  "#.@....#",
  "#.#### #",
  "########",
];

describe("autoexplore", () => {
  it("walks toward the nearest unexplored ground", () => {
    const w = world({ map: CORRIDOR });
    const errand = run(w, autoexplore());
    expect(errand.begin()).toBeNull();
    expect(commandOf(errand.step())).toEqual({ code: "walk", dir: 6 });
  });

  it("opens a door standing between the character and the rest of the floor", () => {
    const w = world({ map: ["#######", "#.@+. #", "#######"] });
    const errand = run(w, autoexplore());
    errand.begin();
    expect(commandOf(errand.step())).toEqual({ code: "open", dir: 6 });
  });

  it("refuses to start while something awake is already in sight", () => {
    const w = world({ map: CORRIDOR, monsters: [{ grid: { x: 5, y: 1 }, race: "grey mold" }] });
    const declined = run(w, autoexplore()).begin();
    expect(declined?.reason).toBe("unsafe");
    expect(declined?.detail).toContain("grey mold");
    expect(w.issued).toHaveLength(0);
  });

  it("walks past a sleeping creature, which is what stealth is for", () => {
    const w = world({ map: CORRIDOR, monsters: [{ grid: { x: 5, y: 1 }, asleep: true }] });
    const errand = run(w, autoexplore());
    expect(errand.begin()).toBeNull();
    expect(commandOf(errand.step()).code).toBe("walk");
  });

  it("reports the floor walked out when nothing is left unexplored", () => {
    const w = world({ map: ["#####", "#...#", "#.@.#", "#####"] });
    const errand = run(w, autoexplore());
    errand.begin();
    const stop = stopOf(errand.step());
    expect(stop.reason).toBe("done");
    expect(stop.detail).toBe("This floor is walked out.");
  });

  it("reports done when the unexplored ground cannot be reached", () => {
    const w = world({ map: ["#######", "#.@#  #", "#..#  #", "#######"] });
    const errand = run(w, autoexplore());
    errand.begin();
    expect(stopOf(errand.step()).reason).toBe("done");
  });

  it("stops the moment a creature comes into view", () => {
    const w = world({ map: CORRIDOR });
    const errand = run(w, autoexplore());
    errand.begin();
    errand.step();
    w.setMonsters([{ grid: { x: 6, y: 1 }, race: "cave spider" }]);
    const stop = stopOf(errand.step());
    expect(stop.reason).toBe("creature-appeared");
    expect(stop.detail).toContain("cave spider");
  });

  it("stops on the first point of damage, not on the retreat line", () => {
    const w = world({ map: CORRIDOR, player: { hp: 40, maxHp: 40 } });
    const errand = run(w, autoexplore());
    errand.begin();
    errand.step();
    w.setPlayer({ hp: 39 });
    const stop = stopOf(errand.step());
    expect(stop.reason).toBe("hurt");
    expect(stop.detail).toContain("1 damage");
  });

  it("stops when a status effect lands", () => {
    const w = world({ map: CORRIDOR });
    const errand = run(w, autoexplore());
    errand.begin();
    errand.step();
    w.setPlayer({ status: { confused: 8 } });
    expect(stopOf(errand.step()).reason).toBe("afflicted");
  });

  it("walks into the dark when standing next to unexplored ground reveals nothing", () => {
    const w = world({ map: ["#####", "#.@ #", "#####"] });
    const errand = run(w, autoexplore());
    errand.begin();
    expect(commandOf(errand.step())).toEqual({ code: "walk", dir: 6 });
  });

  it("gives up rather than issuing the same useless command forever", () => {
    /* Nothing in this harness executes a command, so the character never
     * actually moves. That is exactly the shape of a wedge, and after the
     * allowance of motionless decisions the errand has to end. */
    const w = world({ map: CORRIDOR });
    const errand = run(w, autoexplore(), { idleSteps: 3 });
    errand.begin();
    errand.step();
    errand.step();
    errand.step();
    const stop = stopOf(errand.step());
    expect(stop.reason).toBe("blocked");
    expect(stop.detail).toBe("The character has stopped making progress.");
  });

  it("stops once a short errand has run past its allowance", () => {
    const w = world({ map: CORRIDOR });
    const errand = run(w, autoexplore(), { errandSteps: 1 });
    errand.begin();
    errand.step();
    expect(stopOf(errand.step()).reason).toBe("budget");
  });

  it("steps off ground that is burning the character", () => {
    const w = world({ map: ["#####", "#.~.#", "#####"] });
    w.moveTo({ x: 2, y: 1 });
    const errand = run(w, autoexplore());
    errand.begin();
    expect(commandOf(errand.step()).code).toBe("walk");
  });
});
