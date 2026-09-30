import { describe, expect, it } from "vitest";
import { run, world } from "./harness.js";
import { defaultCfg } from "./settings.js";
import { isStop } from "./mission.js";
import { autoexplore } from "./missions/autoexplore.js";
import { createGoalPlanner, type GoalDigest } from "./brain/goals.js";
import type { Answer } from "./brain/systemone.js";
import type { Question } from "./brain/brain.js";

const CORRIDOR = ["########", "#.@....#", "#.#### #", "########"];

function planner(w: ReturnType<typeof world>) {
  return createGoalPlanner({ cfg: defaultCfg(), terrain: w.terrain, log: () => {}, reflex: false });
}

type Asked = ReturnType<ReturnType<typeof createGoalPlanner>["ask"]>;

function asked(q: Asked): Question<GoalDigest> {
  if ("handBack" in q) throw new Error(`expected a question, got a hand-back: ${q.handBack}`);
  if ("reflex" in q) throw new Error(`expected a question, got a reflex: ${q.reflex}`);
  return q;
}

function pick(choice: string): Readonly<Record<string, Answer>> {
  return { goal: { type: "choice", choice, confidence: 0.9, probabilities: { [choice]: 0.9 } } };
}

function planFor(w: ReturnType<typeof world>, goal: string) {
  const p = planner(w);
  const choice = p.choose(pick(goal), asked(p.ask(w.view)).context, w.view);
  if (!("plan" in choice)) throw new Error("expected a plan");
  return choice.plan;
}

const STAIRS = { map: ["#####", "#@.>#", "#####"], player: { depth: 2, maxDepth: 2 }, travelPath: (to: { x: number; y: number }) => [to] };

describe("engine travel", () => {
  it("walks to the stairs with the engine's navigate command", () => {
    const w = world(STAIRS);
    const plan = planFor(w, "descend");
    expect(plan.step(w.view, w.act)).toEqual({ code: "navigate-down" });
  });

  it("falls back to steps when the game refuses the engine command", () => {
    const w = world(STAIRS);
    const plan = planFor(w, "descend");
    expect(plan.step(w.view, w.act)).toEqual({ code: "navigate-down" });
    /* No game time passed, so the command changed nothing: step instead. */
    expect(plan.step(w.view, w.act)).toEqual({ code: "walk", dir: 6 });
  });

  it("falls back to steps when the view has no engine route read", () => {
    const w = world({ map: ["#####", "#@.>#", "#####"], player: { depth: 2, maxDepth: 2 } });
    expect(planFor(w, "descend").step(w.view, w.act)).toEqual({ code: "walk", dir: 6 });
  });

  it("falls back to steps while an awake creature is in sight", () => {
    const w = world({
      map: ["#######", "#@....#", "#.....#", "#....>#", "#######"],
      player: { depth: 2, maxDepth: 2 },
      monsters: [{ grid: { x: 3, y: 1 }, race: "cave orc", level: 10 }],
      travelPath: (to: { x: number; y: number }) => [to],
    });
    expect(planFor(w, "descend").step(w.view, w.act)?.code).toBe("walk");
  });

  it("runs down a corridor toward a frontier", () => {
    const w = world({ map: CORRIDOR, travelPath: (to: { x: number; y: number }) => [to] });
    const plan = planFor(w, "explore");
    expect(plan.step(w.view, w.act)?.code).toBe("run");
  });

  it("pathfinds toward a frontier in the open", () => {
    const open = ["#########", "#.......#", "#.@....  ", "#.......#", "#########"];
    const w = world({ map: open, travelPath: (to: { x: number; y: number }) => [to] });
    const plan = planFor(w, "explore");
    const command = plan.step(w.view, w.act);
    expect(command?.code).toBe("pathfind");
    expect(command?.args?.["dest"]).toBeDefined();
  });

  it("walks toward a frontier while a creature is awake", () => {
    const w = world({ map: CORRIDOR, monsters: [{ grid: { x: 5, y: 1 }, race: "cave orc", level: 10 }], travelPath: (to: { x: number; y: number }) => [to] });
    expect(planFor(w, "explore").step(w.view, w.act)?.code).toBe("walk");
  });

  it("falls back to steps after the game refuses the engine command", () => {
    const w = world({ map: CORRIDOR, travelPath: (to: { x: number; y: number }) => [to] });
    const errand = run(w, autoexplore());
    errand.begin();
    const first = errand.step();
    if (isStop(first)) throw new Error(`expected a command, got ${first.stop.reason}`);
    expect(first.command.code).toBe("run");
    /* The same game turn means the run was refused, so the mission steps. */
    const second = errand.step();
    if (isStop(second)) throw new Error(`expected a command, got ${second.stop.reason}`);
    expect(second.command.code).toBe("walk");
  });
});

describe("fleeing", () => {
  const ROOM = ["#######", "#@...>#", "#.....#", "#.....#", "#######"];

  it("heads for the nearest staircase", () => {
    const w = world({ map: ROOM, monsters: [{ grid: { x: 1, y: 3 }, race: "cave orc", level: 10 }], travelPath: (to: { x: number; y: number }) => [to] });
    const plan = planFor(w, "retreat");
    expect(plan.step(w.view, w.act)).toEqual({ code: "walk", dir: 6 });
  });

  it("takes the stairs on arrival", () => {
    const w = world({ map: ROOM, monsters: [{ grid: { x: 1, y: 3 }, race: "cave orc", level: 10 }] });
    const plan = planFor(w, "retreat");
    plan.step(w.view, w.act);
    w.moveTo({ x: 5, y: 1 });
    expect(plan.step(w.view, w.act)).toEqual({ code: "descend" });
  });

  it("backs up four steps when no staircase is known", () => {
    const w = world({ map: ["########", "#......#", "#..@...#", "#......#", "########"], monsters: [{ grid: { x: 2, y: 2 }, race: "cave orc", level: 10, speed: 100 }] });
    const plan = planFor(w, "retreat");
    for (let i = 0; i < 4; i++) expect(plan.step(w.view, w.act)?.code).toBe("walk");
    expect(plan.step(w.view, w.act)).toBeNull();
  });

  it("says in the criteria where the retreat goes", () => {
    const withStairs = world({ map: ROOM, monsters: [{ grid: { x: 1, y: 3 }, race: "cave orc", level: 10 }] });
    const offers = asked(planner(withStairs).ask(withStairs.view)).context.offers;
    expect(offers.find((o) => o.goal === "retreat")?.criteria).toContain("staircase");

    const noStairs = world({ map: ["########", "#......#", "#..@...#", "#......#", "########"], monsters: [{ grid: { x: 2, y: 2 }, race: "cave orc", level: 10, speed: 100 }] });
    const away = asked(planner(noStairs).ask(noStairs.view)).context.offers;
    expect(away.find((o) => o.goal === "retreat")?.criteria).toContain("four steps");
  });
});
