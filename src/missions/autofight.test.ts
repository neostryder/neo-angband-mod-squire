import { describe, expect, it } from "vitest";
import { autofight } from "./autofight.js";
import { isStop, type Decision } from "../mission.js";
import { run, world } from "../harness.js";

const HALL = [
  "#########",
  "#.......#",
  "#.@.....#",
  "#.......#",
  "#########",
];

function stopOf(decision: Decision): { reason: string; detail: string } {
  if (!isStop(decision)) throw new Error("expected the errand to stop");
  return decision.stop;
}

function commandOf(decision: Decision): { code: string; dir?: number } {
  if (isStop(decision)) throw new Error(`expected a command, got ${decision.stop.reason}`);
  return decision.command;
}

describe("autofight", () => {
  it("declines before spending a turn when there is nothing to fight", () => {
    const w = world({ map: HALL });
    const errand = run(w, autofight());
    expect(errand.begin()?.reason).toBe("nothing-to-do");
    expect(w.issued).toHaveLength(0);
  });

  it("strikes a creature standing next to the character", () => {
    const w = world({ map: HALL, monsters: [{ grid: { x: 3, y: 2 } }] });
    const errand = run(w, autofight());
    expect(errand.begin()).toBeNull();
    expect(commandOf(errand.step())).toEqual({ code: "melee", dir: 6 });
  });

  it("walks toward a creature that is further off", () => {
    const w = world({ map: HALL, monsters: [{ grid: { x: 6, y: 2 } }] });
    const errand = run(w, autofight());
    errand.begin();
    expect(commandOf(errand.step())).toEqual({ code: "walk", dir: 6 });
  });

  it("will not choose a sleeping creature on its own", () => {
    const w = world({ map: HALL, monsters: [{ grid: { x: 3, y: 2 }, asleep: true }] });
    expect(run(w, autofight()).begin()?.reason).toBe("nothing-to-do");
  });

  it("fights a sleeping creature the player had already targeted", () => {
    /* Naming a target IS the decision to wake it, so the sleepers rule does not
     * get to override the player's own targeting command. */
    const w = world({
      map: HALL,
      monsters: [{ grid: { x: 3, y: 2 }, asleep: true }],
      target: { midx: 1, grid: { x: 3, y: 2 } },
    });
    const errand = run(w, autofight());
    expect(errand.begin()).toBeNull();
    expect(commandOf(errand.step())).toEqual({ code: "melee", dir: 6 });
  });

  it("stops as finished when the creature it struck is gone", () => {
    const w = world({ map: HALL, monsters: [{ grid: { x: 3, y: 2 } }] });
    const errand = run(w, autofight());
    errand.begin();
    errand.step();
    w.setMonsters([]);
    const stop = stopOf(errand.step());
    expect(stop.reason).toBe("done");
    expect(stop.detail).toBe("The target is down.");
  });

  it("stops as target-gone when the creature leaves without being struck", () => {
    const w = world({ map: HALL, monsters: [{ grid: { x: 6, y: 2 } }] });
    const errand = run(w, autofight());
    errand.begin();
    errand.step();
    w.setMonsters([]);
    expect(stopOf(errand.step()).reason).toBe("target-gone");
  });

  it("stops when something that was not there arrives", () => {
    const w = world({ map: HALL, monsters: [{ grid: { x: 6, y: 2 } }] });
    const errand = run(w, autofight());
    errand.begin();
    errand.step();
    w.setMonsters([
      { grid: { x: 6, y: 2 } },
      { grid: { x: 1, y: 1 }, race: "cave orc" },
    ]);
    const stop = stopOf(errand.step());
    expect(stop.reason).toBe("creature-appeared");
    expect(stop.detail).toContain("cave orc");
  });

  it("keeps fighting through damage, and stops at the retreat line", () => {
    const w = world({
      map: HALL,
      monsters: [{ grid: { x: 3, y: 2 } }],
      player: { hp: 40, maxHp: 40 },
    });
    const errand = run(w, autofight());
    errand.begin();
    w.setPlayer({ hp: 30 });
    expect(commandOf(errand.step()).code).toBe("melee");
    w.setPlayer({ hp: 20 });
    expect(stopOf(errand.step()).reason).toBe("hurt");
  });

  it("does not read a standing fight as being stuck", () => {
    /* Trading blows leaves the character exactly where it was, decision after
     * decision. The idle count must not read that as a wedge, or every fight
     * would end after three swings. */
    const w = world({ map: HALL, monsters: [{ grid: { x: 3, y: 2 }, hp: 200, maxHp: 200 }] });
    const errand = run(w, autofight());
    errand.begin();
    for (let i = 0; i < 6; i++) expect(commandOf(errand.step()).code).toBe("melee");
  });

  it("stops once a short errand has run past its allowance", () => {
    const w = world({ map: HALL, monsters: [{ grid: { x: 3, y: 2 } }] });
    const errand = run(w, autofight(), { errandSteps: 2 });
    errand.begin();
    errand.step();
    errand.step();
    expect(stopOf(errand.step()).reason).toBe("budget");
  });

  it("stops when the creature cannot be reached over remembered ground", () => {
    const w = world({
      map: ["#######", "#.@#..#", "#######"],
      monsters: [{ grid: { x: 5, y: 1 } }],
    });
    const errand = run(w, autofight());
    expect(errand.begin()).toBeNull();
    expect(stopOf(errand.step()).reason).toBe("blocked");
  });

  it("stops when the target is no longer visible", () => {
    const w = world({ map: HALL, monsters: [{ grid: { x: 6, y: 2 } }] });
    const errand = run(w, autofight());
    errand.begin();
    errand.step();
    w.setMonsters([{ grid: { x: 6, y: 2 }, visible: false }]);
    expect(stopOf(errand.step()).reason).toBe("target-gone");
  });
});
