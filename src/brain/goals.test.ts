import { describe, expect, it } from "vitest";
import { world } from "../harness.js";
import { defaultCfg } from "../settings.js";
import type { Answer, ChoiceQuestion } from "./systemone.js";
import { createGoalPlanner, healthBand, threatIndex, type GoalDigest } from "./goals.js";
import { archetype, defaultPersona } from "../persona/persona.js";
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

  it("fights when the model chose it while already under the retreat line", () => {
    const w = world({ map: CORRIDOR, player: { hp: 5, maxHp: 10 }, monsters: [{ grid: { x: 3, y: 1 }, race: "mean-looking mercenary" }] });
    const { p } = planner(w);
    const q = asked(p.ask(w.view));
    const choice = p.choose(pick("fight"), q.context, w.view);
    if (!("plan" in choice)) throw new Error("expected a plan");
    expect(choice.plan.step(w.view, w.act)).not.toBeNull();
  });

  it("explores when the model chose it with an awake creature in sight", () => {
    const w = world({ map: CORRIDOR, monsters: [{ grid: { x: 6, y: 1 }, race: "scruffy little dog" }] });
    const { p } = planner(w);
    const q = asked(p.ask(w.view));
    const choice = p.choose(pick("explore"), q.context, w.view);
    if (!("plan" in choice)) throw new Error("expected a plan");
    expect(choice.plan.step(w.view, w.act)).not.toBeNull();
  });

  it("leaves out a goal whose plan did nothing until the turn changes", () => {
    const w = world({ map: ["#######", "#.@#..#", "#.###.#", "#######"], monsters: [{ grid: { x: 4, y: 1 }, race: "cave orc" }] });
    const { p } = planner(w);
    const q = asked(p.ask(w.view));
    expect(q.context.offers.map((o) => o.goal)).toContain("fight");
    const choice = p.choose(pick("fight"), q.context, w.view);
    if (!("plan" in choice)) throw new Error("expected a plan");
    expect(choice.plan.step(w.view, w.act)).toBeNull();
    expect(asked(p.ask(w.view)).context.offers.map((o) => o.goal)).not.toContain("fight");
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

  it("calls a weak creature dangerous when one round could take the character's hit points", () => {
    const mercenary = { level: 0, raceFlags: [] };
    expect(threatIndex(mercenary, 1, 10)).toBe(0);
    expect(threatIndex(mercenary, 1, 5)).toBe(2);
    expect(threatIndex(mercenary, 1, 3)).toBe(3);
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

describe("persona", () => {
  const ORC = [{ grid: { x: 5, y: 1 }, race: "cave orc", level: 3 }];

  function withPersona(w: ReturnType<typeof world>, persona: ReturnType<typeof defaultPersona>) {
    return createGoalPlanner({ cfg: defaultCfg(), terrain: w.terrain, log: () => {}, persona, rng: () => 0.5 });
  }

  it("asks the in-character question and sends the persona", () => {
    const w = world({ map: CORRIDOR, monsters: ORC });
    const persona = archetype("berserker");
    const q = asked(withPersona(w, persona).ask(w.view));
    expect(Object.keys(q.request.questions)).toEqual(["goal", "in_character"]);
    expect(q.request.state["persona"]).toMatchObject({ name: persona.name });
  });

  it("follows its nature at full strength", () => {
    const w = world({ map: CORRIDOR, monsters: ORC });
    const persona = defaultPersona("Bold");
    persona.sliders.strength = 100;
    persona.sliders.volatility = 0;
    persona.sliders.selfpreservation = 0;
    const p = withPersona(w, persona);
    const q = asked(p.ask(w.view));
    const answers: Readonly<Record<string, Answer>> = {
      goal: { type: "choice", choice: "retreat", confidence: 0.8, probabilities: { retreat: 0.8, fight: 0.2 } },
      in_character: { type: "choice", choice: "fight", confidence: 0.9, probabilities: { fight: 0.9, retreat: 0.1 } },
    };
    const choice = p.choose(answers, q.context, w.view);
    expect("plan" in choice && choice.plan.label).toBe("fight");
    expect(q.context.trace).toMatchObject({ advice: "retreat", pick: "fight" });
  });

  it("lets the safety floor overrule a reckless nature", () => {
    const w = world({ map: CORRIDOR, player: { hp: 2, maxHp: 40 }, monsters: [{ grid: { x: 4, y: 1 }, race: "Grip, Farmer Maggot's Dog", level: 30 }] });
    const persona = defaultPersona("Careful");
    persona.sliders.strength = 100;
    persona.sliders.volatility = 0;
    persona.sliders.selfpreservation = 100;
    const p = withPersona(w, persona);
    const q = asked(p.ask(w.view));
    const answers: Readonly<Record<string, Answer>> = {
      goal: { type: "choice", choice: "retreat", confidence: 0.6, probabilities: { retreat: 0.6, fight: 0.4 } },
      in_character: { type: "choice", choice: "fight", confidence: 1, probabilities: { fight: 1 } },
    };
    const choice = p.choose(answers, q.context, w.view);
    expect("plan" in choice && choice.plan.label).toBe("back away");
    expect(q.context.trace?.removed).toContain("fight");
  });

  it("picks up everything when compulsive", () => {
    const w = world({ map: ["#####", "#@*.#", "#####"] });
    w.moveTo({ x: 2, y: 1 });
    const persona = defaultPersona("Magpie");
    persona.quirks.compulsive.on = true;
    const p = withPersona(w, persona);
    const q = asked(p.ask(w.view));
    const choice = p.choose(pick("explore"), q.context, w.view);
    expect("plan" in choice && choice.plan.label).toBe("pick up");
  });
});

describe("town goals", () => {
  it("offers recall to town when dungeon supplies run low", () => {
    const w = world({ map: CORRIDOR, pack: ["a Scroll of Word of Recall"] });
    const q = asked(planner(w).p.ask(w.view));
    expect(q.context.offers.find((offer) => offer.goal === "recall_town")?.criteria).toContain("low on Cure Light Wounds");
  });

  it("offers shopping from mapped entrances without reading store stock", () => {
    const w = world({ map: ["#####", "#@.A#", "#####"], player: { depth: 0, maxDepth: 5 } });
    const view = { ...w.view, stores: () => { throw new Error("stock read outside store"); } };
    const q = asked(planner(w).p.ask(view));
    expect(q.context.offers.map((offer) => offer.goal)).toContain("shop");
    expect(q.context.offers.map((offer) => offer.goal)).not.toContain("recall_dungeon");
  });

  it("offers recall back down when shopping is finished", () => {
    const w = world({ map: ["###", "#@#", "###"], player: { depth: 0, maxDepth: 5 }, pack: ["a Scroll of Word of Recall"] });
    const q = asked(planner(w).p.ask(w.view));
    expect(q.context.offers.find((offer) => offer.goal === "recall_dungeon")?.criteria).toContain("250 ft");
  });

  it("offers town stairs when there is no scroll or gold", () => {
    const w = world({ map: ["#####", "#@>##", "#####"], player: { depth: 0, gold: 0 } });
    expect(asked(planner(w).p.ask(w.view)).context.offers.map((offer) => offer.goal)).toContain("descend");
  });
});
