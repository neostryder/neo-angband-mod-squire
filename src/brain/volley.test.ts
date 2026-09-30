import { describe, expect, it } from "vitest";
import { world } from "../harness.js";
import { defaultCfg } from "../settings.js";
import { createGoalPlanner, type GoalDigest } from "./goals.js";
import type { Answer, ChoiceQuestion } from "./systemone.js";
import type { Question } from "./brain.js";

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

/** An archer in a corridor, with the engine able to report the line of fire. */
function archer(projectionPath: (to: { x: number; y: number }) => readonly { x: number; y: number }[]) {
  return world({
    map: CORRIDOR,
    monsters: [{ grid: { x: 5, y: 1 }, race: "cave orc" }],
    pack: ["99 Arrows"],
    worn: ["a Short Bow"],
    projectionPath,
  });
}

describe("volleys", () => {
  it("keeps firing at the held target without asking again", () => {
    const w = archer((to) => [to]);
    const p = planner(w);
    const q = asked(p.ask(w.view));
    expect((q.request.questions["goal"] as ChoiceQuestion).criteria).toHaveProperty("shoot");
    const choice = p.choose(pick("shoot"), q.context, w.view);
    if (!("plan" in choice)) throw new Error("expected a plan");
    expect(choice.plan.step(w.view, w.act)).toEqual({ code: "fire", args: { handle: 1 } });
    expect(choice.plan.step(w.view, w.act)).toEqual({ code: "fire", args: { handle: 1 } });
  });

  it("stops when the target dies", () => {
    const w = archer((to) => [to]);
    const p = planner(w);
    const choice = p.choose(pick("shoot"), asked(p.ask(w.view)).context, w.view);
    if (!("plan" in choice)) throw new Error("expected a plan");
    expect(choice.plan.step(w.view, w.act)).not.toBeNull();
    w.setMonsters([]);
    expect(choice.plan.step(w.view, w.act)).toBeNull();
  });

  it("stops when the target leaves sight", () => {
    const w = archer((to) => [to]);
    const p = planner(w);
    const choice = p.choose(pick("shoot"), asked(p.ask(w.view)).context, w.view);
    if (!("plan" in choice)) throw new Error("expected a plan");
    w.setMonsters([{ grid: { x: 5, y: 1 }, race: "cave orc", visible: false }]);
    expect(choice.plan.step(w.view, w.act)).toBeNull();
  });

  it("stops when the line of fire closes", () => {
    let blocked = false;
    const w = archer((to) => (blocked ? [{ x: 4, y: 1 }] : [to]));
    const p = planner(w);
    const choice = p.choose(pick("shoot"), asked(p.ask(w.view)).context, w.view);
    if (!("plan" in choice)) throw new Error("expected a plan");
    expect(choice.plan.step(w.view, w.act)).not.toBeNull();
    blocked = true;
    expect(choice.plan.step(w.view, w.act)).toBeNull();
  });

  it("stops when the ammunition runs out", () => {
    const w = archer((to) => [to]);
    const p = planner(w);
    const choice = p.choose(pick("shoot"), asked(p.ask(w.view)).context, w.view);
    if (!("plan" in choice)) throw new Error("expected a plan");
    expect(choice.plan.step(w.view, w.act)).not.toBeNull();
    w.setPack([]);
    expect(choice.plan.step(w.view, w.act)).toBeNull();
  });

  it("stops when the mana runs out", () => {
    const w = world({
      map: CORRIDOR,
      monsters: [{ grid: { x: 5, y: 1 }, race: "cave orc", level: 3 }],
      player: { sp: 5, maxSp: 5 },
      spells: [{ name: "Magic Missile", sidx: 0, mana: 2 }],
      projectionPath: (to) => [to],
    });
    const p = planner(w);
    const choice = p.choose(pick("cast_attack"), asked(p.ask(w.view)).context, w.view);
    if (!("plan" in choice)) throw new Error("expected a plan");
    expect(choice.plan.step(w.view, w.act)).toEqual({ code: "cast", args: { spell: 0 } });
    w.setPlayer({ sp: 1 });
    expect(choice.plan.step(w.view, w.act)).toBeNull();
  });

  it("casts a ball spell once, so each cast is aimed afresh", () => {
    const w = world({
      map: CORRIDOR,
      monsters: [{ grid: { x: 5, y: 1 }, race: "cave orc", level: 3 }],
      player: { sp: 20, maxSp: 20 },
      spells: [{ name: "Stinking Cloud", sidx: 4, mana: 3 }],
      projectionPath: (to) => [to],
    });
    const p = planner(w);
    const choice = p.choose(pick("cast_attack"), asked(p.ask(w.view)).context, w.view);
    if (!("plan" in choice)) throw new Error("expected a plan");
    expect(choice.plan.step(w.view, w.act)).toEqual({ code: "cast", args: { spell: 4 } });
    expect(choice.plan.step(w.view, w.act)).toBeNull();
  });

  it("stops when the watcher reports news", () => {
    const w = archer((to) => [to]);
    const p = planner(w);
    const choice = p.choose(pick("shoot"), asked(p.ask(w.view)).context, w.view);
    if (!("plan" in choice)) throw new Error("expected a plan");
    w.setMonsters([
      { grid: { x: 5, y: 1 }, race: "cave orc" },
      { grid: { x: 6, y: 1 }, race: "cave spider" },
    ]);
    expect(p.trigger(w.view, choice.plan)).toContain("cave spider");
  });

  it("fires one shot when the view cannot report the line of fire", () => {
    const w = world({
      map: CORRIDOR,
      monsters: [{ grid: { x: 5, y: 1 }, race: "cave orc" }],
      pack: ["99 Arrows"],
      worn: ["a Short Bow"],
    });
    const p = planner(w);
    const choice = p.choose(pick("shoot"), asked(p.ask(w.view)).context, w.view);
    if (!("plan" in choice)) throw new Error("expected a plan");
    expect(choice.plan.step(w.view, w.act)).toEqual({ code: "fire", args: { handle: 1 } });
    expect(choice.plan.step(w.view, w.act)).toBeNull();
  });
});
