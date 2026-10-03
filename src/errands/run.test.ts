import { describe, expect, it } from "vitest";
import type { AgentCommand } from "@rpgm-tools/neo-angband-core";
import { endsOnNewLevel, errandMission, plainEnv } from "./run.js";
import { ERRAND_DONE, ERRAND_TEXT } from "./text.js";
import { isStop, type Decision } from "../mission.js";
import { run, world } from "../harness.js";
import type { Plan } from "../brain/brain.js";

function stopOf(decision: Decision): { reason: string; detail: string } {
  if (!isStop(decision)) throw new Error(`expected the errand to stop, got ${decision.command.code}`);
  return decision.stop;
}

function commandOf(decision: Decision): AgentCommand {
  if (isStop(decision)) throw new Error(`expected a command, got ${decision.stop.reason}: ${decision.stop.detail}`);
  return decision.command;
}

const noShopping = (): Plan => ({ label: "nothing", step: () => null });
const plain = plainEnv(noShopping);

/** A corridor with a down staircase at its east end and an up staircase at its west end. */
const CORRIDOR = ["#########", "#<..@..>#", "#########"];

describe("the loot errand", () => {
  it("picks up what lies underfoot", () => {
    const w = world({ map: ["#######", "#.@.*.#", "#######"], floor: [{ x: 4, y: 1, name: "a Potion of Cure Light Wounds" }] });
    w.moveTo({ x: 4, y: 1 });
    const errand = run(w, errandMission("loot", plain));
    expect(errand.begin()).toBeNull();
    expect(commandOf(errand.step()).code).toBe("pickup");
  });

  it("walks to known loot", () => {
    const w = world({ map: ["#######", "#.@..*#", "#######"], floor: [{ x: 5, y: 1, name: "a Potion of Cure Light Wounds" }] });
    const errand = run(w, errandMission("loot", plain));
    errand.begin();
    expect(commandOf(errand.step())).toEqual({ code: "walk", dir: 6 });
  });

  it("makes room in a full pack by dropping junk, once per item", () => {
    const pack = ["a Broken Stick", ...Array.from({ length: 22 }, () => "a Potion of Cure Light Wounds")];
    const w = world({ map: ["#######", "#.@.*.#", "#######"], floor: [{ x: 4, y: 1, name: "a Potion of Cure Light Wounds" }], pack });
    w.moveTo({ x: 4, y: 1 });
    const errand = run(w, errandMission("loot", plain));
    errand.begin();
    expect(commandOf(errand.step())).toEqual({ code: "drop", args: { handle: 1 } });
    /* The game did not drop it: the pile is left rather than dropping the same thing again. */
    const next = errand.step();
    expect(isStop(next) || commandOf(next).code !== "drop").toBe(true);
  });

  it("is done when nothing worth taking is known", () => {
    const w = world({ map: ["#######", "#.@...#", "#######"] });
    const errand = run(w, errandMission("loot", plain));
    errand.begin();
    expect(stopOf(errand.step())).toEqual({ reason: "done", detail: ERRAND_DONE.loot });
  });
});

describe("the staircase errands", () => {
  it("walk to the staircase, and end standing on it", () => {
    const w = world({ map: CORRIDOR });
    const down = run(w, errandMission("down", plain));
    down.begin();
    expect(commandOf(down.step())).toEqual({ code: "walk", dir: 6 });
    w.moveTo({ x: 7, y: 1 });
    expect(stopOf(down.step())).toEqual({ reason: "done", detail: ERRAND_DONE.down });

    const up = run(w, errandMission("up", plain));
    up.begin();
    expect(commandOf(up.step())).toEqual({ code: "walk", dir: 4 });
    w.moveTo({ x: 1, y: 1 });
    expect(stopOf(up.step()).reason).toBe("done");
  });

  it("explore to find a staircase when none is known", () => {
    const w = world({ map: ["#######", "#.@..,,", "#######"] });
    const down = run(w, errandMission("down", plain));
    down.begin();
    expect(commandOf(down.step())).toEqual({ code: "walk", dir: 6 });
  });

  it("say so when the level is explored and has none", () => {
    const w = world({ map: ["#######", "#.@...#", "#######"] });
    const down = run(w, errandMission("down", plain));
    down.begin();
    expect(stopOf(down.step())).toEqual({ reason: "nothing-to-do", detail: "No down staircase can be found on this level." });
  });
});

describe("the leave errand", () => {
  it("takes the staircase it stands on, and is done on the next level", () => {
    const w = world({ map: CORRIDOR });
    w.moveTo({ x: 7, y: 1 });
    const errand = run(w, errandMission("leave", plain));
    errand.begin();
    expect(commandOf(errand.step()).code).toBe("descend");
    w.setPlayer({ depth: 2 });
    expect(stopOf(errand.step())).toEqual({ reason: "done", detail: ERRAND_DONE.leave });
  });

  it("goes up a staircase as readily as down", () => {
    const w = world({ map: CORRIDOR });
    w.moveTo({ x: 1, y: 1 });
    const errand = run(w, errandMission("leave", plain));
    errand.begin();
    expect(commandOf(errand.step()).code).toBe("ascend");
  });
});

describe("the town errand", () => {
  it("reads Word of Recall, then waits for it", () => {
    const w = world({ map: CORRIDOR, pack: ["a Scroll of Word of Recall"] });
    const errand = run(w, errandMission("town", plain));
    errand.begin();
    expect(commandOf(errand.step())).toEqual({ code: "read", args: { handle: 1 } });
    expect(commandOf(errand.step()).code).toBe("hold");
  });

  it("walks up the stairs without a scroll", () => {
    const w = world({ map: CORRIDOR });
    const errand = run(w, errandMission("town", plain));
    errand.begin();
    expect(commandOf(errand.step())).toEqual({ code: "walk", dir: 4 });
    w.moveTo({ x: 1, y: 1 });
    expect(commandOf(errand.step()).code).toBe("ascend");
  });

  it("is done in town", () => {
    const w = world({ map: CORRIDOR, player: { depth: 0 } });
    const errand = run(w, errandMission("town", plain));
    errand.begin();
    expect(stopOf(errand.step())).toEqual({ reason: "done", detail: ERRAND_DONE.town });
  });
});

describe("the explore and clear errands", () => {
  it("explore walks toward unseen ground and is done when there is none", () => {
    const open = world({ map: ["#######", "#.@..,,", "#######"] });
    const errand = run(open, errandMission("explore", plain));
    errand.begin();
    expect(commandOf(errand.step())).toEqual({ code: "walk", dir: 6 });
    const shut = world({ map: ["#######", "#.@...#", "#######"] });
    const done = run(shut, errandMission("explore", plain));
    done.begin();
    expect(stopOf(done.step())).toEqual({ reason: "done", detail: ERRAND_DONE.explore });
  });

  it("clear goes after a creature, sleeping or not, and is done when none is left", () => {
    const w = world({ map: ["#########", "#.@.....#", "#########"], monsters: [{ grid: { x: 6, y: 1 }, asleep: true }] });
    const errand = run(w, errandMission("clear", plain));
    errand.begin();
    expect(isStop(errand.step())).toBe(false);
    w.setMonsters([]);
    const after = run(w, errandMission("clear", plain));
    after.begin();
    expect(stopOf(after.step())).toEqual({ reason: "done", detail: ERRAND_DONE.clear });
  });
});

describe("the restock errand", () => {
  it("declines away from town", () => {
    const w = world({ map: CORRIDOR });
    expect(run(w, errandMission("restock", plain)).begin()).toEqual({ reason: "nothing-to-do", detail: ERRAND_TEXT.reasons.notInTown });
  });

  it("runs a shopping trip to its end", () => {
    const w = world({ map: ["#######", "#.@..G#", "#######"], player: { depth: 0 } });
    let left = 1;
    const trip = (): Plan => ({ label: "shop", step: () => (left-- > 0 ? { code: "walk", dir: 6 } as AgentCommand : null) });
    const errand = run(w, errandMission("restock", plainEnv(trip)));
    expect(errand.begin()).toBeNull();
    expect(commandOf(errand.step())).toEqual({ code: "walk", dir: 6 });
    expect(stopOf(errand.step())).toEqual({ reason: "done", detail: ERRAND_DONE.restock });
  });
});

describe("which errands a new level ends", () => {
  it("ends every errand but the two whose work is changing level", () => {
    expect(endsOnNewLevel("town")).toBe(false);
    expect(endsOnNewLevel("leave")).toBe(false);
    for (const id of ["loot", "down", "up", "explore", "clear", "restock"] as const) expect(endsOnNewLevel(id)).toBe(true);
  });
});
