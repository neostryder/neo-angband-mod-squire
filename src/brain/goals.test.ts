import { describe, expect, it } from "vitest";
import { world } from "../harness.js";
import { defaultCfg } from "../settings.js";
import type { Answer, ChoiceQuestion } from "./systemone.js";
import { createGoalPlanner, healthBand, RECALL_WAIT_TURNS, recallPending, threatIndex, type GoalDigest } from "./goals.js";
import { archetype, defaultPersona } from "../persona/persona.js";
import type { Question } from "./brain.js";
import type { AgentView, LoadoutSimulation } from "@rpgm-tools/neo-angband-core";
import { gearCandidates } from "../gear/compare.js";
import { goalLabel, goalOfCommand } from "../knight.js";

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

  it("offers no escape from an easy creature at good health", () => {
    const w = world({ map: CORRIDOR, player: { hp: 20, maxHp: 20, level: 10 }, monsters: [{ grid: { x: 5, y: 1 }, race: "giant white mouse", level: 1 }] });
    const { p } = planner(w);
    const goals = asked(p.ask(w.view)).context.offers.map((o) => o.goal);
    expect(goals).toContain("fight");
    expect(goals).not.toContain("retreat");
  });

  it("offers rest when hurt with nothing awake in sight", () => {
    const w = world({ map: CORRIDOR, player: { hp: 10, maxHp: 20 } });
    const { p } = planner(w);
    expect(asked(p.ask(w.view)).context.offers.map((o) => o.goal)).toContain("rest");
  });

  it("does not offer to explore ground it cannot reach", () => {
    const w = world({ map: ["######", "#@#. #", "######"] });
    expect(planner(w).p.ask(w.view)).toHaveProperty("handBack");
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

  it("lights a torch before exploring in the dark", () => {
    const w = world({ map: CORRIDOR, player: { light: 0 }, pack: ["2 Wooden Torches (5000 turns)"] });
    const goals = asked(planner(w).p.ask(w.view)).context.offers.map((o) => o.goal);
    expect(goals).toContain("wear");
    expect(goals).not.toContain("explore");
  });

  it("takes the likeliest offer once the errand order has nothing to do", () => {
    const w = world({ map: ["#####", "#.@.#", "#####"], player: { hp: 15, maxHp: 20 } });
    const { p, logged } = planner(w);
    const none = (): Readonly<Record<string, Answer>> => ({ goal: { type: "choice", choice: "none_of_these", confidence: 0.9, probabilities: { rest: 0.3, none_of_these: 0.7 } } });
    const first = p.choose(none(), asked(p.ask(w.view)).context, w.view);
    if (!("plan" in first)) throw new Error("expected a plan");
    expect(first.plan.step(w.view, w.act)).toBeNull();
    const q = asked(p.ask(w.view));
    expect(q.context.offers.map((o) => o.goal)).toContain("rest");
    const second = p.choose(none(), q.context, w.view);
    if (!("plan" in second)) throw new Error("expected a plan");
    expect(logged.at(-1)).toContain("taking rest");
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

  it("keeps a plan when a creature already seen on this level steps back into view", () => {
    const dog = { grid: { x: 6, y: 1 }, race: "scruffy little dog", asleep: true };
    const w = world({ map: CORRIDOR, monsters: [dog] });
    const { p } = planner(w);
    asked(p.ask(w.view));
    w.setMonsters([{ ...dog, visible: false }]);
    const choice = p.choose(pick("explore"), asked(p.ask(w.view)).context, w.view);
    if (!("plan" in choice)) throw new Error("expected a plan");
    w.setMonsters([dog]);
    expect(p.trigger(w.view, choice.plan)).toBeNull();
  });

  it("takes the safest option on none_of_these when the character is hurt", () => {
    const w = world({ map: CORRIDOR, player: { hp: 4, maxHp: 10 }, monsters: [{ grid: { x: 4, y: 1 }, race: "cave orc", level: 7 }] });
    const { p, logged } = planner(w);
    const q = asked(p.ask(w.view));
    const fallback = p.choose(pick("none_of_these"), q.context, w.view);
    expect(fallback).toHaveProperty("plan");
    const safest = [...q.context.offers].sort((a, b) => a.risk - b.risk)[0]!.goal;
    expect(logged.join(" ")).toContain(`taking the safest option (${safest})`);
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

  it("offers no scroll or spell while confused, but keeps oil and melee", () => {
    const w = world({
      map: CORRIDOR,
      monsters: ORC,
      player: { sp: 5, maxSp: 5, status: { confused: 5 } },
      pack: ["5 Scrolls of Phase Door", "a Scroll of Teleportation", "4 Flasks of Oil"],
      spells: [{ name: "Magic Missile", sidx: 0 }],
    });
    const goals = asked(planner(w).p.ask(w.view)).context.offers.map((o) => o.goal);
    expect(goals).toEqual(expect.arrayContaining(["fight", "throw_oil"]));
    expect(goals).not.toContain("cast_attack");
    expect(goals).not.toContain("phase");
    expect(goals).not.toContain("teleport");
  });

  it("leaves out a goal whose plan issued a command but passed no game time", () => {
    const w = world({
      map: CORRIDOR,
      monsters: ORC,
      player: { sp: 5, maxSp: 5 },
      spells: [{ name: "Magic Missile", sidx: 0 }],
    });
    const { p } = planner(w);
    const q = asked(p.ask(w.view));
    const choice = p.choose(pick("cast_attack"), q.context, w.view);
    if (!("plan" in choice)) throw new Error("expected a plan");
    let command = choice.plan.step(w.view, w.act);
    let guard = 0;
    while (command !== null && guard++ < 5) command = choice.plan.step(w.view, w.act);
    expect(asked(p.ask(w.view)).context.offers.map((o) => o.goal)).not.toContain("cast_attack");
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

  it("offers to study an unlearned spell from a carried book, once per level", () => {
    const w = world({ map: CORRIDOR, pack: ["a Book of Magic Spells [Magic for Beginners]"], spells: [{ name: "Magic Missile", sidx: 0, learned: false }] });
    const { p } = planner(w);
    const q = asked(p.ask(w.view));
    expect(q.context.offers.map((o) => o.goal)).toContain("study");
    const choice = p.choose(pick("study"), q.context, w.view);
    if (!("plan" in choice)) throw new Error("expected a plan");
    expect(choice.plan.step(w.view, w.act)).toMatchObject({ code: "study", args: { handle: 1, spell: 0 } });
    expect(asked(p.ask(w.view)).context.offers.map((o) => o.goal)).not.toContain("study");
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
    const w = world({ map: CORRIDOR, player: { depth: 6, maxDepth: 6, gold: 300 }, pack: ["a Scroll of Word of Recall"] });
    const q = asked(planner(w).p.ask(w.view));
    expect(q.context.offers.find((offer) => offer.goal === "recall_town")?.criteria).toContain("low on Cure Light Wounds");
  });

  it("does not read recall again while one is under way", () => {
    const w = world({ map: CORRIDOR, player: { depth: 6, maxDepth: 6, gold: 300 }, pack: ["a Scroll of Word of Recall", "a Scroll of Word of Recall"] });
    const { p } = planner(w);
    const q = asked(p.ask(w.view));
    const choice = p.choose(pick("recall_town"), q.context, w.view);
    if (!("plan" in choice)) throw new Error("expected a plan");
    expect(asked(p.ask(w.view)).context.offers.map((offer) => offer.goal)).not.toContain("recall_town");
  });

  it("trusts the recall timer when the game reports one", () => {
    expect(recallPending({ depth: 6, recall: 12 }, null, 0)).toBe(true);
    expect(recallPending({ depth: 6, recall: 0 }, { turn: 0, depth: 6 }, 10)).toBe(false);
    expect(recallPending({ depth: 6 }, { turn: 0, depth: 6 }, 10)).toBe(true);
    expect(recallPending({ depth: 0 }, { turn: 0, depth: 6 }, 10)).toBe(false);
    expect(recallPending({ depth: 6 }, { turn: 0, depth: 6 }, RECALL_WAIT_TURNS + 1)).toBe(false);
  });

  it("does not recall home near the surface or with no gold to spend", () => {
    for (const player of [{ depth: 2, maxDepth: 2, gold: 300 }, { depth: 6, maxDepth: 6, gold: 10 }]) {
      const w = world({ map: CORRIDOR, player, pack: ["a Scroll of Word of Recall"] });
      expect(asked(planner(w).p.ask(w.view)).context.offers.map((offer) => offer.goal)).not.toContain("recall_town");
    }
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

  it("takes the town stairs with a recall scroll but no depth to return to", () => {
    const w = world({ map: ["#####", "#@>##", "#####"], player: { depth: 0, maxDepth: 0, gold: 0 }, pack: ["a Scroll of Word of Recall"] });
    const goals = asked(planner(w).p.ask(w.view)).context.offers.map((offer) => offer.goal);
    expect(goals).toContain("descend");
    expect(goals).not.toContain("recall_dungeon");
  });
});

describe("gear and detection", () => {
  /** The fake derives only a visible, fully known change; no hidden item fields are used. */
  function simulatedView(w: ReturnType<typeof world>, acChange: number, afterEquipment = w.view.equipment(), manaChange = 0): AgentView {
    const before = w.view.player();
    const after = { ...before, ac: before.ac + acChange, maxSp: before.maxSp + manaChange };
    const simulation = {
      before: { player: before, equipment: w.view.equipment(), stats: { resists: [], resistElements: [] } },
      after: { player: after, equipment: afterEquipment, stats: { resists: [], resistElements: [] } },
      delta: { ac: acChange, toH: 0, toD: 0, blows: 0, shots: 0, speed: 0, maxHp: 0, maxSp: manaChange, light: 0, resists: [] },
      placements: [{ slot: 0, worn: w.view.inventory()[0], displaced: w.view.equipment()[0] ?? null }],
      unresolved: [],
    } as unknown as LoadoutSimulation;
    return { ...w.view, simulateLoadout: () => simulation };
  }

  it("offers a clear upgrade and wears it once", () => {
    const w = world({ map: CORRIDOR, pack: ["Leather Armour [8,+2]"], worn: ["Leather Armour [2,+0]"] });
    const view = simulatedView(w, 6);
    const { p } = planner(w);
    const q = asked(p.ask(view));
    expect(q.context.offers.find((o) => o.goal === "wear")?.criteria).toContain("armour class 16 instead of 10");
    const choice = p.choose(pick("wear"), q.context, view);
    if (!("plan" in choice)) throw new Error("expected a plan");
    expect(choice.plan.step(view, w.act)).toEqual({ code: "wield", args: { handle: 1 } });
    expect(choice.plan.step(view, w.act)).toBeNull();
  });

  it("does not offer a worse known item", () => {
    const w = world({ map: CORRIDOR, pack: ["Leather Armour [2,+0]"], worn: ["Leather Armour [8,+2]"] });
    expect(asked(planner(w).p.ask(simulatedView(w, -6))).context.offers.map((o) => o.goal)).not.toContain("wear");
    const curious = defaultPersona();
    curious.sliders.curiosity = 90;
    const p = createGoalPlanner({ cfg: defaultCfg(), terrain: w.terrain, log: () => {}, persona: curious });
    expect(asked(p.ask(w.view)).context.offers.map((o) => o.goal)).not.toContain("wear");
  });

  it("counts a caster's mana loss against an armour gain", () => {
    const w = world({ map: CORRIDOR, pack: ["Leather Armour [8,+2]"], worn: ["Leather Armour [2,+0]"], player: { sp: 10, maxSp: 10 } });
    expect(gearCandidates(simulatedView(w, 6, w.view.equipment(), -10))).toEqual([]);
  });

  it("uses the shown name when a loadout simulation is unavailable", () => {
    const w = world({ map: CORRIDOR, pack: ["Leather Armour [8,+2]"], worn: ["Leather Armour [2,+0]"] });
    const view: AgentView = { ...w.view, simulateLoadout: () => null };
    expect(gearCandidates(view)[0]).toMatchObject({ unknown: true, handle: 1 });
  });

  it("tries an unknown item only when curious and never simulates its runes", () => {
    const w = world({ map: CORRIDOR, pack: ["Leather Shield [8] {??}"], worn: ["Leather Shield [4,+0]"] });
    const view: AgentView = { ...w.view, simulateLoadout: () => { throw new Error("unknown runes were simulated"); } };
    expect(asked(planner(w).p.ask(view)).context.offers.map((o) => o.goal)).not.toContain("wear");
    const curious = defaultPersona();
    curious.sliders.curiosity = 50;
    const p = createGoalPlanner({ cfg: defaultCfg(), terrain: w.terrain, log: () => {}, persona: curious });
    expect(asked(p.ask(view)).context.offers.find((o) => o.goal === "wear")?.criteria).toContain("unknown Leather Shield");
    const magical = world({ map: CORRIDOR, pack: ["Leather Shield [8,+2] {magical}"] });
    const magicalView: AgentView = { ...magical.view, simulateLoadout: () => { throw new Error("magical mark was simulated"); } };
    expect(gearCandidates(magicalView)[0]?.unknown).toBe(true);
  });

  it("does not replace a visibly cursed shield", () => {
    const w = world({ map: CORRIDOR, pack: ["Leather Shield [8,+3]"], worn: ["Leather Shield [4,+0] {cursed}"] });
    expect(gearCandidates(simulatedView(w, 8))).toEqual([]);
  });

  it("keeps the only launcher while carrying ammunition", () => {
    const w = world({ map: CORRIDOR, pack: ["Long Bow (x3) (+4,+4)", "20 Arrows"], worn: ["Short Bow (x2) (+0,+0)"] });
    const view = simulatedView(w, 8, []);
    expect(gearCandidates(view)).toEqual([]);
  });

  it("offers detection on arrival once and reads the scroll", () => {
    const w = world({ map: CORRIDOR, pack: ["a Scroll of Magic Mapping"] });
    const { p } = planner(w);
    const q = asked(p.ask(w.view));
    expect(q.context.offers.map((o) => o.goal)).toContain("detect");
    expect(asked(p.ask(w.view)).context.offers.map((o) => o.goal)).not.toContain("detect");
    const choice = p.choose(pick("detect"), q.context, w.view);
    if (!("plan" in choice)) throw new Error("expected a plan");
    expect(choice.plan.step(w.view, w.act)).toEqual({ code: "read", args: { handle: 1 } });
    w.setPlayer({ depth: 2 });
    expect(asked(p.ask(w.view)).context.offers.map((o) => o.goal)).toContain("detect");
  });

  it("waits to survey when an awake creature is in sight", () => {
    const w = world({ map: CORRIDOR, pack: ["a Rod of Detection"], monsters: [{ grid: { x: 5, y: 1 } }] });
    expect(asked(planner(w).p.ask(w.view)).context.offers.map((o) => o.goal)).not.toContain("detect");
  });

  it("zaps a known detection rod or casts a learned detection spell", () => {
    const rod = world({ map: CORRIDOR, pack: ["a Rod of Treasure Location"] });
    const rodPlanner = planner(rod).p;
    const rodChoice = rodPlanner.choose(pick("detect"), asked(rodPlanner.ask(rod.view)).context, rod.view);
    if (!("plan" in rodChoice)) throw new Error("expected a plan");
    expect(rodChoice.plan.step(rod.view, rod.act)).toEqual({ code: "zap-rod", args: { handle: 1 } });

    const mage = world({ map: CORRIDOR, player: { sp: 5, maxSp: 5 }, spells: [{ name: "Find Traps, Doors & Stairs", sidx: 7 }] });
    const magePlanner = planner(mage).p;
    const mageChoice = magePlanner.choose(pick("detect"), asked(magePlanner.ask(mage.view)).context, mage.view);
    if (!("plan" in mageChoice)) throw new Error("expected a plan");
    expect(mageChoice.plan.step(mage.view, mage.act)).toEqual({ code: "cast", args: { spell: 7 } });
    expect(goalOfCommand({ code: "cast", args: { spell: 7 } }, mage.view)).toBe("detect");
  });

  it("maps wear and detection commands from the player", () => {
    const w = world({ map: CORRIDOR, pack: ["Leather Shield [8]", "a Rod of Detection"] });
    expect(goalOfCommand({ code: "wield", args: { handle: 1 } }, w.view)).toBe("wear");
    expect(goalOfCommand({ code: "zap-rod", args: { handle: 2 } }, w.view)).toBe("detect");
    const scroll = world({ map: CORRIDOR, pack: ["a Scroll of Magic Mapping"] });
    expect(goalOfCommand({ code: "read", args: { handle: 1 } }, scroll.view)).toBe("detect");
    expect(goalLabel("wear")).toBe("wear gear");
  });
});
