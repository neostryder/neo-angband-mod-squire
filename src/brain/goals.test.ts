import { describe, expect, it, vi } from "vitest";
import { suppliedWorld, world, type WorldSpec } from "../harness.js";
import { defaultCfg } from "../settings.js";
import type { Answer, ChoiceQuestion } from "./systemone.js";
import { createGoalPlanner, healthBand, RECALL_WAIT_TURNS, recallPending, threatIndex, type GoalDigest } from "./goals.js";
import { archetype, defaultPersona } from "../persona/persona.js";
import { createBrain, type Question, type Reflex } from "./brain.js";
import { JEV } from "./backend.js";
import { harmlessKind } from "./threat-model.js";
import { createTally } from "./tally.js";
import type { AgentView, LoadoutSimulation } from "@rpgm-tools/neo-angband-core";
import { gearCandidates } from "../gear/compare.js";
import { goalLabel, goalOfCommand } from "../knight.js";
import { healingAmount } from "./combat-kit.js";
import { pursuitsFor } from "../strategy/pursuits.js";
import { createJourney } from "../strategy/journey.js";

const CORRIDOR = ["########", "#.@....#", "#.#### #", "########"];

describe("unseen attackers", () => {
  const map = ["#########", "#<.@...,#", "#########"];

  function hit(w: ReturnType<typeof world>, p: ReturnType<typeof createGoalPlanner>, damage = 4) {
    p.ask(w.view);
    w.advance(10);
    w.setPlayer({ hp: w.view.player().hp - damage });
    return asked(p.ask(w.view));
  }

  it.each([
    ["a Staff of Dispel Evil (3 charges)", "unseen_staff", "use"],
    ["a Staff of Sleep Monsters (3 charges)", "unseen_staff", "use"],
    ["a Staff of Mapping (3 charges)", "unseen_staff", "use"],
    ["a Wand of Fire Ball (3 charges)", "unseen_wand", "aim"],
    ["a Wand of Fire Balls (3 charges)", "unseen_wand", "aim"],
    ["a Wand of Magic Missile (3 charges)", "unseen_wand", "aim"],
    ["a Rod of Detection", "unseen_rod", "zap-rod"],
    ["a Rod of Illumination", "unseen_rod", "zap-rod"],
    ["a Rod of Light", "unseen_rod", "zap-rod"],
    ["a Rod of Frost Bolt", "unseen_rod", "zap-rod"],
    ["a Rod of Frost Bolts", "unseen_rod", "zap-rod"],
    ["a Rod of Fire Ball", "unseen_rod", "zap-rod"],
    ["a Rod of Fire Balls", "unseen_rod", "zap-rod"],
  ])("offers %s without a visible target", (item, goal, code) => {
    const w = suppliedWorld({ map, pack: [item] });
    const { p } = planner(w);
    const q = hit(w, p);
    expect(q.context.offers.find((o) => o.goal === goal)).toMatchObject({ uncertain: true, survival: 52 });
    const choice = p.choose(pick(goal), q.context, w.view);
    if (!("plan" in choice)) throw new Error("expected an unseen response");
    expect(choice.plan.step(w.view, w.act)).toEqual({ code, args: { handle: 1 } });
  });

  it("casts an area spell at a guessed adjacent position", () => {
    const w = suppliedWorld({ map, player: { sp: 10, maxSp: 10 }, spells: [{ name: "Stinking Cloud", sidx: 8, mana: 2 }] });
    const p = createGoalPlanner({ cfg: defaultCfg(), terrain: w.terrain, log: () => {}, reflex: false, rng: () => 0 });
    const q = hit(w, p);
    const target = vi.spyOn(w.act, "setTargetLocation");
    const choice = p.choose(pick("cast_area"), q.context, w.view);
    if (!("plan" in choice)) throw new Error("expected an area spell");
    expect(choice.plan.step(w.view, w.act)).toEqual({ code: "cast", args: { spell: 8 } });
    expect(target).toHaveBeenCalledWith(3, 2);
  });

  it("keeps aggression and caution in its own unseen-attacker choices", () => {
    const choose = (persona: ReturnType<typeof defaultPersona>) => {
      const w = suppliedWorld({ map, pack: ["a Rod of Detection"] });
      const p = createGoalPlanner({ cfg: defaultCfg(), terrain: w.terrain, log: () => {}, reflex: false, persona, rng: () => 0.5 });
      hit(w, p, 2);
      return reflexed(p.rules!(w.view, "own rules")).answers["goal"];
    };
    expect(choose(archetype("berserker"))).toMatchObject({ choice: "swing_unseen" });
    expect(choose({ ...defaultPersona(), sliders: { ...defaultPersona().sliders, boldness: 0 } })).toMatchObject({ choice: "detect" });
    expect(choose(archetype("coward"))).toMatchObject({ choice: expect.stringMatching(/^(?:phase|teleport|retreat|leave_level)$/) });
  });

  it.each([[0, 2], [0.5, 3], [0.99, 7]])("swings in a random adjacent direction for draw %s", (draw, dir) => {
    const w = suppliedWorld({ map });
    const p = createGoalPlanner({ cfg: defaultCfg(), terrain: w.terrain, log: () => {}, reflex: false, rng: () => draw });
    const q = hit(w, p);
    const choice = p.choose(pick("swing_unseen"), q.context, w.view);
    if (!("plan" in choice)) throw new Error("expected a swing");
    expect(choice.plan.step(w.view, w.act)).toEqual({ code: "melee", dir });
  });

  it("prefers the last observed attacker direction for swings and wands", () => {
    const w = suppliedWorld({ map, pack: ["a Wand of Frost Bolt (2 charges)"], monsters: [{ grid: { x: 4, y: 1 } }] });
    const { p } = planner(w);
    p.ask(w.view);
    w.advance(10);
    w.setMonsters([{ grid: { x: 4, y: 1 }, visible: false }]);
    w.setPlayer({ hp: 56 });
    const q = asked(p.ask(w.view));
    const target = vi.spyOn(w.act, "setTargetLocation");
    for (const goal of ["swing_unseen", "unseen_wand"]) {
      const choice = p.choose(pick(goal), q.context, w.view);
      if (!("plan" in choice)) throw new Error("expected an aimed response");
      const command = choice.plan.step(w.view, w.act);
      expect(command).toMatchObject(goal === "swing_unseen" ? { code: "melee", dir: 6 } : { code: "aim" });
    }
    expect(target).toHaveBeenCalledWith(4, 1);
  });

  it("does not invent unidentified or unavailable effects", () => {
    const w = suppliedWorld({ map, pack: ["a Silver Wand", "an Ash Staff", "a Copper Rod", "a Wand of Fire Ball (0 charges)", "a Rod of Detection (charging)"], player: { sp: 0, maxSp: 10 }, spells: [{ name: "Fire Ball", sidx: 9, mana: 5 }] });
    const { p } = planner(w);
    const q = hit(w, p);
    expect(offered(q)).not.toEqual(expect.arrayContaining(["unseen_staff", "unseen_wand", "unseen_rod", "cast_area"]));
    for (const goal of ["unseen_staff", "unseen_wand", "unseen_rod", "cast_area"]) expect(offered(q)).not.toContain(goal);
  });

  it("reads a device effect from inspection and leaves treasure detection out when it adds nothing", () => {
    const w = suppliedWorld({ map, pack: ["an Ash Staff", "a Rod of Treasure Location"], inspect: () => "When used, it sleeps monsters nearby." });
    const { p } = planner(w);
    const q = hit(w, p);
    expect(offered(q)).toContain("unseen_staff");
    expect(offered(q)).not.toContain("unseen_rod");
  });

  it("offers Treasure Location only as an earning lead on an unexplored floor with no known exit", () => {
    const w = suppliedWorld({ map: ["#########", "#..@...,#", "#########"], player: { gold: 0, depth: 1 }, pack: ["a Rod of Treasure Location"] });
    const { p } = planner(w);
    const q = hit(w, p);
    expect(q.context.offers.find((o) => o.goal === "unseen_rod")?.criteria).toContain("cannot reveal the attacker");
    const choice = p.choose(pick("unseen_rod"), q.context, w.view);
    if (!("plan" in choice)) throw new Error("expected a treasure survey");
    expect(choice.plan.step(w.view, w.act)).toEqual({ code: "zap-rod", args: { handle: 1 } });
  });

  it.each([
    ["a Scroll of Detect Invisible", "detect", "read"],
    ["a Rod of Detection", "detect", "zap-rod"],
    ["a Staff of Detect Evil (3 charges)", "detect", "use"],
    ["a Potion of True Seeing", "see_invisible", "quaff"],
    ["a Scroll of See Invisible", "see_invisible", "read"],
    ["a Rod of Illumination", "light_room", "zap-rod"],
  ])("offers and uses %s after an unseen hit", (item, goal, code) => {
    const w = suppliedWorld({ map, pack: [item] });
    const { p } = planner(w);
    const q = hit(w, p);
    expect(String(q.request.state["incoming"])).toContain("Up to 4 HP damage in one action and 8 in two");
    const offer = q.context.offers.find((o) => o.goal === goal);
    expect(offer?.risk).toBeGreaterThan(0.02);
    expect(offer?.routine).toBeUndefined();
    const choice = p.choose(pick(goal), q.context, w.view);
    if (!("plan" in choice)) throw new Error("expected a response plan");
    expect(choice.plan.step(w.view, w.act)).toEqual({ code, args: { handle: 1 } });
  });

  it("casts detection and uses an inspected activation", () => {
    const w = suppliedWorld({ map, player: { sp: 5, maxSp: 5 }, spells: [{ name: "Detect Monsters", sidx: 8, mana: 1 }] });
    const { p } = planner(w);
    const q = hit(w, p);
    const choice = p.choose(pick("detect"), q.context, w.view);
    if (!("plan" in choice)) throw new Error("expected a detection plan");
    expect(choice.plan.step(w.view, w.act)).toEqual({ code: "cast", args: { spell: 8 } });
    const a = suppliedWorld({ map, pack: ["a seeing stone"], activations: ["a seeing stone"], inspect: () => "When activated, it detects invisible creatures nearby." });
    const other = planner(a).p;
    const activated = other.choose(pick("detect"), hit(a, other).context, a.view);
    if (!("plan" in activated)) throw new Error("expected an activation plan");
    expect(activated.plan.step(a.view, a.act)).toEqual({ code: "activate", args: { handle: 1 } });
  });

  it("still offers retreat and a checked exit with no revealing source", () => {
    const w = suppliedWorld({ map });
    const { p } = planner(w);
    const q = hit(w, p);
    expect(offered(q)).toEqual(expect.arrayContaining(["retreat", "leave_level"]));
    expect(offered(q)).not.toContain("detect");
    expect(offered(q)).not.toContain("see_invisible");
    expect(offered(q)).not.toContain("light_room");
  });

  it.each([{ poisoned: 2 }, { cut: 10 }])("does not mistake ongoing status damage for an unseen attacker: %j", (status) => {
    const w = suppliedWorld({ map, player: { status }, pack: ["a Rod of Detection"] });
    const { p } = planner(w);
    expect(offered(hit(w, p))).not.toContain("detect");
  });

  it("offers light, a checked exit and a safer step without detection", () => {
    const w = suppliedWorld({ map, pack: ["a Staff of Light (2 charges)"] });
    const { p } = planner(w);
    const q = hit(w, p);
    expect(offered(q)).not.toContain("detect");
    expect(offered(q)).toEqual(expect.arrayContaining(["light_room", "leave_level", "retreat", "explore"]));
    for (const goal of ["leave_level", "retreat"]) {
      const choice = p.choose(pick(goal), q.context, w.view);
      if (!("plan" in choice)) throw new Error("expected a movement plan");
      expect(choice.plan.step(w.view, w.act)).toMatchObject({ code: "walk" });
    }
    expect(q.context.offers.find((o) => o.goal === "retreat")!.risk).toBeLessThan(q.context.offers.find((o) => o.goal === "explore")!.risk);
  });

  it("clears the memory when an awake visible creature can explain the hits", () => {
    const w = suppliedWorld({ map, pack: ["a Rod of Detection"] });
    const { p } = planner(w);
    expect(offered(hit(w, p))).toContain("detect");
    w.setMonsters([{ grid: { x: 4, y: 1 }, level: 1 }]);
    expect(offered(p.ask(w.view))).not.toContain("detect");
    w.setMonsters([]);
    w.advance(51);
    expect(offered(p.ask(w.view))).toContain("rest");
  });

  it("keeps the memory when a distant visible creature cannot explain the hits", () => {
    const w = suppliedWorld({ map: ["#############", "#<.@.......,#", "#############"], pack: ["a Rod of Detection"] });
    const { p } = planner(w);
    hit(w, p);
    w.setMonsters([{ grid: { x: 10, y: 1 }, level: 1 }]);
    expect(offered(p.ask(w.view))).toContain("detect");
  });

  it("keeps the memory when only poison accounts for a visible creature's damage bound", () => {
    const w = suppliedWorld({ map, pack: ["a Rod of Detection"] });
    const { p } = planner(w);
    hit(w, p, 1);
    w.setPlayer({ status: { poisoned: 10 } });
    w.setMonsters([{ grid: { x: 4, y: 1 }, level: 1, raceFlags: ["NEVER_BLOW"] }]);
    expect(offered(p.ask(w.view))).toContain("detect");
  });

  it("reduces regional danger with distance and time", () => {
    const w = suppliedWorld({ map, pack: ["a Rod of Detection"] });
    const { p } = planner(w);
    const risk = (q: Question<GoalDigest>) => q.context.offers.find((o) => o.goal === "detect")!.risk;
    const fresh = risk(hit(w, p));
    w.moveTo({ x: 4, y: 1 });
    const away = risk(asked(p.ask(w.view)));
    w.advance(25);
    const older = risk(asked(p.ask(w.view)));
    expect(away).toBeLessThan(fresh);
    expect(older).toBeLessThan(away);
    w.advance(26);
    expect(offered(p.ask(w.view))).not.toContain("detect");
    expect(offered(p.ask(w.view))).toContain("rest");
  });

  it("keeps exploration for small hits and gives the craven persona a stronger leave weight", () => {
    const weights = (persona: ReturnType<typeof defaultPersona>) => {
      const w = suppliedWorld({ map });
      const p = createGoalPlanner({ cfg: defaultCfg(), terrain: w.terrain, log: () => undefined, reflex: false, persona, rng: () => 0.5 });
      const q = hit(w, p, 2);
      expect(offered(q)).toContain("explore");
      const answer = { type: "choice" as const, choice: "explore", confidence: 0.5, probabilities: { explore: 0.5, leave_level: 0.5 } };
      p.choose({ goal: answer, in_character: answer }, q.context, w.view);
      return q.context.trace!.blended;
    };
    const bold = weights(archetype("berserker"));
    const craven = weights(archetype("coward"));
    expect(craven["leave_level"]).toBeGreaterThan(bold["leave_level"]!);
    expect(bold["explore"]).toBeGreaterThan(craven["explore"]!);
  });

  it("hands lethal two-action damage to survival offers and the safety floor", () => {
    const w = suppliedWorld({ map, player: { hp: 30, maxHp: 30 }, pack: ["a Rod of Detection"] });
    const p = createGoalPlanner({ cfg: defaultCfg(), terrain: w.terrain, log: () => undefined, reflex: false, persona: archetype("berserker"), rng: () => 0.5 });
    const q = hit(w, p, 12);
    expect(offered(q)).toEqual(expect.arrayContaining(["heal", "phase"]));
    expect(offered(q)).not.toContain("detect");
    expect(offered(q)).not.toContain("explore");
    const choice = p.choose(pick("phase"), q.context, w.view);
    if (!("plan" in choice)) throw new Error("expected a survival plan");
    expect(choice.plan.step(w.view, w.act)).toMatchObject({ code: "read" });
  });

  it("interrupts an exploration plan on the first small unseen hit", () => {
    const w = suppliedWorld({ map });
    const { p } = planner(w);
    const choice = p.choose(pick("explore"), asked(p.ask(w.view)).context, w.view);
    if (!("plan" in choice)) throw new Error("expected an exploration plan");
    w.setPlayer({ hp: 59 });
    w.advance(10);
    expect(p.trigger(w.view, choice.plan)).toBeTypeOf("string");
  });

  it("records the hit where a travelling plan is now standing", () => {
    const w = suppliedWorld({ map: ["##############", "#<.@........,#", "##############"], pack: ["a Rod of Detection"] });
    const { p } = planner(w);
    const choice = p.choose(pick("explore"), asked(p.ask(w.view)).context, w.view);
    if (!("plan" in choice)) throw new Error("expected an exploration plan");
    w.moveTo({ x: 9, y: 1 });
    w.setPlayer({ hp: 58 });
    w.advance(10);
    p.trigger(w.view, choice.plan);
    expect(offered(p.ask(w.view))).toContain("detect");
  });

  it("uses the only adequate cure as the existing survival reflex", () => {
    const w = world({ map, player: { hp: 30, maxHp: 30 }, pack: ["a Potion of Cure Light Wounds", "a Rod of Detection"] });
    const { p } = planner(w, true);
    p.ask(w.view);
    w.advance(10);
    w.setPlayer({ hp: 9 });
    const q = reflexed(p.ask(w.view));
    expect(q.context.offers.find((o) => o.goal === "heal")!.survival).toBeGreaterThan(0);
    expect(q.plan.step(w.view, w.act)).toEqual({ code: "quaff", args: { handle: 1 } });
  });

  it("preserves persona volatility when unseen harm nudges a blended choice", () => {
    const weight = (draw: number) => {
      const w = suppliedWorld({ map });
      const persona = defaultPersona();
      persona.sliders.strength = 50;
      persona.sliders.volatility = 100;
      const p = createGoalPlanner({ cfg: defaultCfg(), terrain: w.terrain, log: () => undefined, reflex: false, persona, rng: () => draw });
      const q = hit(w, p, 2);
      p.choose({ ...pick("explore"), in_character: pick("leave_level")["goal"]! }, q.context, w.view);
      return q.context.trace!;
    };
    const low = weight(0);
    const high = weight(1);
    expect(low.strength).toBe(0.25);
    expect(high.strength).toBe(0.75);
    expect(high.blended["leave_level"]).toBeGreaterThan(low.blended["leave_level"]!);
  });
});

describe("third soak survival regressions", () => {
  const grip = { grid: { x: 3, y: 1 }, race: "Grip, Farmer Maggot's Dog", level: 2, speed: 120, raceFlags: ["UNIQUE"] };
  const naga = { grid: { x: 3, y: 1 }, race: "black naga", level: 3, speed: 110 };
  const none: Readonly<Record<string, Answer>> = {
    goal: { type: "choice", choice: "none_of_these", confidence: 0.83, probabilities: { fight: 0.01, explore: 0.16, none_of_these: 0.83 } },
  };

  function fallback(w: ReturnType<typeof world>, p = planner(w).p) {
    const choice = p.choose(none, asked(p.ask(w.view)).context, w.view);
    if (!("plan" in choice)) throw new Error("expected a survival plan");
    return choice.plan;
  }

  it.each([110, 120])("rejects walking retreat from the dying warrior's adjacent cutpurse at speed %i", (speed) => {
    const w = world({ map: ["#########", "#.@....>#", "#########"], player: { level: 2, hp: 2, maxHp: 25, speed: 110 },
      monsters: [{ grid: { x: 3, y: 1 }, race: "cutpurse", level: 2, speed }], pack: ["a Ration of Food", "a Wooden Torch"] });
    const goals = offered(planner(w).p.ask(w.view));
    expect(goals).toContain("fight");
    expect(goals).not.toContain("retreat");
    expect(goals).not.toContain("leave_level");
    expect(fallback(w).step(w.view, w.act)).toEqual({ code: "melee", dir: 6 });
  });

  it("keeps retreat when the character can outrun the adjacent threat", () => {
    const w = world({ map: CORRIDOR, player: { level: 2, hp: 2, maxHp: 25, speed: 110 },
      monsters: [{ grid: { x: 3, y: 1 }, race: "cutpurse", level: 2, speed: 100 }] });
    expect(offered(planner(w).p.ask(w.view))).toContain("retreat");
    expect(fallback(w).step(w.view, w.act)).toEqual({ code: "walk", dir: 4 });
  });

  it("ends a retreat before a fast pursuer catches the character", () => {
    const w = world({ map: CORRIDOR, player: { level: 1, cls: "Rogue", hp: 2, maxHp: 14 }, monsters: [{ ...grip, grid: { x: 4, y: 1 } }] });
    const { p } = planner(w);
    const q = asked(p.ask(w.view));
    const choice = p.choose(pick("retreat"), q.context, w.view);
    if (!("plan" in choice)) throw new Error("expected a retreat plan");
    w.setMonsters([grip]);
    expect(choice.plan.step(w.view, w.act)).toBeNull();
    expect(offered(p.ask(w.view))).not.toContain("retreat");
  });

  it("takes stairs underfoot instead of walking toward a distant down staircase", () => {
    const w = world({ map: ["#########", "#<@....>#", "#.......#", "#########"], player: { level: 1, hp: 1, maxHp: 14 },
      monsters: [{ ...grip, grid: { x: 2, y: 2 } }] });
    w.moveTo({ x: 1, y: 1 });
    expect(fallback(w).step(w.view, w.act)).toEqual({ code: "ascend" });
  });

  it.each([
    ["a Scroll of Phase Door", "phase", "read"],
    ["a Scroll of Teleportation", "teleport", "read"],
    ["a Scroll of Teleport Level", "teleport", "read"],
    ["a Staff of Teleportation (3 charges)", "teleport", "use"],
    ["a Potion of Cure Light Wounds", "heal", "quaff"],
  ])("offers and uses %s when Grip has the dying rogue in melee", (item, goal, code) => {
    const w = world({ map: CORRIDOR, player: { level: 1, cls: "Rogue", hp: 1, maxHp: 14 }, monsters: [grip], pack: [item] });
    expect(offered(planner(w).p.ask(w.view))).toContain(goal);
    const plan = fallback(w);
    expect(plan.step(w.view, w.act)).toEqual({ code, args: { handle: 1 } });
  });

  it("offers recall without gold in the priest's last recorded situation and fights during immediate danger", () => {
    const w = world({ map: CORRIDOR, player: { cls: "Priest", level: 1, hp: 0, maxHp: 13, sp: 1, maxSp: 2, gold: 0 },
      monsters: [naga, { grid: { x: 5, y: 1 }, race: "cutpurse", level: 2 }], pack: ["a Scroll of Word of Recall"] });
    const { p, logged } = planner(w);
    const q = asked(p.ask(w.view));
    expect(q.context.offers.find((o) => o.goal === "recall_town")?.criteria).toContain("15 to 34 turns");
    expect(fallback(w, p).step(w.view, w.act)).toEqual({ code: "melee", dir: 6 });
    expect(logged).toContain("goal: none fit in danger, taking the survival fallback (fight)");
  });

  it("uses recall before the priest's naga reaches melee range", () => {
    const w = world({ map: CORRIDOR, player: { cls: "Priest", level: 1, hp: 1, maxHp: 13, gold: 0 },
      monsters: [{ ...naga, grid: { x: 5, y: 1 } }], pack: ["a Scroll of Word of Recall"] });
    expect(fallback(w).step(w.view, w.act)).toEqual({ code: "read", args: { handle: 1 } });
  });

  it("offers Deep Descent only while the priest has time before contact", () => {
    const w = world({ map: CORRIDOR, player: { cls: "Priest", level: 1, hp: 1, maxHp: 13, gold: 0 },
      monsters: [{ ...naga, grid: { x: 5, y: 1 } }], pack: ["a Scroll of Deep Descent"] });
    const { p } = planner(w);
    expect(offered(p.ask(w.view))).toContain("deep_descent");
    const choice = p.choose(pick("deep_descent"), asked(p.ask(w.view)).context, w.view);
    if (!("plan" in choice)) throw new Error("expected a descent plan");
    expect(choice.plan.step(w.view, w.act)).toEqual({ code: "read", args: { handle: 1 } });
    expect(goalOfCommand({ code: "read", args: { handle: 1 } }, w.view)).toBe("deep_descent");
    w.advance(10);
    expect(offered(p.ask(w.view))).not.toContain("deep_descent");
    w.setMonsters([naga]);
    expect(offered(planner(w).p.ask(w.view))).not.toContain("deep_descent");
  });

  it("keeps the warrior's healing potion usable when darkness prevents scroll reading", () => {
    const w = world({ map: CORRIDOR, player: { cls: "Warrior", level: 1, hp: 1, maxHp: 20, light: 0 }, monsters: [grip],
      pack: ["a Scroll of Phase Door", "a Scroll of Word of Recall", "a Scroll of Deep Descent", "a Potion of Cure Light Wounds"] });
    const goals = offered(planner(w).p.ask(w.view));
    expect(goals).not.toContain("phase");
    expect(goals).not.toContain("recall_town");
    expect(goals).not.toContain("deep_descent");
    expect(fallback(w).step(w.view, w.act)).toEqual({ code: "quaff", args: { handle: 4 } });
    w.setPlayer({ light: 2 });
    expect(offered(planner(w).p.ask(w.view))).toContain("phase");
  });

  it("issues a healing command on the same brain tick that receives none_of_these", async () => {
    const w = world({ map: CORRIDOR, player: { cls: "Rogue", level: 1, hp: 1, maxHp: 14 }, monsters: [grip], pack: ["a Potion of Cure Light Wounds"] });
    const { p, logged } = planner(w);
    let requests = 0;
    const brain = createBrain({ backend: JEV, planner: p, tally: createTally({ perSessionUsd: 0, perDayUsd: 0 }),
      send: async () => {
        requests += 1;
        return { ok: true, answers: none, usage: { inputTokens: 0, outputTokens: 0, estimated: false }, model: null, latencyMs: 0, server: "http://localhost:8010/v1/systemone" };
      },
      token: () => ({ epoch: 1, revision: 1 }), now: () => 0, log: (m) => logged.push(m), status: () => {} });
    expect(brain.controller(w.view, w.act)).toBeNull();
    await Promise.resolve();
    expect(brain.controller(w.view, w.act)).toEqual({ code: "quaff", args: { handle: 1 } });
    expect(requests).toBe(1);
    expect(logged).toContain("goal: none fit in danger, taking the survival fallback (heal)");
  });

  it.each([1, 2, 3])("leaves Grip's level on first sight at character level %i", (level) => {
    const w = world({ map: ["#########", "#<@....>#", "#########"], player: { cls: "Rogue", level, hp: 12, maxHp: 14 },
      monsters: [{ ...grip, grid: { x: 6, y: 1 } }], monsterRecall: () => "He can bite to hurt (1d4, 50%)." });
    const q = asked(planner(w).p.ask(w.view));
    expect(String(q.request.state["creatures"])).toContain("deadly, 4 steps away");
    expect(offered(q)).toContain("leave_level");
    expect(offered(q)).not.toContain("fight");
    expect(fallback(w).label).toBe("take the nearest stairs");
    expect(fallback(w).step(w.view, w.act)).toEqual({ code: "walk", dir: 4 });
  });
});

/** Reflexes are off unless a test is about them, so the rest see the question the model would get. */
function planner(w: ReturnType<typeof world>, reflex = false) {
  const logged: string[] = [];
  return { p: createGoalPlanner({ cfg: defaultCfg(), terrain: w.terrain, log: (m) => logged.push(m), reflex }), logged };
}

type Asked = ReturnType<ReturnType<typeof createGoalPlanner>["ask"]>;

function asked(q: Asked): Question<GoalDigest> {
  if ("handBack" in q) throw new Error(`expected a question, got a hand-back: ${q.handBack}`);
  if ("reflex" in q) throw new Error(`expected a question, got a reflex: ${q.reflex}`);
  return q;
}

/** A decision Squire made without asking the model. */
function reflexed(q: Asked): Reflex<GoalDigest> {
  if (!("reflex" in q)) throw new Error("expected a reflex");
  return q;
}

/** The goals on offer, whether Squire asked the model or not. */
function offered(q: Asked): string[] {
  if ("handBack" in q) throw new Error(`expected offers, got a hand-back: ${q.handBack}`);
  return q.context.offers.map((o) => o.goal);
}

function pick(choice: string): Readonly<Record<string, Answer>> {
  return { goal: { type: "choice", choice, confidence: 0.9, probabilities: { [choice]: 0.9 } } };
}

describe("combat safety action guards", () => {
  const grip = { grid: { x: 3, y: 1 }, race: "Grip, Farmer Maggot's Dog", level: 2, speed: 120, raceFlags: ["UNIQUE"] };
  const bite = () => "He can bite to hurt (1d4, 50%).";

  it.each([12, 10, 11])("rejects a losing cure at %i HP in the recorded Ranger fight", (hp) => {
    const w = world({ map: CORRIDOR, player: { cls: "Ranger", level: 1, hp, maxHp: 15 }, monsters: [grip], monsterRecall: bite, pack: ["a Potion of Cure Light Wounds"] });
    expect(offered(planner(w).p.ask(w.view))).not.toContain("heal");
  });

  it("forces the adequate cure at the Ranger's recorded 5 HP", () => {
    const w = world({ map: CORRIDOR, player: { cls: "Ranger", level: 1, hp: 5, maxHp: 15 }, monsters: [grip], monsterRecall: bite, pack: ["a Potion of Cure Light Wounds"] });
    const q = reflexed(planner(w, true).p.ask(w.view));
    expect(q.reflex).toBe("the only immediate survival option");
    expect(q.plan.step(w.view, w.act)).toEqual({ code: "quaff", args: { handle: 1 } });
  });

  it("spends the stronger cure when the light cure cannot survive the action", () => {
    const w = world({ map: CORRIDOR, player: { hp: 3, maxHp: 80 }, monsters: [grip], monsterRecall: () => "He can bite to hurt (1d13, 50%).", pack: ["a Potion of Cure Light Wounds", "a Potion of Cure Serious Wounds"] });
    const q = reflexed(planner(w, true).p.ask(w.view));
    expect(q.context.offers.find((o) => o.goal === "heal")?.criteria).toContain("Cure Serious Wounds");
    expect(q.plan.step(w.view, w.act)).toEqual({ code: "quaff", args: { handle: 2 } });
  });

  it("removes an inadequate cure and forces the remaining escape", () => {
    const w = world({ map: CORRIDOR, player: { hp: 3, maxHp: 20 }, monsters: [grip], monsterRecall: () => "He can bite to hurt (1d12, 50%).", pack: ["a Potion of Cure Light Wounds", "a Scroll of Phase Door"] });
    const q = reflexed(planner(w, true).p.ask(w.view));
    expect(offered(q)).not.toContain("heal");
    expect(q.answers["goal"]).toMatchObject({ choice: "phase" });
    expect(q.context.offers.find((o) => o.goal === "phase")?.uncertain).toBe(true);
  });

  it("keeps a dangerous cure when every available action remains dangerous", () => {
    const w = world({ map: CORRIDOR, player: { hp: 1, maxHp: 14 }, monsters: [grip], pack: ["a Potion of Cure Light Wounds"] });
    const q = asked(planner(w).p.ask(w.view));
    expect(q.context.offers.find((o) => o.goal === "heal")).toMatchObject({ risk: 1, survival: -14 });
  });

  it("leaves the choice between an adequate cure and a feasible phase with Jev", () => {
    const w = world({ map: CORRIDOR, player: { hp: 5, maxHp: 15 }, monsters: [grip], monsterRecall: bite, pack: ["a Potion of Cure Light Wounds", "a Scroll of Phase Door"] });
    const q = asked(planner(w, true).p.ask(w.view));
    expect(offered(q)).toEqual(expect.arrayContaining(["heal", "phase"]));
  });

  it("forces a reliable inspected healing spell and preserves its failure bound", () => {
    const w = world({ map: CORRIDOR, player: { hp: 3, maxHp: 20, sp: 4, maxSp: 4 }, monsters: [grip], monsterRecall: bite, spells: [{ name: "Cure Light Wounds", sidx: 9, mana: 1, fail: 0 }] });
    Object.assign(w.view, { spellInfo: () => ({ description: "Heals 15 hitpoints (or 15%, whichever is greater).", mana: 1, failChance: 0, canCastNow: true }) });
    const q = reflexed(planner(w, true).p.ask(w.view));
    expect(q.plan.step(w.view, w.act)).toEqual({ code: "cast", args: { spell: 9 } });
    Object.assign(w.view, { spellInfo: () => ({ description: "Heals 15 hitpoints.", mana: 1, failChance: 10, canCastNow: true }) });
    const uncertain = asked(planner(w, true).p.ask(w.view));
    expect(uncertain.context.offers.find((o) => o.goal === "cast_heal")).toMatchObject({ survival: -5, uncertain: true });
    Object.assign(w.view, { spellInfo: () => ({ description: "Heals 15 hitpoints.", mana: 1, failChance: 30, canCastNow: true }) });
    expect(offered(planner(w).p.ask(w.view))).not.toContain("cast_heal");
  });

  it("reads cure dice and percentages from the engine's displayed effect", () => {
    const w = world({ map: CORRIDOR, player: { hp: 10, maxHp: 110 }, pack: ["a Potion of Cure Light Wounds"], inspect: () => "When drunk, it heals 5+2d4 hitpoints (or 20%, whichever is greater)." });
    expect(healingAmount(w.view, { name: "a Potion of Cure Light Wounds", power: 1, handle: 1 })).toBe(20);
    w.setPlayer({ maxHp: 30 });
    expect(healingAmount(w.view, { name: "a Potion of Cure Light Wounds", power: 1, handle: 1 })).toBe(7);
  });

  it("rests instead of spending a potion during safe recovery", () => {
    const w = world({ map: CORRIDOR, player: { hp: 5, maxHp: 20, sp: 0, maxSp: 4 }, pack: ["a Potion of Cure Light Wounds"] });
    const goals = offered(planner(w).p.ask(w.view));
    expect(goals).toContain("rest");
    expect(goals).not.toContain("heal");
  });

  it.each(["poisoned", "cut"] as const)("blocks rest while %s costs HP", (status) => {
    const w = world({ map: CORRIDOR, player: { hp: 5, maxHp: 20, status: { [status]: 5 } }, pack: ["a Potion of Cure Light Wounds"] });
    expect(offered(planner(w).p.ask(w.view))).not.toContain("rest");
  });

  it("blocks recovery beside a sleeping breeder", () => {
    const w = world({ map: CORRIDOR, player: { hp: 10, maxHp: 20 }, monsters: [{ grid: { x: 5, y: 1 }, asleep: true, raceFlags: ["MULTIPLY"] }] });
    expect(offered(planner(w).p.ask(w.view))).not.toContain("rest");
  });

  it("remembers an observed attacker without reading its hidden location", () => {
    const w = suppliedWorld({ map: CORRIDOR, player: { hp: 30, maxHp: 40 }, monsters: [{ grid: { x: 3, y: 1 }, level: 0 }] });
    const { p } = planner(w);
    p.ask(w.view);
    w.setMonsters([{ grid: { x: 6, y: 1 }, visible: false, level: 90, speed: 190 }]);
    w.advance(10);
    const q = asked(p.ask(w.view));
    expect(offered(q)).not.toContain("rest");
    expect(String(q.request.state["incoming"])).toContain("Up to 8 HP damage");
    w.advance(51);
    expect(offered(p.ask(w.view))).toContain("rest");
  });

  it("blocks rest after an unexplained hit and expires the local uncertainty", () => {
    const w = suppliedWorld({ map: CORRIDOR, player: { hp: 20, maxHp: 20 } });
    const { p } = planner(w);
    p.ask(w.view);
    w.setPlayer({ hp: 17 });
    w.advance(10);
    const q = asked(p.ask(w.view));
    expect(offered(q)).not.toContain("rest");
    expect(String(q.request.state["incoming"])).toContain("Up to 3 HP damage in one action and 6 in two");
    w.advance(51);
    expect(offered(p.ask(w.view))).toContain("rest");
  });

  it("clears remembered danger when the level changes", () => {
    const w = world({ map: CORRIDOR, player: { hp: 30, maxHp: 40 }, monsters: [grip] });
    const { p } = planner(w);
    p.ask(w.view);
    w.setMonsters([]);
    w.setPlayer({ depth: 2 });
    expect(offered(p.ask(w.view))).toContain("rest");
  });

  it("rejects the recorded Ranger's Recall wait beside Grip", () => {
    const w = world({ map: CORRIDOR, player: { cls: "Ranger", level: 1, hp: 6, maxHp: 15, recall: 12 } as never, monsters: [grip], monsterRecall: bite });
    expect(offered(planner(w).p.ask(w.view))).not.toContain("wait");
  });

  it("prices opening a door before a ranged escape route", () => {
    const w = world({ map: ["########", "#@+...>#", "########"], player: { hp: 10, maxHp: 20 }, monsters: [{ grid: { x: 5, y: 1 }, race: "archer", raceFlags: ["NEVER_BLOW", "NEVER_MOVE"] }], monsterRecall: () => "It may cast spells which produce fire bolts (6).", messages: ["Omens of death haunt this place."] });
    expect(offered(planner(w).p.ask(w.view))).not.toContain("leave_level");
  });

  it("rechecks a stair plan before each walking command", () => {
    const w = suppliedWorld({ map: ["#######", "#@...>#", "#.....#", "#.....#", "#######"], player: { hp: 20, maxHp: 30 }, monsters: [{ grid: { x: 1, y: 3 }, level: 10, speed: 100 }], messages: ["Omens of death haunt this place."], travelPath: (to) => [to] });
    const { p } = planner(w);
    const choice = p.choose(pick("leave_level"), asked(p.ask(w.view)).context, w.view);
    if (!("plan" in choice)) throw new Error("expected a stair plan");
    expect(choice.plan.step(w.view, w.act)).toEqual({ code: "walk", dir: 6 });
    w.moveTo({ x: 2, y: 1 });
    w.advance(10);
    w.setMonsters([grip]);
    expect(choice.plan.step(w.view, w.act)).toBeNull();
  });

  it("forces the immediate staircase when the two exit offers share one action", () => {
    const w = suppliedWorld({ map: ["#########", "#<@.....#", "#.......#", "#########"], player: { level: 1, hp: 1, maxHp: 14 }, monsters: [{ ...grip, grid: { x: 2, y: 2 } }], monsterRecall: bite });
    w.setPack(["5 Rations of Food", "2 Wooden Torches"]);
    w.moveTo({ x: 1, y: 1 });
    expect(reflexed(planner(w, true).p.ask(w.view)).plan.step(w.view, w.act)).toEqual({ code: "ascend" });
  });

  it("compares an inspected attack with futile bat retreats", () => {
    const w = world({ map: CORRIDOR, player: { cls: "Mage", level: 1, hp: 1, maxHp: 10, sp: 2, maxSp: 2 }, monsters: [{ grid: { x: 3, y: 1 }, race: "fruit bat", hp: 2, maxHp: 2, level: 0, speed: 130 }], monsterRecall: () => "It can bite to hurt (1d1, 50%).", spells: [{ name: "Magic Missile", sidx: 0, mana: 1, fail: 0 }] });
    Object.assign(w.view, { spellInfo: () => ({ description: "Inflicts an average of 7.5 damage.", mana: 1, failChance: 0, canCastNow: true }) });
    const { p } = planner(w);
    const q = asked(p.ask(w.view));
    expect(offered(q)).not.toContain("retreat");
    const choice = p.choose(pick("none_of_these"), q.context, w.view);
    if (!("plan" in choice)) throw new Error("expected an attack plan");
    expect(choice.plan.step(w.view, w.act)).toEqual({ code: "cast", args: { spell: 0 } });
  });

  it("asks again after an HP change within the same health band", () => {
    const w = world({ map: CORRIDOR, player: { hp: 20, maxHp: 40 }, monsters: [{ grid: { x: 5, y: 1 }, level: 1 }], monsterRecall: () => "It can bite to hurt (1d1, 50%)." });
    const { p } = planner(w, true);
    p.choose(pick("fight"), asked(p.ask(w.view)).context, w.view);
    w.setPlayer({ hp: 19 });
    w.advance(10);
    expect(p.ask(w.view)).toHaveProperty("request");
  });
});

describe("goal planner", () => {
  it("offers only the goals that fit, plus none_of_these", () => {
    const w = suppliedWorld({ map: CORRIDOR });
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
    const goals = offered(p.ask(w.view));
    expect(goals).toContain("fight");
    expect(goals).not.toContain("retreat");
  });

  it("offers rest when hurt with nothing awake in sight", () => {
    const w = world({ map: CORRIDOR, player: { hp: 10, maxHp: 20 } });
    const { p } = planner(w);
    expect(offered(p.ask(w.view))).toContain("rest");
  });

  it("does not offer to explore ground it cannot reach", () => {
    const w = world({ map: ["######", "#@#. #", "######"] });
    expect(offered(planner(w).p.ask(w.view))).not.toContain("explore");
  });

  it("waits when there is nothing reachable to do", () => {
    const w = world({ map: ["###", "#@#", "###"] });
    const { p } = planner(w);
    expect(offered(p.ask(w.view))).toContain("wait");
  });

  it("tries another safe step after rest and wait are refused", () => {
    const w = suppliedWorld({ map: ["#####", "#.@.#", "#####"], player: { hp: 20, maxHp: 40, level: 5, maxLevel: 5 } });
    const { p, logged } = planner(w);
    const run = (goal: string) => {
      const q = asked(p.ask(w.view));
      expect(q.context.offers.map((o) => o.goal)).toEqual([goal]);
      const choice = p.choose(pick(goal), q.context, w.view);
      if (!("plan" in choice)) throw new Error("expected a plan");
      expect(choice.plan.step(w.view, w.act)).not.toBeNull();
      expect(choice.plan.step(w.view, w.act)).toBeNull();
    };
    run("rest");
    run("wait");
    const last = p.ask(w.view);
    expect(offered(last)).toContain("step_aside");
    const choice = p.choose({}, asked(last).context, w.view);
    if (!("plan" in choice)) throw new Error("expected another move");
    expect(choice.plan.step(w.view, w.act)).not.toBeNull();
    expect(logged.some((line) => line.includes("widens its choices"))).toBe(true);
  });

  it("tries another step when remembered ground cannot reach a known staircase", () => {
    const w = suppliedWorld({ map: ["#######", "#.@.#>#", "#######"], player: { depth: 0, maxDepth: 0, gold: 0 } });
    expect(offered(planner(w).p.ask(w.view))).toContain("step_aside");
  });

  it("waits on a shop entrance by resting, since holding there opens the shop", () => {
    const w = world({ map: ["#####", "#G..#", "#####"], player: { depth: 0, maxDepth: 0, gold: 0, recall: 12 } as never });
    w.moveTo({ x: 1, y: 1 });
    const { p } = planner(w);
    const q = asked(p.ask(w.view));
    expect(q.context.offers.map((o) => o.goal)).toContain("wait");
    const choice = p.choose(pick("wait"), q.context, w.view);
    if (!("plan" in choice)) throw new Error("expected a plan");
    expect(choice.plan.step(w.view, w.act)).toMatchObject({ code: "rest", args: { count: 2 } });
  });

  it("turns an explore answer into a plan that walks", () => {
    const w = suppliedWorld({ map: CORRIDOR });
    const { p } = planner(w);
    const q = asked(p.ask(w.view));
    const choice = p.choose(pick("explore"), q.context, w.view);
    if (!("plan" in choice)) throw new Error("expected a plan");
    expect(choice.plan.step(w.view, w.act)).toEqual({ code: "walk", dir: 6 });
  });

  it("tells the model about a swarm and about poison", () => {
    const worms = [5, 6, 7].map((x) => ({ grid: { x, y: 1 }, race: "yellow worm mass" }));
    const w = world({ map: CORRIDOR, monsters: worms, player: { status: { poisoned: 5 } } as never });
    const state = asked(planner(w).p.ask(w.view)).request.state as Record<string, unknown>;
    expect(String(state["swarm"])).toContain("3 yellow worm mass");
    expect(String(state["status"])).toContain("Poisoned");
  });

  it("closes a nasty cut before exploring or resting", () => {
    const w = world({ map: CORRIDOR, pack: ["3 Potions of Cure Light Wounds"], player: { hp: 18, maxHp: 20, status: { cut: 60 } } as never });
    const offers = asked(planner(w).p.ask(w.view)).context.offers;
    expect(offers.find((o) => o.goal === "heal")?.criteria).toContain("closes the bleeding wound");
    expect(offers.map((o) => o.goal)).not.toContain("explore");
    expect(offers.map((o) => o.goal)).not.toContain("rest");
  });

  it("stops walking up to a creature that never moves", () => {
    const w = world({ map: CORRIDOR, monsters: [{ grid: { x: 5, y: 1 }, race: "grey mold" }] });
    const { p } = planner(w);
    expect(offered(p.ask(w.view))).toContain("fight");
    p.ask(w.view);
    expect(offered(p.ask(w.view))).not.toContain("fight");
  });

  it("does not offer stairs it cannot walk to", () => {
    const walled = suppliedWorld({ map: ["#######", "#.@.#>#", "#######"], player: { depth: 2, maxDepth: 2 } });
    expect(offered(planner(walled).p.ask(walled.view))).not.toContain("descend");
    const open = suppliedWorld({ map: ["#######", "#.@..>#", "#######"], player: { depth: 2, maxDepth: 2 } });
    expect(offered(planner(open).p.ask(open.view))).toContain("descend");
  });

  it("learns a new spell before walking on when nothing is awake", () => {
    const w = world({ map: CORRIDOR, pack: ["a Magic for Beginners"], spells: [{ name: "Magic Missile", sidx: 0, learned: false }] });
    const goals = offered(planner(w).p.ask(w.view));
    expect(goals).toContain("study");
    expect(goals).not.toContain("explore");
  });

  it("lights a torch before exploring in the dark", () => {
    const w = world({ map: CORRIDOR, pack: ["2 Wooden Torches (5000 turns)"] });
    const goals = offered(planner(w).p.ask(w.view));
    expect(goals).toContain("wear");
    expect(goals).not.toContain("explore");
  });

  it("takes an offered rest immediately when the model refuses every option", () => {
    const w = world({ map: ["#####", "#.@.#", "#####"], player: { hp: 15, maxHp: 20 } });
    const { p } = planner(w);
    const none = (): Readonly<Record<string, Answer>> => ({ goal: { type: "choice", choice: "none_of_these", confidence: 0.9, probabilities: { rest: 0.3, none_of_these: 0.7 } } });
    const first = p.choose(none(), asked(p.ask(w.view)).context, w.view);
    if (!("plan" in first)) throw new Error("expected a plan");
    expect(first.plan.step(w.view, w.act)).toEqual({ code: "rest" });
    w.advance(10);
    expect(first.plan.step(w.view, w.act)).toBeNull();
    const q = asked(p.ask(w.view));
    expect(q.context.offers.map((o) => o.goal)).toContain("rest");
    const second = p.choose(none(), q.context, w.view);
    if (!("plan" in second)) throw new Error("expected a plan");
    expect(second.plan.step(w.view, w.act)).toEqual({ code: "rest" });
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
    const w = suppliedWorld({ map: CORRIDOR, monsters: [{ grid: { x: 6, y: 1 }, race: "scruffy little dog" }] });
    const { p } = planner(w);
    const q = asked(p.ask(w.view));
    const choice = p.choose(pick("explore"), q.context, w.view);
    if (!("plan" in choice)) throw new Error("expected a plan");
    expect(choice.plan.step(w.view, w.act)).not.toBeNull();
  });

  it("leaves out a goal whose plan passed no game time until the turn changes", () => {
    const w = world({ map: ["#####", "#.@.#", "#####"], player: { hp: 10, maxHp: 20 } });
    const { p } = planner(w);
    const q = asked(p.ask(w.view));
    expect(q.context.offers.map((o) => o.goal)).toContain("rest");
    const choice = p.choose(pick("rest"), q.context, w.view);
    if (!("plan" in choice)) throw new Error("expected a plan");
    expect(choice.plan.step(w.view, w.act)).not.toBeNull();
    expect(choice.plan.step(w.view, w.act)).toBeNull();
    const again = p.ask(w.view);
    expect("handBack" in again ? [] : again.context.offers.map((o) => o.goal)).not.toContain("rest");
  });

  it("does not offer a melee fight with a creature it cannot walk to", () => {
    const w = world({ map: ["#######", "#.@#..#", "#.###.#", "#######"], monsters: [{ grid: { x: 4, y: 1 }, race: "cave orc" }] });
    expect(offered(planner(w).p.ask(w.view))).not.toContain("fight");
  });

  it("uses its own offered choice for none_of_these or an unoffered goal", () => {
    const w = suppliedWorld({ map: CORRIDOR });
    const { p } = planner(w);
    const q = asked(p.ask(w.view));
    const fallback = p.choose(pick("none_of_these"), q.context, w.view);
    if (!("plan" in fallback)) throw new Error("expected a plan");
    expect(fallback.plan.step(w.view, w.act)).toEqual({ code: "walk", dir: 6 });
    expect(p.choose(pick("fight"), q.context, w.view)).toHaveProperty("plan");
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
    const w = suppliedWorld({ map: CORRIDOR });
    const { p } = planner(w);
    const choice = p.choose(pick("explore"), asked(p.ask(w.view)).context, w.view);
    if (!("plan" in choice)) throw new Error("expected a plan");
    expect(p.trigger(w.view, choice.plan)).toBeNull();
    w.setMonsters([{ grid: { x: 6, y: 1 }, race: "jackal" }]);
    expect(p.trigger(w.view, choice.plan)).not.toBeNull();
  });

  it("keeps a plan when a creature already seen on this level steps back into view", () => {
    const dog = { grid: { x: 6, y: 1 }, race: "scruffy little dog", asleep: true };
    const w = suppliedWorld({ map: CORRIDOR, monsters: [dog] });
    const { p } = planner(w);
    asked(p.ask(w.view));
    w.setMonsters([{ ...dog, visible: false }]);
    const choice = p.choose(pick("explore"), asked(p.ask(w.view)).context, w.view);
    if (!("plan" in choice)) throw new Error("expected a plan");
    w.setMonsters([dog]);
    expect(p.trigger(w.view, choice.plan)).toBeNull();
  });

  it("takes a survival fallback on none_of_these when the character is hurt", () => {
    const w = world({ map: CORRIDOR, player: { hp: 4, maxHp: 10 }, monsters: [{ grid: { x: 4, y: 1 }, race: "cave orc", level: 7 }] });
    const { p, logged } = planner(w);
    const q = asked(p.ask(w.view));
    const answer = { goal: { type: "choice", choice: "none_of_these", confidence: 0.5, probabilities: { none_of_these: 0.5, retreat: 0.4, fight: 0.1 } } } as const;
    const fallback = p.choose(answer, q.context, w.view);
    expect(fallback).toHaveProperty("plan");
    expect(logged.join(" ")).toContain("taking the survival fallback (retreat)");
  });

  it("rejects the lethal stair route and backs away without another question", () => {
    const w = world({ map: ["########", "#.@...>#", "#.#### #", "########"], player: { hp: 4, maxHp: 10 }, monsters: [{ grid: { x: 4, y: 1 }, race: "cave orc", level: 7 }] });
    const { p, logged } = planner(w);
    const first = asked(p.ask(w.view));
    expect(offered(first)).not.toContain("leave_level");
    const none = { goal: { type: "choice", choice: "none_of_these", confidence: 0.5, probabilities: { none_of_these: 0.6, retreat: 0.3, fight: 0.1 } } } as const;
    const again = p.choose(none, first.context, w.view);
    if (!("plan" in again)) throw new Error("expected a plan");
    expect(again.plan.step(w.view, w.act)).toEqual({ code: "walk", dir: 4 });
    expect(logged.join(" ")).toContain("taking the survival fallback (retreat)");
    expect(logged.join(" ")).not.toContain("asking again");
  });

  it("keeps recall, gear and detection out of the handbook", () => {
    const w = suppliedWorld({ map: CORRIDOR });
    const rules = String(asked(planner(w).p.ask(w.view)).request.state["rules"]);
    expect(rules).not.toMatch(/Word of Recall|Wear better gear|detect a new dungeon level/);
    expect(rules).toContain("Going deeper too early");
  });

  it("never rates a ranged attack beside a deadly creature safer than phasing", () => {
    const w = world({ map: CORRIDOR, player: { hp: 2, maxHp: 31, sp: 5, maxSp: 9 }, pack: ["a Scroll of Phase Door"], spells: [{ name: "Magic Missile", sidx: 0 }], monsters: [{ grid: { x: 3, y: 1 }, race: "Grip, Farmer Maggot's Dog", level: 5, raceFlags: ["UNIQUE"] }] });
    const offers = asked(planner(w).p.ask(w.view)).context.offers;
    const risk = (g: string) => offers.find((o) => o.goal === g)?.risk ?? NaN;
    expect(offers.map((o) => o.goal)).not.toContain("retreat");
    expect(risk("phase")).toBeLessThan(risk("cast_attack"));
  });

  it("tells the model what the last plan ran into", () => {
    const w = suppliedWorld({ map: CORRIDOR });
    const { p } = planner(w);
    const choice = p.choose(pick("explore"), asked(p.ask(w.view)).context, w.view);
    if (!("plan" in choice)) throw new Error("expected a plan");
    w.setMonsters([{ grid: { x: 6, y: 1 }, race: "jackal" }]);
    p.trigger(w.view, choice.plan);
    expect(String(asked(p.ask(w.view)).request.state["last"])).toContain("jackal came into view");
  });

  it("folds creatures of one kind into a single line", () => {
    const worms = [5, 6, 7].map((x) => ({ grid: { x, y: 1 }, race: "white worm mass", level: 1 }));
    const w = world({ map: CORRIDOR, monsters: worms });
    expect(String(asked(planner(w).p.ask(w.view)).request.state["creatures"])).toBe("3 white worm mass: an easy kill each, the nearest 3 steps away");
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

describe("reflexes", () => {
  it("takes the only option without asking the model", () => {
    const w = suppliedWorld({ map: CORRIDOR });
    const r = reflexed(planner(w, true).p.ask(w.view));
    expect(r.reflex).toBe("the only option");
    expect(r.context.offers.map((o) => o.goal)).toEqual(["explore"]);
    expect(r.answers["goal"]).toMatchObject({ type: "choice", choice: "explore" });
    expect(r.plan.step(w.view, w.act)).not.toBeNull();
  });

  it("learns a new spell as routine upkeep while nothing is awake", () => {
    const w = world({ map: CORRIDOR, pack: ["a Book of Magic Spells [Magic for Beginners]"], spells: [{ name: "Magic Missile", sidx: 0, learned: false }] });
    const r = reflexed(planner(w, true).p.ask(w.view));
    expect(r.reflex).toBe("routine upkeep");
    expect(r.plan.step(w.view, w.act)).toMatchObject({ code: "study" });
  });

  it("asks the model about upkeep while a creature is awake nearby", () => {
    const w = world({ map: CORRIDOR, pack: ["a Book of Magic Spells [Magic for Beginners]"], spells: [{ name: "Magic Missile", sidx: 0, learned: false }], monsters: [{ grid: { x: 6, y: 1 }, race: "cave orc", level: 3 }] });
    const q = asked(planner(w, true).p.ask(w.view));
    expect(q.context.offers.map((o) => o.goal)).toContain("study");
  });

  it("keeps the model's answer while the situation stays the same, for a few turns", () => {
    const w = suppliedWorld({ map: CORRIDOR, player: { hp: 10, maxHp: 20 } });
    const { p } = planner(w, true);
    const q = asked(p.ask(w.view));
    expect(q.context.offers.map((o) => o.goal)).toEqual(expect.arrayContaining(["rest", "explore"]));
    p.choose(pick("rest"), q.context, w.view);
    w.advance(10);
    const again = reflexed(p.ask(w.view));
    expect(again.reflex).toBe("same situation as the last answer");
    expect(again.answers["goal"]).toMatchObject({ choice: "rest" });
    w.advance(100);
    expect("reflex" in p.ask(w.view)).toBe(false);
  });

  it("asks again when the situation changes", () => {
    const w = suppliedWorld({ map: CORRIDOR, player: { hp: 10, maxHp: 20 } });
    const { p } = planner(w, true);
    p.choose(pick("rest"), asked(p.ask(w.view)).context, w.view);
    w.setPlayer({ hp: 3 });
    expect("reflex" in p.ask(w.view)).toBe(false);
  });
});

describe("refusals", () => {
  it("tells the model why the game refused a spell, and offers it again once that passes", () => {
    const w = world({ map: CORRIDOR, monsters: [{ grid: { x: 5, y: 1 }, race: "cave orc", level: 3 }], player: { sp: 5, maxSp: 5 }, spells: [{ name: "Magic Missile", sidx: 0 }] });
    const { p } = planner(w);
    const choice = p.choose(pick("cast_attack"), asked(p.ask(w.view)).context, w.view);
    if (!("plan" in choice)) throw new Error("expected a plan");
    let command = choice.plan.step(w.view, w.act);
    w.setPlayer({ status: { confused: 5 } });
    let guard = 0;
    while (command !== null && guard++ < 5) command = choice.plan.step(w.view, w.act);
    w.setPlayer({ status: { confused: 0 } });
    w.advance(10);
    const next = asked(p.ask(w.view));
    expect(String(next.request.state["last"])).toContain("refused it while the character is confused");
    expect(next.context.offers.map((o) => o.goal)).toContain("cast_attack");
  });

  it("keeps a refused goal out until the character's situation changes", () => {
    const w = world({ map: CORRIDOR, monsters: [{ grid: { x: 5, y: 1 }, race: "cave orc", level: 3 }], player: { sp: 5, maxSp: 5 }, spells: [{ name: "Magic Missile", sidx: 0 }] });
    const { p } = planner(w);
    const choice = p.choose(pick("cast_attack"), asked(p.ask(w.view)).context, w.view);
    if (!("plan" in choice)) throw new Error("expected a plan");
    let command = choice.plan.step(w.view, w.act);
    let guard = 0;
    while (command !== null && guard++ < 5) command = choice.plan.step(w.view, w.act);
    w.advance(10);
    expect(offered(p.ask(w.view))).not.toContain("cast_attack");
    w.moveTo({ x: 3, y: 1 });
    expect(offered(p.ask(w.view))).toContain("cast_attack");
  });
});

describe("items and spells", () => {
  const ORC = [{ grid: { x: 5, y: 1 }, race: "cave orc", level: 3 }];

  it("offers healing only when hurt, naming the potion", () => {
    const pack = ["3 Potions of Cure Light Wounds"];
    const full = suppliedWorld({ map: CORRIDOR, pack });
    expect(offered(planner(full).p.ask(full.view))).not.toContain("heal");
    const hurt = suppliedWorld({ map: CORRIDOR, pack, player: { hp: 5, maxHp: 20 }, monsters: [{ grid: { x: 3, y: 1 }, level: 0 }] });
    const q = asked(planner(hurt).p.ask(hurt.view));
    expect(q.context.offers.find((o) => o.goal === "heal")?.criteria).toContain("Cure Light Wounds");
  });

  it("drinks the smallest adequate healing potion", () => {
    const w = world({ map: CORRIDOR, pack: ["a Potion of Cure Light Wounds", "a Potion of Cure Serious Wounds"], player: { hp: 5, maxHp: 20 }, monsters: [{ grid: { x: 3, y: 1 }, level: 0 }] });
    const { p } = planner(w);
    const choice = p.choose(pick("heal"), asked(p.ask(w.view)).context, w.view);
    if (!("plan" in choice)) throw new Error("expected a plan");
    expect(choice.plan.step(w.view, w.act)).toEqual({ code: "quaff", args: { handle: 1 } });
  });

  it("never uses an unidentified potion as a healing potion", () => {
    const w = world({ map: CORRIDOR, pack: ["a Light Blue Potion"], player: { hp: 5, maxHp: 20 } });
    expect(offered(planner(w).p.ask(w.view))).not.toContain("heal");
  });

  it("offers phase, teleport, oil and an attack spell in a fight", () => {
    const w = world({
      map: CORRIDOR,
      monsters: ORC,
      player: { sp: 5, maxSp: 5 },
      pack: ["5 Scrolls of Phase Door", "a Scroll of Teleportation", "4 Flasks of Oil"],
      spells: [{ name: "Magic Missile", sidx: 0 }],
    });
    const goals = offered(planner(w).p.ask(w.view));
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
    const goals = offered(planner(w).p.ask(w.view));
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
    expect(offered(p.ask(w.view))).not.toContain("cast_attack");
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
    const w = suppliedWorld({ map: CORRIDOR, pack: ["a Book of Magic Spells [Magic for Beginners]"], spells: [{ name: "Magic Missile", sidx: 0, learned: false }] });
    const { p } = planner(w);
    const q = asked(p.ask(w.view));
    expect(q.context.offers.map((o) => o.goal)).toContain("study");
    const choice = p.choose(pick("study"), q.context, w.view);
    if (!("plan" in choice)) throw new Error("expected a plan");
    expect(choice.plan.step(w.view, w.act)).toMatchObject({ code: "study", args: { handle: 1, spell: 0 } });
    expect(offered(p.ask(w.view))).not.toContain("study");
  });

  it("offers food only when hungry", () => {
    const w = world({ map: CORRIDOR, pack: ["2 Rations of Food"], player: { status: { food: 900 } } });
    expect(offered(planner(w).p.ask(w.view))).toContain("eat");
  });
});

describe("spellcasters use study and mana", () => {
  /* A room with a down staircase, so leaving the level is on offer beside the fight. */
  const LAIR = ["##########", "#..@....>#", "#........#", "##########"];
  const WORMS = [
    { grid: { x: 2, y: 1 }, race: "clear worm mass", level: 1, raceFlags: ["MULTIPLY"] },
    { grid: { x: 4, y: 1 }, race: "clear worm mass", level: 1, raceFlags: ["MULTIPLY"] },
    { grid: { x: 3, y: 2 }, race: "clear worm mass", level: 1, raceFlags: ["MULTIPLY"] },
  ];
  const BOOK = ["a Book of Magic Spells [Magic for Beginners]"];
  const UNKNOWN = [{ name: "Magic Missile", sidx: 0, mana: 2, learned: false }];
  const KNOWN = [{ name: "Magic Missile", sidx: 0, mana: 2 }];
  const ACID = "It touches you to burn with acid (1d4).";

  it("offers study while a swarm is adjacent when the turn is survivable", () => {
    const w = suppliedWorld({ map: LAIR, pack: BOOK, spells: UNKNOWN, monsters: WORMS, monsterRecall: () => ACID });
    expect(offered(planner(w).p.ask(w.view))).toContain("study");
  });

  it("keeps study out when the swarm would deal a lethal share", () => {
    const w = suppliedWorld({ map: LAIR, pack: BOOK, spells: UNKNOWN, monsters: WORMS, monsterRecall: () => "It touches you to burn with acid (4d8)." });
    expect(offered(planner(w).p.ask(w.view))).not.toContain("study");
  });

  it("makes a mana-stuck caster's melee against a touch creature heavier than a warrior's", () => {
    const fightOffer = (player: NonNullable<WorldSpec["player"]>, spells: NonNullable<WorldSpec["spells"]>) => {
      const w = suppliedWorld({ map: LAIR, player, spells, monsters: WORMS, monsterRecall: () => ACID, worn: ["a Dagger (1d4) (+0,+0)"] });
      const q = asked(planner(w).p.ask(w.view));
      return q.context.offers.find((o) => o.goal === "fight");
    };
    const warrior = fightOffer({ cls: "Warrior", level: 5, sp: 0, maxSp: 0 }, []);
    const empty = fightOffer({ cls: "Mage", level: 5, sp: 0, maxSp: 5 }, KNOWN);
    const full = fightOffer({ cls: "Mage", level: 5, sp: 5, maxSp: 5 }, KNOWN);
    expect(empty?.criteria).toContain("out of mana");
    expect(empty?.risk ?? 0).toBeGreaterThan(warrior?.risk ?? 0);
    expect(full?.risk).toBe(warrior?.risk);
  });

  it("offers a mana-stuck caster an escape the warrior does not need", () => {
    const mage = suppliedWorld({ map: LAIR, player: { cls: "Mage", level: 5, sp: 0, maxSp: 5 }, spells: KNOWN, monsters: WORMS, monsterRecall: () => ACID });
    expect(offered(planner(mage).p.ask(mage.view))).toContain("phase");
    const warrior = suppliedWorld({ map: LAIR, player: { cls: "Warrior", level: 5, sp: 0, maxSp: 0 }, spells: [], monsters: WORMS, monsterRecall: () => ACID });
    expect(offered(planner(warrior).p.ask(warrior.view))).not.toContain("phase");
  });

  it("does not treat a caster that can afford its attack spell as stranded", () => {
    const w = suppliedWorld({ map: LAIR, player: { cls: "Mage", level: 5, sp: 2, maxSp: 5 }, spells: KNOWN, monsters: WORMS, monsterRecall: () => ACID, worn: ["a Dagger (1d4) (+0,+0)"] });
    const fight = asked(planner(w).p.ask(w.view)).context.offers.find((o) => o.goal === "fight");
    expect(fight?.criteria).not.toContain("out of mana");
  });

  it("does not treat a caster with no attack spells as stranded", () => {
    const w = suppliedWorld({ map: LAIR, player: { cls: "Priest", level: 5, sp: 0, maxSp: 5 }, spells: [{ name: "Cure Light Wounds", sidx: 3, mana: 2 }], monsters: WORMS, monsterRecall: () => ACID, worn: ["a Dagger (1d4) (+0,+0)"] });
    const fight = asked(planner(w).p.ask(w.view)).context.offers.find((o) => o.goal === "fight");
    expect(fight?.criteria).not.toContain("out of mana");
  });

  it("falls back to the cannot-kill-quickly arm when the creature has no recall", () => {
    const w = suppliedWorld({ map: LAIR, player: { cls: "Mage", level: 5, sp: 0, maxSp: 5 }, spells: KNOWN, monsters: WORMS, worn: ["a Dagger (1d4) (+0,+0)"] });
    const fight = asked(planner(w).p.ask(w.view)).context.offers.find((o) => o.goal === "fight");
    expect(fight?.criteria).toContain("out of mana");
    expect(fight?.criteria).toContain("cannot be killed quickly");
  });

  it("weighs melee for a stranded caster among breeders and keeps the escapes", () => {
    const BREEDERS = [
      { grid: { x: 2, y: 1 }, race: "clear worm mass", level: 1, raceFlags: ["MULTIPLY"] },
      { grid: { x: 4, y: 1 }, race: "clear worm mass", level: 1, raceFlags: ["MULTIPLY"] },
    ];
    const w = suppliedWorld({ map: LAIR, player: { cls: "Mage", level: 5, sp: 0, maxSp: 5 }, spells: KNOWN, monsters: BREEDERS, monsterRecall: () => ACID, worn: ["a Dagger (1d4) (+0,+0)"] });
    const q = asked(planner(w).p.ask(w.view));
    expect(q.context.offers.find((o) => o.goal === "fight")?.criteria).toContain("out of mana");
    expect(offered(q)).toContain("phase");
  });

  it("warns on a walk-up fight without adding escapes at range", () => {
    const DISTANT = [{ grid: { x: 5, y: 1 }, race: "clear worm mass", level: 1, raceFlags: ["MULTIPLY"] }];
    const w = suppliedWorld({ map: LAIR, player: { cls: "Mage", level: 5, sp: 0, maxSp: 5 }, spells: KNOWN, monsters: DISTANT, monsterRecall: () => ACID, worn: ["a Dagger (1d4) (+0,+0)"] });
    const q = asked(planner(w).p.ask(w.view));
    expect(q.context.offers.find((o) => o.goal === "fight")?.criteria).toContain("out of mana");
    expect(offered(q)).not.toContain("phase");
  });
});

describe("persona", () => {
  const ORC = [{ grid: { x: 5, y: 1 }, race: "cave orc", level: 3 }];

  function withPersona(w: ReturnType<typeof world>, persona: ReturnType<typeof defaultPersona>) {
    return createGoalPlanner({ cfg: defaultCfg(), terrain: w.terrain, log: () => {}, persona, rng: () => 0.5, reflex: false });
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
    const w = suppliedWorld({ map: ["#####", "#@*.#", "#####"] });
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

  it("offers to wait out a recall already read", () => {
    const w = world({ map: CORRIDOR, player: { depth: 6, maxDepth: 6, gold: 300, recall: 12 } as never, pack: ["a Scroll of Word of Recall"] });
    const goals = offered(planner(w).p.ask(w.view));
    expect(goals).toContain("wait");
    expect(goals).not.toContain("recall_town");
  });

  it("waits out a pending recall in one errand, not one decision per turn", () => {
    /* The Rogue's soak shape: level 2, full health on dungeon level 1, nothing in sight, recall read, nothing left to explore; it once asked 25 times in a row. */
    const w = suppliedWorld({ map: ["#####", "#@..#", "#####"], player: { cls: "Rogue", level: 2, depth: 1, maxDepth: 1, hp: 24, maxHp: 24, recall: 20 } as never });
    const { p } = planner(w, true);
    const decided = p.ask(w.view);
    expect("reflex" in decided && decided.context.offers.map((o) => o.goal)).toEqual(["wait"]);
    if (!("reflex" in decided)) throw new Error("expected a reflex");
    let holds = 0;
    for (let turn = 0; turn < 20; turn += 1) {
      const command = decided.plan.step(w.view, w.act);
      if (command === null) break;
      expect(command).toMatchObject({ code: "hold" });
      holds += 1;
      w.advance(10);
      w.setPlayer({ recall: 19 - turn } as never);
    }
    expect(holds).toBe(20);
    w.setPlayer({ recall: 0, depth: 0 } as never);
    expect(decided.plan.step(w.view, w.act)).toBeNull();
  });

  it("trusts the recall timer when the game reports one", () => {
    expect(recallPending({ depth: 6, recall: 12 }, null, 0)).toBe(true);
    expect(recallPending({ depth: 6, recall: 0 }, { turn: 0, depth: 6 }, 10)).toBe(false);
    expect(recallPending({ depth: 6 }, { turn: 0, depth: 6 }, 10)).toBe(true);
    expect(recallPending({ depth: 0 }, { turn: 0, depth: 6 }, 10)).toBe(false);
    expect(recallPending({ depth: 6 }, { turn: 0, depth: 6 }, RECALL_WAIT_TURNS + 1)).toBe(false);
  });

  it("starts a supply-margin recall near the surface and without restocking gold", () => {
    const pack = ["a Scroll of Word of Recall", "a Potion of Cure Light Wounds", "a Scroll of Phase Door"];
    for (const player of [{ depth: 2, maxDepth: 2, gold: 300 }, { depth: 6, maxDepth: 6, gold: 10 }]) {
      const w = world({ map: CORRIDOR, player, pack });
      expect(asked(planner(w).p.ask(w.view)).context.offers.map((offer) => offer.goal)).toContain("recall_town");
    }
  });

  it("recalls home from near the surface once no healing or escape is left", () => {
    const w = world({ map: CORRIDOR, player: { depth: 2, maxDepth: 2, gold: 300 }, pack: ["a Scroll of Word of Recall"] });
    expect(asked(planner(w).p.ask(w.view)).context.offers.map((offer) => offer.goal)).toContain("recall_town");
  });

  it("offers shopping from mapped entrances without reading store stock", () => {
    const w = world({ map: ["#####", "#@.A#", "#####"], player: { depth: 0, maxDepth: 5 } });
    const view = { ...w.view, stores: () => { throw new Error("stock read outside store"); } };
    const q = asked(planner(w).p.ask(view));
    expect(q.context.offers.map((offer) => offer.goal)).toContain("shop");
    expect(q.context.offers.map((offer) => offer.goal)).not.toContain("recall_dungeon");
  });

  it("offers recall back down when shopping is finished", () => {
    const w = suppliedWorld({ map: ["###", "#@#", "###"], player: { depth: 0, maxDepth: 5, level: 6, maxLevel: 6 }, pack: ["a Scroll of Word of Recall"] });
    const q = asked(planner(w).p.ask(w.view));
    expect(q.context.offers.find((offer) => offer.goal === "recall_dungeon")?.criteria).toContain("250 ft");
  });

  it("offers town stairs when there is no scroll or gold", () => {
    const w = suppliedWorld({ map: ["#####", "#@>##", "#####"], player: { depth: 0, gold: 0 } });
    expect(asked(planner(w).p.ask(w.view)).context.offers.map((offer) => offer.goal)).toContain("descend");
  });

  it("keeps exploring town when every visible grid is explored but the stairs are unknown", () => {
    const w = world({ map: ["#####", "#...#", "#.@.#", "#...#", "#####"], player: { depth: 0, gold: 0, light: 0 } });
    const { p } = planner(w);
    const q = asked(p.ask(w.view));
    expect(q.context.offers.map((offer) => offer.goal)).toContain("explore");
    const choice = p.choose(pick("explore"), q.context, w.view);
    if (!("plan" in choice)) throw new Error("expected an explore plan");
    expect(choice.plan.step(w.view, w.act)?.code).toBe("walk");
  });

  it("takes the town stairs with a recall scroll but no depth to return to", () => {
    const w = suppliedWorld({ map: ["#####", "#@>##", "#####"], player: { depth: 0, maxDepth: 0, gold: 0 }, pack: ["a Scroll of Word of Recall"] });
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
    const w = suppliedWorld({ map: CORRIDOR, pack: ["Leather Armour [2,+0]"], worn: ["Leather Armour [8,+2]"] });
    expect(offered(planner(w).p.ask(simulatedView(w, -6)))).not.toContain("wear");
    const curious = defaultPersona();
    curious.sliders.curiosity = 90;
    const p = createGoalPlanner({ cfg: defaultCfg(), terrain: w.terrain, log: () => {}, persona: curious, reflex: false });
    expect(offered(p.ask(w.view))).not.toContain("wear");
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
    const w = suppliedWorld({ map: CORRIDOR, pack: ["Leather Shield [8] {??}"], worn: ["Leather Shield [4,+0]"] });
    const view: AgentView = { ...w.view, simulateLoadout: () => { throw new Error("unknown runes were simulated"); } };
    expect(offered(planner(w).p.ask(view))).not.toContain("wear");
    const curious = defaultPersona();
    curious.sliders.curiosity = 50;
    const p = createGoalPlanner({ cfg: defaultCfg(), terrain: w.terrain, log: () => {}, persona: curious, reflex: false });
    expect(asked(p.ask(view)).context.offers.find((o) => o.goal === "wear")?.criteria).toContain("unknown Leather Shield");
    const magical = suppliedWorld({ map: CORRIDOR, pack: ["Leather Shield [8,+2] {magical}"] });
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
    const w = suppliedWorld({ map: CORRIDOR, pack: ["a Scroll of Magic Mapping"] });
    const { p } = planner(w);
    const q = asked(p.ask(w.view));
    expect(q.context.offers.map((o) => o.goal)).toContain("detect");
    expect(offered(p.ask(w.view))).not.toContain("detect");
    const choice = p.choose(pick("detect"), q.context, w.view);
    if (!("plan" in choice)) throw new Error("expected a plan");
    expect(choice.plan.step(w.view, w.act)).toEqual({ code: "read", args: { handle: 1 } });
    w.setPlayer({ depth: 2 });
    expect(offered(p.ask(w.view))).toContain("detect");
  });

  it("waits to survey when an awake creature is in sight", () => {
    const w = world({ map: CORRIDOR, pack: ["a Rod of Detection"], monsters: [{ grid: { x: 5, y: 1 } }] });
    expect(offered(planner(w).p.ask(w.view))).not.toContain("detect");
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

describe("dreaded creatures", () => {
  it("rate a kind that killed an ancestor as dangerous at least", () => {
    expect(threatIndex({ level: 0, raceFlags: [], race: "mean-looking mercenary" }, 1, 10)).toBe(0);
    expect(threatIndex({ level: 0, raceFlags: [], race: "mean-looking mercenary" }, 1, 10, new Set(["mean-looking mercenary"]))).toBe(2);
  });
});

describe("fear, swarms and refused commands", () => {
  const ROOM = ["##########", "#<@......#", "#........#", "#........#", "##########"];
  const worms = (n: number) => Array.from({ length: n }, (_, i) => ({ grid: { x: 3 + i, y: 3 }, race: "green worm mass", level: 1, raceFlags: ["MULTIPLY"] }));
  const goals = (w: ReturnType<typeof world>, dreaded: readonly string[] = []) =>
    offered(createGoalPlanner({ cfg: defaultCfg(), terrain: w.terrain, log: () => undefined, dreaded: () => new Set(dreaded) }).ask(w.view));

  it("offers no melee to an afraid character, and offers a way out instead", () => {
    const w = world({ map: CORRIDOR, player: { status: { afraid: 10 } } as never, pack: ["a Scroll of Phase Door"], monsters: [{ grid: { x: 3, y: 1 }, race: "acolyte", level: 2 }] });
    expect(String(asked(planner(w).p.ask(w.view)).request.state["status"])).toContain("cannot attack in melee");
    const offered = goals(w);
    expect(offered).not.toContain("fight");
    expect(offered).toContain("phase");
    expect(offered).not.toContain("retreat");
  });

  it("offers to leave the level once breeders fill the room", () => {
    expect(goals(world({ map: ROOM, player: { depth: 2, level: 6 }, monsters: worms(5) }))).not.toContain("leave_level");
    expect(goals(world({ map: ROOM, player: { depth: 2, level: 6 }, monsters: worms(6) }))).toContain("leave_level");
  });

  it("leaves sooner when a breeder of that kind has hurt the line before", () => {
    expect(goals(world({ map: ROOM, player: { depth: 2 }, monsters: worms(3) }), ["green worm mass"])).toContain("leave_level");
  });

  it("walks to the nearest stairs to leave a swarm", () => {
    const w = suppliedWorld({ map: ROOM, player: { depth: 2 }, monsters: worms(6) });
    const { p } = planner(w);
    const choice = p.choose(pick("leave_level"), asked(p.ask(w.view)).context, w.view);
    if (!("plan" in choice)) throw new Error("expected a plan");
    expect(choice.plan.step(w.view, w.act)).toMatchObject({ dir: 4 });
  });

  it("does not stop a plan for one more of a breeder already seen, but does for anything else", () => {
    const w = suppliedWorld({ map: ["###########", "#<@....... ", "#........##", "#........#", "##########"], player: { depth: 2, level: 6 }, monsters: worms(2) });
    const { p } = planner(w);
    const choice = p.choose(pick("explore"), asked(p.ask(w.view)).context, w.view);
    if (!("plan" in choice)) throw new Error("expected a plan");
    w.setMonsters([...worms(3)]);
    expect(p.trigger(w.view, choice.plan)).toBeNull();
    w.setMonsters([...worms(3), { grid: { x: 8, y: 1 }, race: "jackal", level: 1 }]);
    expect(p.trigger(w.view, choice.plan)).not.toBeNull();
  });

  it("does not interrupt the stair search on a marked breeder level", () => {
    /* Record shape: each explore choice on the marked level was interrupted with 0 commands. */
    const w = suppliedWorld({ map: ["##########", "#.@,,,,,,#", "##########"], player: { level: 2, hp: 36, maxHp: 36 }, monsters: worms(3) });
    const { p } = planner(w);
    p.ask(w.view);
    w.setMonsters([]);
    const q = asked(p.ask(w.view));
    expect(offered(q)).toContain("explore");
    const choice = p.choose(pick("explore"), q.context, w.view);
    if (!("plan" in choice)) throw new Error("expected a plan");
    expect(choice.plan.step(w.view, w.act)).not.toBeNull();
    expect(p.trigger(w.view, choice.plan)).toBeNull();
  });

  it("offers a search for the down staircase to a ready Warrior with none known", () => {
    const row = `#<@${".".repeat(27)}${",".repeat(7)}#`;
    const wall = "#".repeat(row.length);
    const w = suppliedWorld({ map: [wall, row, wall], player: { cls: "Warrior", level: 3, maxLevel: 3, hp: 54, maxHp: 54 } });
    expect(createJourney(w.terrain).searching(w.view)).toBe(true);
    const q = asked(planner(w).p.ask(w.view));
    expect(offered(q)).toContain("explore");
    expect(q.context.offers.find((offer) => offer.goal === "explore")?.criteria).toContain("staircase onward");
  });

  it("walks a ready character to the down stairs and issues the descent", () => {
    const row = `#<@${".".repeat(27)}>#`;
    const wall = "#".repeat(row.length);
    const w = suppliedWorld({ map: [wall, row, wall], player: { cls: "Warrior", level: 3, maxLevel: 3, hp: 54, maxHp: 54 } });
    const { p } = planner(w);
    const q = asked(p.ask(w.view));
    expect(offered(q)).toContain("descend");
    const choice = p.choose(pick("descend"), q.context, w.view);
    if (!("plan" in choice)) throw new Error("expected a descent plan");
    const step: Readonly<Record<number, readonly [number, number]>> = { 1: [-1, 1], 2: [0, 1], 3: [1, 1], 4: [-1, 0], 6: [1, 0], 7: [-1, -1], 8: [0, -1], 9: [1, -1] };
    let command = choice.plan.step(w.view, w.act);
    let guard = 0;
    while (command !== null && command.code !== "descend" && guard < 60) {
      if (command.code === "walk") {
        const dir = step[(command as { readonly dir?: number }).dir ?? 0];
        if (dir !== undefined) w.moveTo({ x: w.view.player().grid.x + dir[0], y: w.view.player().grid.y + dir[1] });
      }
      guard += 1;
      command = choice.plan.step(w.view, w.act);
    }
    expect(command).toEqual({ code: "descend" });
  });

  it("gives up an errand whose commands pass no game time", () => {
    const w = world({ map: CORRIDOR, monsters: [{ grid: { x: 6, y: 1 }, race: "cave orc", level: 3 }] });
    const { p, logged } = planner(w);
    const choice = p.choose(pick("fight"), asked(p.ask(w.view)).context, w.view);
    if (!("plan" in choice)) throw new Error("expected a plan");
    let issued = 0;
    while (choice.plan.step(w.view, w.act) !== null && issued < 10) issued += 1;
    expect(issued).toBeLessThanOrEqual(3);
    expect(logged.join("\n")).toContain("no time passed");
  });

  it("sees missiles in the quiver", () => {
    const w = world({ map: CORRIDOR, worn: ["a Sling (x2)"], quiver: ["20 Iron Shots"], monsters: [{ grid: { x: 6, y: 1 }, race: "cave orc", level: 3 }] });
    expect(goals(w)).toContain("shoot");
  });
});

describe("soak findings", () => {
  it("passes a turn when a frightened character has no usable attack or escape", () => {
    const w = world({ map: ["#####", "#@.##", "#####"], player: { hp: 3, maxHp: 20, status: { afraid: 10 } }, monsters: [{ grid: { x: 2, y: 1 }, level: 30, speed: 140 }] });
    const { p } = planner(w);
    const q = asked(p.ask(w.view));
    expect(offered(q)).toContain("endure");
    const choice = p.choose({}, q.context, w.view);
    if (!("plan" in choice)) throw new Error("expected a last resort wait");
    expect(choice.plan.step(w.view, w.act)).toEqual({ code: "hold" });
  });
  it.each(["Rogue", "Mage"])("explores beyond the initial stair leash when a level 1 %s cannot descend", (cls) => {
    const w = suppliedWorld({ map: ["#######################", "#<@..................,#", "#######################"], player: { cls, level: 1, maxLevel: 1, depth: 1, maxDepth: 1 } });
    const { p } = planner(w);
    const q = asked(p.ask(w.view));
    expect(offered(q)).toContain("explore");
    expect(offered(q)).not.toContain("descend");
    const choice = p.choose({}, q.context, w.view);
    if (!("plan" in choice)) throw new Error("expected wider exploration");
    expect(choice.plan.step(w.view, w.act)).toEqual({ code: "walk", dir: 6 });
    w.moveTo({ x: 17, y: 1 });
    expect(choice.plan.step(w.view, w.act)).toEqual({ code: "walk", dir: 6 });
  });

  it("lets the town Warrior walk to the stairs after refusing every offer", () => {
    const w = suppliedWorld({ map: ["########", "#.@..>.#", "########"], player: { cls: "Warrior", level: 1, maxLevel: 1, depth: 0, maxDepth: 0, hp: 20, maxHp: 20, gold: 0 } });
    const { p } = planner(w);
    const q = asked(p.ask(w.view));
    expect(offered(q)).toContain("descend");
    const choice = p.choose(pick("none_of_these"), q.context, w.view);
    if (!("plan" in choice)) throw new Error("expected a trip to the stairs");
    expect(choice.plan.step(w.view, w.act)).toEqual({ code: "walk", dir: 6 });
  });

  it("drops damage from a creature that disappeared after a fight", () => {
    const w = suppliedWorld({ map: ["########", "#.@..>.#", "########"], player: { depth: 0, maxDepth: 0 }, monsters: [{ grid: { x: 3, y: 1 }, race: "singing, happy drunk" }] });
    const { p } = planner(w);
    p.ask(w.view);
    w.setMonsters([]);
    w.advance(10);
    const q = asked(p.ask(w.view));
    expect(String(q.request.state["incoming"])).toContain("Up to 0 HP damage in one action and 0 in two");
  });

  const BREEDER_DOOR = ["##########", "#<.@/....#", "##########"];
  const doorBreeders = [5, 6, 7].map((x) => ({ grid: { x, y: 1 }, race: "white worm mass", level: 1, raceFlags: ["MULTIPLY"] }));

  it("offers and rechecks a door that delays the breeders while leaving the exit open", () => {
    const w = suppliedWorld({ map: BREEDER_DOOR, player: { level: 2, hp: 16, maxHp: 16 }, monsters: doorBreeders });
    const { p } = planner(w);
    const q = asked(p.ask(w.view));
    expect(offered(q)).toContain("close_door");
    expect(offered(q)).not.toContain("fight");
    const choice = p.choose(pick("close_door"), q.context, w.view);
    if (!("plan" in choice)) throw new Error("expected a plan");
    expect(choice.plan.step(w.view, w.act)).toEqual({ code: "close", dir: 6 });
    expect(goalOfCommand({ code: "close", dir: 6 }, w.view)).toBe("close_door");
    expect(goalLabel("close_door")).toBe("close a door");
  });

  it("does not close a door when the action is lethal, occupied or cannot slow a breeder", () => {
    const lethal = suppliedWorld({ map: BREEDER_DOOR, player: { level: 2, hp: 1, maxHp: 16 }, monsters: [{ ...doorBreeders[0]!, grid: { x: 2, y: 1 } }, ...doorBreeders.slice(1)] });
    expect(offered(planner(lethal).p.ask(lethal.view))).not.toContain("close_door");
    const occupied = suppliedWorld({ map: BREEDER_DOOR, player: { level: 2 }, monsters: [{ ...doorBreeders[0]!, grid: { x: 4, y: 1 } }, ...doorBreeders.slice(1)] });
    expect(offered(planner(occupied).p.ask(occupied.view))).not.toContain("close_door");
    const passing = suppliedWorld({ map: BREEDER_DOOR, player: { level: 2 }, monsters: doorBreeders.map((monster) => ({ ...monster, raceFlags: ["MULTIPLY", "PASS_WALL"] })) });
    expect(offered(planner(passing).p.ask(passing.view))).not.toContain("close_door");
    const blockedExit = suppliedWorld({ map: ["##########", "###@/.>..#", "##########"], player: { level: 2 }, monsters: doorBreeders });
    expect(offered(planner(blockedExit).p.ask(blockedExit.view))).toContain("phase");
  });

  it("rechecks door safety before executing an already chosen closure", () => {
    const w = suppliedWorld({ map: BREEDER_DOOR, player: { level: 2, hp: 16, maxHp: 16 }, monsters: doorBreeders });
    const { p } = planner(w);
    const choice = p.choose(pick("close_door"), asked(p.ask(w.view)).context, w.view);
    if (!("plan" in choice)) throw new Error("expected a plan");
    w.setPlayer({ hp: 1 });
    w.setMonsters([{ ...doorBreeders[0]!, grid: { x: 2, y: 1 } }, ...doorBreeders.slice(1)]);
    expect(choice.plan.step(w.view, w.act)).toBeNull();
  });

  const TWO_STAIRS = ["##########", "#<@.....>#", "#........#", "#........#", "##########"];
  const planOf = (p: ReturnType<typeof planner>["p"], w: ReturnType<typeof world>, goal: string) => {
    const choice = p.choose(pick(goal), asked(p.ask(w.view)).context, w.view);
    if (!("plan" in choice)) throw new Error("expected a plan");
    return choice.plan;
  };

  it("takes the nearer up staircase when the down route crosses a swarm", () => {
    const worms = Array.from({ length: 6 }, (_, i) => ({ grid: { x: 2 + i, y: 3 }, race: "white worm mass", level: 1, raceFlags: ["MULTIPLY"] }));
    const w = suppliedWorld({ map: TWO_STAIRS, player: { depth: 1 }, monsters: worms });
    const { p } = planner(w);
    expect(asked(p.ask(w.view)).context.offers.find((o) => o.goal === "leave_level")?.criteria).toContain("up or down");
    expect(planOf(planner(w).p, w, "leave_level").step(w.view, w.act)).toMatchObject({ dir: 4 });
  });

  it("retreats at full health from a fair fight only down the stairs, never back up to town", () => {
    /* The soak's warrior at full health on level 1, beside the up staircase, with a worm mass awake. */
    const worm = [{ grid: { x: 4, y: 3 }, race: "white worm mass", level: 1, raceFlags: ["MULTIPLY"] }];
    const w = world({ map: TWO_STAIRS, player: { level: 1, depth: 1 }, monsters: worm, monsterRecall: () => "It can bite to hurt (1d1, 50%)." });
    w.moveTo({ x: 1, y: 1 });
    const offer = asked(planner(w).p.ask(w.view)).context.offers.find((o) => o.goal === "retreat");
    expect(offer?.criteria).toContain("down staircase");
    const step = planOf(planner(w).p, w, "retreat").step(w.view, w.act);
    expect(step?.code).toBe("walk");
    const upOnly = world({ map: ["##########", "#<@......#", "#........#", "#........#", "##########"], player: { level: 1, depth: 1 }, monsters: worm });
    upOnly.moveTo({ x: 1, y: 1 });
    expect(offered(planner(upOnly).p.ask(upOnly.view))).not.toContain("retreat");
  });

  it("still takes the nearest staircase when the danger is pressing", () => {
    const mouse = [{ grid: { x: 2, y: 2 }, race: "giant white mouse", level: 1, raceFlags: ["MULTIPLY"] }];
    const w = world({ map: TWO_STAIRS, player: { level: 1, depth: 1, hp: 7, maxHp: 13 }, monsters: mouse });
    w.moveTo({ x: 1, y: 1 });
    expect(planOf(planner(w).p, w, "retreat").step(w.view, w.act)).toEqual({ code: "ascend" });
  });

  it("never takes the town's down staircase as an escape", () => {
    /* The soak's priest in town at 7 of 13 hit points, standing on the staircase with a townsperson beside it. */
    const w = world({
      map: ["##########", "#........#", "#...>@...#", "#........#", "##########"],
      player: { level: 1, cls: "Priest", depth: 0, maxDepth: 1, hp: 7, maxHp: 13 },
      monsters: [{ grid: { x: 5, y: 2 }, race: "mean-looking mercenary", level: 0, speed: 100 }],
    });
    w.moveTo({ x: 4, y: 2 });
    const offer = asked(planner(w).p.ask(w.view)).context.offers.find((o) => o.goal === "retreat");
    expect(offer?.criteria).toContain("four steps");
    const step = planOf(planner(w).p, w, "retreat").step(w.view, w.act);
    expect(step?.code).toBe("walk");
  });

  it("leaves a goal out once it has started three times on one game turn", () => {
    /* The soak's priest chose retreat about 1,500 times at game turn 3011. */
    const w = world({ map: TWO_STAIRS, player: { level: 1, cls: "Priest", depth: 1, hp: 7, maxHp: 13 }, monsters: [{ grid: { x: 2, y: 2 }, race: "giant white mouse", level: 1 }] });
    w.moveTo({ x: 1, y: 1 });
    const { p, logged } = planner(w);
    for (let i = 0; i < 3; i += 1) {
      const q = asked(p.ask(w.view));
      expect(offered(q)).toContain("retreat");
      p.choose(pick("retreat"), q.context, w.view);
    }
    expect(offered(p.ask(w.view))).not.toContain("retreat");
    expect(logged.join("\n")).toContain("retreat is left out until game time passes");
    w.advance(1);
    expect(offered(p.ask(w.view))).toContain("retreat");
  });

  it("rechecks a plan when one more worm of a known mass can reach the character", () => {
    const worm = (x: number, y: number) => ({ grid: { x, y }, race: "white worm mass", level: 1, raceFlags: ["MULTIPLY"], asleep: true });
    const w = suppliedWorld({ map: ["###########", "#<@....... ", "#........##", "#........#", "##########"], player: { depth: 1 }, monsters: [worm(6, 3)] });
    const { p } = planner(w);
    const choice = p.choose(pick("explore"), asked(p.ask(w.view)).context, w.view);
    if (!("plan" in choice)) throw new Error("expected a plan");
    w.setMonsters([worm(6, 3), worm(3, 2)]);
    expect(p.trigger(w.view, choice.plan)).not.toBeNull();
  });

  it("rests rather than waits while a recall is pending, hurt and out of mana", () => {
    /* The soak's mage waited 32 times in a row at 5 of 10 hit points and no mana. */
    const w = world({ map: CORRIDOR, player: { cls: "Mage", level: 1, depth: 1, hp: 5, maxHp: 10, sp: 0, maxSp: 2, recall: 12 } as never });
    const q = reflexed(planner(w, true).p.ask(w.view));
    expect(q.answers["goal"]).toMatchObject({ choice: "rest" });
    expect(q.reflex).toBe("routine upkeep");
  });

  it("offers to leave a walked-out floor with no way down known", () => {
    const w = world({ map: ["########", "#<@....#", "########"], player: { depth: 1 } });
    expect(offered(planner(w).p.ask(w.view))).toContain("leave_level");
  });

  it("takes the up stairs from a walked-out Rogue floor despite known down stairs", () => {
    const w = suppliedWorld({ map: ["########", "#<@..>.#", "########"], player: { cls: "Rogue", depth: 1, level: 1, maxLevel: 1, hp: 14, maxHp: 14 } });
    const { p } = planner(w);
    const q = asked(p.ask(w.view));
    expect(q.context.offers.find((offer) => offer.goal === "leave_level")?.criteria).toContain("up staircase");
    expect(offered(q)).not.toContain("descend");
    const choice = p.choose(pick("leave_level"), q.context, w.view);
    if (!("plan" in choice)) throw new Error("expected an exit plan");
    expect(choice.plan.step(w.view, w.act)).toEqual({ code: "walk", dir: 4 });
    w.moveTo({ x: 1, y: 1 });
    w.advance(10);
    expect(choice.plan.step(w.view, w.act)).toEqual({ code: "ascend" });
    expect(w.issued.some((command) => command.code === "descend")).toBe(false);
  });

  it("never takes blocked down stairs under attack when leaving a level", () => {
    const w = suppliedWorld({ map: ["########", "#<@..>.#", "########"], player: { cls: "Rogue", depth: 1, level: 1, maxLevel: 1, hp: 14, maxHp: 14 } });
    const { p } = planner(w);
    const choice = p.choose(pick("leave_level"), asked(p.ask(w.view)).context, w.view);
    if (!("plan" in choice)) throw new Error("expected an exit plan");
    w.moveTo({ x: 5, y: 1 });
    w.setMonsters([{ grid: { x: 6, y: 1 }, level: 1 }]);
    expect(choice.plan.step(w.view, w.act)).toBeNull();
    expect(w.issued.some((command) => command.code === "descend")).toBe(false);
  });

  it("does not offer an exit through blocked down stairs when no up stairs are known", () => {
    const w = suppliedWorld({ map: ["########", "#.@..>.#", "########"], player: { cls: "Rogue", depth: 1, level: 1, maxLevel: 1 } });
    expect(offered(planner(w).p.ask(w.view))).toContain("step_aside");
    expect(offered(planner(w).p.ask(w.view))).not.toContain("descend");
  });

  it("rechecks readiness before taking the down stairs in a leave plan", () => {
    const w = suppliedWorld({ map: ["########", "#<@..>.#", "########"], player: { cls: "Rogue", depth: 1, level: 2, maxLevel: 2 }, messages: ["Omens of death haunt this place."] });
    const { p } = planner(w);
    const choice = p.choose(pick("leave_level"), asked(p.ask(w.view)).context, w.view);
    if (!("plan" in choice)) throw new Error("expected an exit plan");
    w.moveTo({ x: 5, y: 1 });
    w.setPlayer({ maxHp: 14 });
    expect(choice.plan.step(w.view, w.act)).toEqual({ code: "walk", dir: 4 });
    expect(w.issued.some((command) => command.code === "descend")).toBe(false);
  });
});

describe("harmless creatures", () => {
  const TOWN = ["############", "#..........#", "#..@.......#", "#..........#", "############"];
  /* The soak Mage in town: full health, no mana, and Farmer Maggot six steps
   * away with his attacks not yet known. Each time he came into view the rest
   * ended and the Mage backed away, 56 times in 12 minutes. */
  const maggot = (x: number, flags: string[] = ["UNIQUE", "RAND_25"]) => ({ grid: { x, y: 2 }, race: "Farmer Maggot", level: 2, speed: 120, raceFlags: flags });
  const mage = { level: 1, cls: "Mage", depth: 0, hp: 10, maxHp: 10, sp: 0, maxSp: 2 };

  it("rests with a wandering townsman in view instead of backing away from him", () => {
    const w = world({ map: TOWN, player: mage, monsters: [maggot(9)] });
    const goals = offered(planner(w).p.ask(w.view));
    expect(goals).toContain("rest");
    expect(goals).not.toContain("retreat");
    expect(goals).not.toContain("phase");
    expect(goals).toContain("fight");
  });

  it("does not end a plan when a wandering townsman comes into view", () => {
    const w = world({ map: TOWN, player: mage });
    const { p } = planner(w);
    const choice = p.choose(pick("rest"), asked(p.ask(w.view)).context, w.view);
    if (!("plan" in choice)) throw new Error("expected a plan");
    w.setMonsters([maggot(9)]);
    expect(p.trigger(w.view, choice.plan)).toBeNull();
  });

  it("does not count a creature as new when it steps back into view on the same level", () => {
    const jackal = { grid: { x: 6, y: 1 }, race: "jackal", level: 1 };
    const w = suppliedWorld({ map: CORRIDOR, player: { depth: 1 }, monsters: [jackal] });
    const { p } = planner(w);
    p.ask(w.view);
    w.setMonsters([]);
    const choice = p.choose(pick("explore"), asked(p.ask(w.view)).context, w.view);
    if (!("plan" in choice)) throw new Error("expected a plan");
    w.setMonsters([jackal]);
    expect(p.trigger(w.view, choice.plan)).toBeNull();
  });

  it("still stops a plan for a new creature of another kind on a reused id", () => {
    const w = suppliedWorld({ map: CORRIDOR, player: { depth: 1 }, monsters: [{ grid: { x: 6, y: 1 }, race: "jackal", level: 1, visible: false }] });
    const { p } = planner(w);
    w.setMonsters([{ grid: { x: 6, y: 1 }, race: "jackal", level: 1 }]);
    p.ask(w.view);
    w.setMonsters([{ grid: { x: 6, y: 1 }, race: "cave spider", level: 2, visible: false }]);
    const choice = p.choose(pick("explore"), asked(p.ask(w.view)).context, w.view);
    if (!("plan" in choice)) throw new Error("expected a plan");
    w.setMonsters([{ grid: { x: 6, y: 1 }, race: "cave spider", level: 2 }]);
    expect(p.trigger(w.view, choice.plan)).toBe("cave spider came into view.");
  });

  it("does not end a plan for a creature that never strikes", () => {
    const w = suppliedWorld({ map: CORRIDOR, player: { depth: 2 } });
    const { p } = planner(w);
    const choice = p.choose(pick("explore"), asked(p.ask(w.view)).context, w.view);
    if (!("plan" in choice)) throw new Error("expected a plan");
    w.setMonsters([{ grid: { x: 6, y: 1 }, race: "floating eye", level: 1, raceFlags: ["NEVER_MOVE", "NEVER_BLOW"] }]);
    expect(p.trigger(w.view, choice.plan)).toBeNull();
  });

  it("stops backing away from a townsman who has stood beside the character without a blow, until he lands one", () => {
    const w = world({ map: TOWN, player: { ...mage, cls: "Warrior", hp: 20, maxHp: 20, maxSp: 0 }, monsters: [maggot(5, ["UNIQUE"])] });
    const { p } = planner(w);
    expect(offered(p.ask(w.view))).toContain("retreat");
    w.setMonsters([maggot(4, ["UNIQUE"])]);
    for (let i = 0; i < 3; i += 1) {
      w.advance(10);
      p.ask(w.view);
    }
    w.setMonsters([maggot(5, ["UNIQUE"])]);
    w.advance(10);
    expect(offered(p.ask(w.view))).not.toContain("retreat");
    w.setMonsters([maggot(4, ["UNIQUE"])]);
    w.advance(10);
    w.setPlayer({ hp: 18 });
    p.ask(w.view);
    w.setMonsters([maggot(5, ["UNIQUE"])]);
    w.advance(10);
    expect(offered(p.ask(w.view))).toContain("retreat");
  });

  it("never calls a creature harmless once its recall shows a damaging blow or spell", () => {
    const bite = world({ map: TOWN, player: mage, monsters: [maggot(9)], monsterRecall: () => "He can bite to hurt (1d3)." });
    expect(harmlessKind(bite.view.monsters()[0]!, bite.view)).toBe(false);
    const caster = world({ map: TOWN, player: mage, monsters: [{ ...maggot(9), spellFlags: ["BLIND"] }] });
    expect(harmlessKind(caster.view.monsters()[0]!, caster.view)).toBe(false);
    const deep = world({ map: TOWN, player: { ...mage, depth: 1 }, monsters: [maggot(9)] });
    expect(harmlessKind(deep.view.monsters()[0]!, deep.view)).toBe(false);
    expect(harmlessKind(deep.view.monsters()[0]!, world({ map: TOWN, player: mage, monsters: [maggot(9)] }).view)).toBe(true);
  });
});

describe("a wait the persona weighs", () => {
  function seeded(seed: number): () => number {
    let s = seed >>> 0;
    return () => {
      s = (s + 0x6d2b79f5) >>> 0;
      let t = s;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  /* A recall already read, nothing awake, and explore beside it: the routine wait competes. */
  function pendingRecall(persona: ReturnType<typeof defaultPersona>, rng: () => number) {
    const w = suppliedWorld({ map: ["#########", "#..@...,#", "#########"], player: { depth: 2, maxDepth: 2, recall: 12 } as never });
    const p = createGoalPlanner({ cfg: defaultCfg(), terrain: w.terrain, log: () => {}, reflex: true, persona, rng, strategy: () => ({ aims: [], tripAllowed: () => false, pursuits: pursuitsFor(persona, 2) }) });
    return { w, p };
  }

  it("draws a competing routine wait in code, with no wait fact or slider facts in the question", () => {
    const persona = archetype("scholar");
    const { w, p } = pendingRecall(persona, () => 1);
    const q = asked(p.ask(w.view));
    expect(offered(q)).toContain("wait");
    expect(q.context.offers.some((o) => o.goal !== "wait" && o.routine !== true)).toBe(true);
    expect(q.request.state["wait"]).toBeUndefined();
    expect((q.request.state["persona"] as Record<string, unknown> | undefined)?.["patience"]).toBeUndefined();
    const own = reflexed(p.rules!(w.view, "own rules"));
    expect(own.reflex).toBe("routine upkeep");
    expect(own.answers["goal"]).toMatchObject({ choice: "wait" });
  });

  it("lets a patient persona wait more often than a restless one with a seeded rng", () => {
    const waits = (persona: ReturnType<typeof defaultPersona>, seed: number) => {
      const { w, p } = pendingRecall(persona, seeded(seed));
      let n = 0;
      for (let i = 0; i < 300; i += 1) {
        w.advance(1);
        const q = p.ask(w.view);
        const goal = "reflex" in q ? q.answers["goal"] : undefined;
        if ("reflex" in q && q.reflex === "routine upkeep" && goal?.type === "choice" && goal.choice === "wait") n += 1;
      }
      return n;
    };
    const patient = { ...defaultPersona(), sliders: { ...defaultPersona().sliders, patience: 90 } };
    const restless = { ...defaultPersona(), sliders: { ...defaultPersona().sliders, patience: 10 } };
    expect(waits(patient, 7)).toBeGreaterThan(waits(restless, 7));
  });

  it("keeps the competing wait as routine upkeep when there is no persona to draw from", () => {
    const { w, p } = pendingRecall(null as never, () => 1);
    const q = p.ask(w.view);
    expect(reflexed(q).reflex).toBe("routine upkeep");
    expect(reflexed(q).answers["goal"]).toMatchObject({ choice: "wait" });
  });

  it("keeps the routine wait when nothing else is on offer", () => {
    const w = world({ map: ["#####", "#.@.#", "#####"], player: { depth: 1, recall: 12 } as never });
    const p = createGoalPlanner({ cfg: defaultCfg(), terrain: w.terrain, log: () => {}, reflex: true });
    const q = p.ask(w.view);
    expect(reflexed(q).answers["goal"]).toMatchObject({ choice: "wait" });
  });
});

describe("the leave_level label", () => {
  it("names the up stairs when the journey reroutes the walk away from nearer down stairs", () => {
    const w = world({ map: ["##########", "#<....@.>#", "##########"], player: { level: 1, maxLevel: 1, depth: 2, maxDepth: 2, hp: 10, maxHp: 10 } });
    const { p } = planner(w);
    const q = asked(p.ask(w.view));
    expect(offered(q)).toContain("leave_level");
    const choice = p.choose(pick("leave_level"), q.context, w.view);
    if (!("plan" in choice)) throw new Error("expected a plan");
    expect(choice.plan.label).toBe("take the stairs up");
    expect(choice.plan.step(w.view, w.act)).toEqual({ code: "walk", dir: 4 });
  });
});