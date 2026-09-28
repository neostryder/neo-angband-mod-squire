import { describe, expect, it } from "vitest";
import { world } from "../harness.js";
import { defaultCfg } from "../settings.js";
import type { Answer, ChoiceQuestion } from "./systemone.js";
import { createGoalPlanner, healthBand, type GoalDigest } from "./goals.js";
import type { Question } from "./brain.js";

const CORRIDOR = ["########", "#.@....#", "#.#### #", "########"];

function planner(w: ReturnType<typeof world>) {
  const logged: string[] = [];
  return { p: createGoalPlanner({ cfg: defaultCfg(), terrain: w.terrain, log: (m) => logged.push(m) }), logged };
}

function asked(q: ReturnType<ReturnType<typeof createGoalPlanner>["ask"]>): Question<GoalDigest> {
  if ("handBack" in q) throw new Error(`expected a question, got a hand-back: ${q.handBack}`);
  return q;
}

function pick(choice: string): Readonly<Record<string, Answer>> {
  return { goal: { type: "choice", choice, confidence: 0.9, probabilities: { [choice]: 0.9 } } };
}

describe("goal planner", () => {
  it("offers only the goals that fit, plus none_of_these", () => {
    const w = world({ map: CORRIDOR });
    const { p } = planner(w);
    const q = asked(p.ask(w.view));
    const goal = q.request.questions["goal"] as ChoiceQuestion;
    expect(Object.keys(goal.criteria)).toEqual(["explore", "none_of_these"]);
    expect(q.context.offers.map((o) => o.goal)).toEqual(["explore"]);
  });

  it("offers fight and retreat with an awake creature in sight, and no rest", () => {
    const w = world({ map: CORRIDOR, player: { hp: 10, maxHp: 20 }, monsters: [{ grid: { x: 5, y: 1 }, race: "cave orc" }] });
    const { p } = planner(w);
    const q = asked(p.ask(w.view));
    expect(q.context.offers.map((o) => o.goal)).toContain("fight");
    expect(q.context.offers.map((o) => o.goal)).toContain("retreat");
    expect(q.context.offers.map((o) => o.goal)).not.toContain("rest");
    expect(String(q.request.state["creatures"])).toContain("cave orc");
  });

  it("offers rest when hurt with nothing awake in sight", () => {
    const w = world({ map: CORRIDOR, player: { hp: 10, maxHp: 20 } });
    const { p } = planner(w);
    expect(asked(p.ask(w.view)).context.offers.map((o) => o.goal)).toContain("rest");
  });

  it("hands back when there is nothing to do", () => {
    const w = world({ map: ["###", "#@#", "###"] });
    const { p } = planner(w);
    expect(p.ask(w.view)).toHaveProperty("handBack");
  });

  it("turns an explore answer into a plan that walks", () => {
    const w = world({ map: CORRIDOR });
    const { p } = planner(w);
    const q = asked(p.ask(w.view));
    const choice = p.choose(pick("explore"), q.context, w.view);
    if (!("plan" in choice)) throw new Error("expected a plan");
    expect(choice.plan.step(w.view, w.act)).toEqual({ code: "walk", dir: 6 });
  });

  it("falls back to the errand order on none_of_these, and hands back on a goal it did not offer", () => {
    const w = world({ map: CORRIDOR });
    const { p } = planner(w);
    const q = asked(p.ask(w.view));
    const fallback = p.choose(pick("none_of_these"), q.context, w.view);
    if (!("plan" in fallback)) throw new Error("expected a plan");
    expect(fallback.plan.step(w.view, w.act)).toEqual({ code: "walk", dir: 6 });
    expect(p.choose(pick("fight"), q.context, w.view)).toHaveProperty("handBack");
  });

  it("offers a fight against a sleeping creature", () => {
    const w = world({ map: CORRIDOR, monsters: [{ grid: { x: 5, y: 1 }, race: "cave orc", asleep: true }] });
    const { p } = planner(w);
    const q = asked(p.ask(w.view));
    expect(q.context.offers.map((o) => o.goal)).toContain("fight");
    expect(String(q.request.state["creatures"])).toContain("asleep");
  });

  it("rests once, then asks again", () => {
    const w = world({ map: CORRIDOR, player: { hp: 10, maxHp: 20 } });
    const { p } = planner(w);
    const choice = p.choose(pick("rest"), asked(p.ask(w.view)).context, w.view);
    if (!("plan" in choice)) throw new Error("expected a plan");
    expect(choice.plan.step(w.view, w.act)).not.toBeNull();
    expect(choice.plan.step(w.view, w.act)).toBeNull();
  });

  it("drops a plan when a new creature comes into view", () => {
    const w = world({ map: CORRIDOR });
    const { p } = planner(w);
    const choice = p.choose(pick("explore"), asked(p.ask(w.view)).context, w.view);
    if (!("plan" in choice)) throw new Error("expected a plan");
    expect(p.trigger(w.view, choice.plan)).toBeNull();
    w.setMonsters([{ grid: { x: 6, y: 1 }, race: "jackal" }]);
    expect(p.trigger(w.view, choice.plan)).not.toBeNull();
  });

  it("names health in words", () => {
    expect(healthBand(20, 20)).toBe("full");
    expect(healthBand(13, 20)).toBe("lightly hurt");
    expect(healthBand(8, 20)).toBe("badly hurt");
    expect(healthBand(3, 20)).toBe("near death");
  });
});

describe("items and spells", () => {
  const ORC = [{ grid: { x: 5, y: 1 }, race: "cave orc", level: 3 }];

  it("offers healing only when hurt, naming the potion", () => {
    const pack = ["3 Potions of Cure Light Wounds"];
    const full = world({ map: CORRIDOR, pack });
    expect(asked(planner(full).p.ask(full.view)).context.offers.map((o) => o.goal)).not.toContain("heal");
    const hurt = world({ map: CORRIDOR, pack, player: { hp: 5, maxHp: 20 } });
    const q = asked(planner(hurt).p.ask(hurt.view));
    expect(q.context.offers.find((o) => o.goal === "heal")?.criteria).toContain("Cure Light Wounds");
  });

  it("drinks the strongest healing potion", () => {
    const w = world({ map: CORRIDOR, pack: ["a Potion of Cure Light Wounds", "a Potion of Cure Serious Wounds"], player: { hp: 5, maxHp: 20 } });
    const { p } = planner(w);
    const choice = p.choose(pick("heal"), asked(p.ask(w.view)).context, w.view);
    if (!("plan" in choice)) throw new Error("expected a plan");
    expect(choice.plan.step(w.view, w.act)).toEqual({ code: "quaff", args: { handle: 2 } });
  });

  it("never uses an unidentified potion as a healing potion", () => {
    const w = world({ map: CORRIDOR, pack: ["a Light Blue Potion"], player: { hp: 5, maxHp: 20 } });
    expect(asked(planner(w).p.ask(w.view)).context.offers.map((o) => o.goal)).not.toContain("heal");
  });

  it("offers phase, teleport, oil and an attack spell in a fight", () => {
    const w = world({
      map: CORRIDOR,
      monsters: ORC,
      player: { sp: 5, maxSp: 5 },
      pack: ["5 Scrolls of Phase Door", "a Scroll of Teleportation", "4 Flasks of Oil"],
      spells: [{ name: "Magic Missile", sidx: 0 }],
    });
    const goals = asked(planner(w).p.ask(w.view)).context.offers.map((o) => o.goal);
    expect(goals).toEqual(expect.arrayContaining(["fight", "throw_oil", "cast_attack", "phase", "teleport", "retreat"]));
  });

  it("targets the creature before throwing oil", () => {
    const w = world({ map: CORRIDOR, monsters: ORC, pack: ["4 Flasks of Oil"] });
    const { p } = planner(w);
    const choice = p.choose(pick("throw_oil"), asked(p.ask(w.view)).context, w.view);
    if (!("plan" in choice)) throw new Error("expected a plan");
    expect(choice.plan.step(w.view, w.act)).toEqual({ code: "throw", args: { handle: 1 } });
  });

  it("rates standing and fighting riskier when hurt", () => {
    const fresh = world({ map: CORRIDOR, monsters: ORC });
    const hurt = world({ map: CORRIDOR, monsters: ORC, player: { hp: 3, maxHp: 20 } });
    const risk = (w: ReturnType<typeof world>) =>
      asked(planner(w).p.ask(w.view)).context.offers.find((o) => o.goal === "fight")?.risk ?? 0;
    expect(risk(hurt)).toBeGreaterThan(risk(fresh));
  });

  it("offers food only when hungry", () => {
    const w = world({ map: CORRIDOR, pack: ["2 Rations of Food"], player: { status: { food: 900 } } });
    expect(asked(planner(w).p.ask(w.view)).context.offers.map((o) => o.goal)).toContain("eat");
  });
});
