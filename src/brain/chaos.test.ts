import { describe, expect, it } from "vitest";
import { suppliedWorld } from "../harness.js";
import { defaultCfg } from "../settings.js";
import { defaultPersona, type Persona } from "../persona/persona.js";
import type { Orders } from "../orders/book.js";
import type { Answer } from "./systemone.js";
import type { Question } from "./brain.js";
import { createGoalPlanner, type GoalDigest, type GoalPlannerOptions } from "./goals.js";
import { chaosChoice, chaosEntry, chaosPick, chaosTemperature, LAWFUL_TEMPERATURE, ROLL_FLOOR, rollThreshold, type ChaosMethod } from "./chaos.js";

const CORRIDOR = ["########", "#.@....#", "#.#### #", "########"];

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

/** Draws that come back in the order given, then repeat. */
function scripted(...draws: number[]): () => number {
  let i = 0;
  return () => draws[i++ % draws.length]!;
}

/** Expected shares of p^(1/T) over a distribution. */
function expectedShares(dist: Readonly<Record<string, number>>, temperature: number): Record<string, number> {
  const weights = Object.entries(dist).map(([key, p]) => [key, p > 0 ? p ** (1 / temperature) : 0] as const);
  const total = weights.reduce((sum, [, w]) => sum + w, 0);
  return Object.fromEntries(weights.map(([key, w]) => [key, w / total]));
}

function shares(picks: readonly string[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const pick of picks) out[pick] = (out[pick] ?? 0) + 1 / picks.length;
  return out;
}

describe("the Law to Chaos temperature", () => {
  it("is 0 when lawful, about 0.5 at neutral and about 1.1 when chaotic", () => {
    expect(chaosTemperature(0)).toBe(0);
    expect(chaosTemperature(50)).toBeCloseTo(0.5, 2);
    expect(chaosTemperature(100)).toBeCloseTo(1.1, 2);
  });

  it("rises smoothly with the slider and stays inside its ends", () => {
    let last = -1;
    for (let value = 0; value <= 100; value += 1) {
      const t = chaosTemperature(value);
      expect(t).toBeGreaterThan(last);
      expect(t - Math.max(0, last)).toBeLessThan(0.02);
      last = t;
    }
    expect(chaosTemperature(-20)).toBe(0);
    expect(chaosTemperature(250)).toBeCloseTo(1.1, 2);
  });
});

describe("smooth sampling", () => {
  const dist = { a: 0.6, b: 0.3, c: 0.1 };

  it("takes the top option and draws nothing at the lawful end", () => {
    let calls = 0;
    const rng = () => { calls += 1; return 0.99; };
    expect(chaosTemperature(0)).toBeLessThan(LAWFUL_TEMPERATURE);
    expect(chaosPick(dist, { lawchaos: 0, method: "sampling", rng })).toEqual({ pick: "a", record: null });
    expect(calls).toBe(0);
  });

  it("draws in proportion to p^(1/T)", () => {
    const rng = seeded(5);
    for (const lawchaos of [50, 100]) {
      const picks = Array.from({ length: 20_000 }, () => chaosPick(dist, { lawchaos, method: "sampling", rng }).pick!);
      const want = expectedShares(dist, chaosTemperature(lawchaos));
      const got = shares(picks);
      for (const key of Object.keys(dist)) expect(got[key] ?? 0).toBeCloseTo(want[key]!, 1);
      expect(Math.abs((got["b"] ?? 0) - want["b"]!)).toBeLessThan(0.015);
    }
  });

  it("records the temperature, the top option and the pick", () => {
    expect(chaosPick(dist, { lawchaos: 100, method: "sampling", rng: () => 0.99 })).toEqual({
      pick: "c", record: { method: "sampling", temperature: 1.1, top: "a", pick: "c" },
    });
    expect(chaosPick(dist, { lawchaos: 100, method: "sampling", rng: () => 0 }).record).toMatchObject({ top: "a", pick: "a" });
  });

  it("draws nothing with one option, and never an option without weight", () => {
    expect(chaosPick({ a: 1 }, { lawchaos: 100, method: "sampling", rng: () => 0.99 })).toEqual({ pick: "a", record: null });
    expect(chaosPick({ a: 0.7, b: 0 }, { lawchaos: 100, method: "sampling", rng: () => 0.99 })).toEqual({ pick: "a", record: null });
    expect(chaosPick({}, { lawchaos: 100, method: "sampling", rng: () => 0.5 })).toEqual({ pick: undefined, record: null });
  });
});

describe("the bounded roll", () => {
  it("keeps the top option on every roll when lawful, 13 in 20 at neutral and 6 in 20 when chaotic", () => {
    expect(rollThreshold(0)).toBe(1);
    expect(21 - rollThreshold(50)).toBe(13);
    expect(21 - rollThreshold(100)).toBe(6);
    for (let value = 1; value <= 100; value += 1) expect(rollThreshold(value)).toBeGreaterThanOrEqual(rollThreshold(value - 1));
  });

  it("rolls nothing when lawful", () => {
    let calls = 0;
    expect(chaosPick({ a: 0.6, b: 0.4 }, { lawchaos: 0, method: "roll", rng: () => { calls += 1; return 0; } })).toEqual({ pick: "a", record: null });
    expect(calls).toBe(0);
  });

  it("keeps the top option when the d20 meets the threshold", () => {
    /* 0.35 of 20 is a roll of 8, the neutral threshold. */
    expect(chaosPick({ a: 0.6, b: 0.4 }, { lawchaos: 50, method: "roll", rng: () => 0.35 })).toEqual({
      pick: "a", record: { method: "roll", d20: 8, threshold: 8, top: "a", pick: "a" },
    });
  });

  it("lets a d4 pick among the top four, counting only options with a third of the top's probability", () => {
    const dist = { a: 0.45, b: 0.2, c: 0.16, d: 0.11, e: 0.08 };
    expect(dist.c).toBeGreaterThanOrEqual(dist.a * ROLL_FLOOR);
    expect(dist.d).toBeLessThan(dist.a * ROLL_FLOOR);
    const roll = (d4: number) => chaosPick(dist, { lawchaos: 100, method: "roll", rng: scripted(0, (d4 - 1) / 4) });
    expect(roll(1).record).toEqual({ method: "roll", d20: 1, threshold: 15, d4: 1, top: "a", pick: "a" });
    expect(roll(2).pick).toBe("b");
    expect(roll(3).pick).toBe("c");
    /* Three options are in reach, so a 4 wraps round to the top one. */
    expect(roll(4).pick).toBe("a");
    const rng = seeded(9);
    const picks = new Set(Array.from({ length: 2000 }, () => chaosPick(dist, { lawchaos: 100, method: "roll", rng }).pick));
    expect([...picks].sort()).toEqual(["a", "b", "c"]);
  });

  it("keeps the top option about as often as the threshold says", () => {
    const rng = seeded(21);
    for (const [lawchaos, keeps] of [[50, 13], [100, 6]] as const) {
      const draws = Array.from({ length: 20_000 }, () => chaosPick({ a: 0.5, b: 0.5 / 3 + 1e-9 }, { lawchaos, method: "roll", rng }).record!);
      const kept = draws.filter((d) => d.d4 === undefined).length / draws.length;
      expect(kept).toBeCloseTo(keeps / 20, 1);
    }
  });
});

describe("a goal-hierarchy choice", () => {
  const answer: Answer = { type: "choice", choice: "a", confidence: 0.8, probabilities: { a: 0.5, b: 0.4, none_of_these: 0.1 } };

  it("leaves a refusal or an answer outside the options to the caller", () => {
    expect(chaosChoice({ ...answer, choice: "none_of_these" }, ["a", "b"], { lawchaos: 100, method: "sampling", rng: () => 0.99 })).toBeNull();
    expect(chaosChoice({ ...answer, choice: "z" }, ["a", "b"], { lawchaos: 100, method: "sampling", rng: () => 0.99 })).toBeNull();
    expect(chaosChoice(undefined, ["a", "b"], null)).toBeNull();
  });

  it("draws among the options and never draws the refusal", () => {
    expect(chaosChoice(answer, ["a", "b"], null)).toEqual({ pick: "a", record: null });
    expect(chaosChoice(answer, ["a", "b", "none_of_these"], { lawchaos: 100, method: "sampling", rng: () => 0.99 })).toMatchObject({ pick: "b", record: { top: "a", pick: "b" } });
  });
});

describe("the decision log entry", () => {
  it("keeps the draw, and nothing when no draw was made", () => {
    expect(chaosEntry(undefined)).toEqual({});
    expect(chaosEntry({ method: "roll", d20: 3, threshold: 8, d4: 2, top: "fight", pick: "retreat" })).toEqual({ chaos: { method: "roll", d20: 3, threshold: 8, d4: 2, top: "fight", pick: "retreat" } });
  });
});

describe("Law to Chaos in the planner", () => {
  const ORC = [{ grid: { x: 5, y: 1 }, race: "cave orc", level: 3 }];
  /* Fight, heal, phase, retreat and explore are offered, and the escape gate is asked. */
  const fight = () => suppliedWorld({ map: CORRIDOR, player: { hp: 20, maxHp: 40 }, monsters: ORC });

  function persona(lawchaos: number, tune: (p: Persona) => void = () => {}): Persona {
    const p = defaultPersona("Wren");
    p.sliders.lawchaos = lawchaos;
    p.sliders.strength = 0;
    p.sliders.volatility = 0;
    p.sliders.selfpreservation = 0;
    tune(p);
    return p;
  }

  function rig(p: Persona, extra: Partial<GoalPlannerOptions> = {}, w = fight()) {
    const logged: string[] = [];
    const planner = createGoalPlanner({ cfg: defaultCfg(), terrain: w.terrain, log: (m) => logged.push(m), reflex: false, persona: p, rng: seeded(3), ...extra });
    const q = planner.ask(w.view);
    if (!("request" in q)) throw new Error("expected a question");
    return { w, planner, q: q as Question<GoalDigest>, logged };
  }

  function answers(goal: Record<string, number>, escape = 0.1, confidence = 0.8): Readonly<Record<string, Answer>> {
    const choice = Object.entries(goal).sort((a, b) => b[1] - a[1])[0]![0];
    return { goal: { type: "choice", choice, confidence, probabilities: goal }, escape: { type: "noul", p: escape } };
  }

  /** The pick and the draw of each of `n` decisions on the same question. */
  function draws(r: ReturnType<typeof rig>, given: Readonly<Record<string, Answer>>, n = 400): { pick: string; chaos: GoalDigest["chaos"] }[] {
    return Array.from({ length: n }, () => {
      r.planner.choose(given, r.q.context, r.w.view);
      return { pick: r.q.context.trace?.pick ?? "", chaos: r.q.context.chaos };
    });
  }

  const SPREAD = { fight: 0.5, retreat: 0.3, phase: 0.2 };

  it("always takes the top option for a lawful persona", () => {
    const r = rig(persona(0));
    const out = draws(r, answers(SPREAD));
    expect(new Set(out.map((d) => d.pick))).toEqual(new Set(["fight"]));
    expect(out.every((d) => d.chaos === undefined)).toBe(true);
    expect(r.logged.some((line) => line.includes("Law to Chaos"))).toBe(false);
  });

  it("lets a chaotic persona stray from the top option in proportion to p^(1/T)", () => {
    const r = rig(persona(100));
    const out = draws(r, answers(SPREAD), 3000);
    const blended = Object.fromEntries(Object.entries(r.q.context.trace!.blended).filter(([goal]) => goal !== "none_of_these"));
    const want = expectedShares(blended, chaosTemperature(100));
    const got = shares(out.map((d) => d.pick));
    expect(got["retreat"] ?? 0).toBeGreaterThan(0.2);
    for (const goal of Object.keys(want)) expect(Math.abs((got[goal] ?? 0) - want[goal]!)).toBeLessThan(0.04);
    expect(out.every((d) => d.chaos?.method === "sampling" && d.chaos.temperature === 1.1 && d.chaos.top === "fight" && d.chaos.pick === d.pick)).toBe(true);
    expect(r.logged.some((line) => /^goal: Law to Chaos picks (retreat|phase) over fight \(temperature 1\.10\)$/.test(line))).toBe(true);
    expect(r.logged.some((line) => line.startsWith("goal: Law to Chaos keeps"))).toBe(false);
  });

  it("keeps the draw out of the request the model gets", () => {
    const r = rig(persona(100));
    const before = JSON.stringify(r.q.request);
    draws(r, answers(SPREAD), 20);
    expect(JSON.stringify(r.q.request)).toBe(before);
    expect(before).not.toContain("temperature");
    expect(Object.keys(r.q.request.questions)).toEqual(["goal", "escape", "in_character"]);
  });

  it("never draws an option over the safety ceiling, unless Death wish is on", () => {
    const careful = rig(persona(100, (p) => { p.sliders.selfpreservation = 90; }));
    expect(careful.q.context.offers.find((o) => o.goal === "fight")!.risk).toBeGreaterThan(0.15);
    const out = draws(careful, answers({ fight: 0.6, retreat: 0.25, phase: 0.15 }));
    expect(out.some((d) => d.pick === "fight")).toBe(false);
    expect(new Set(out.map((d) => d.pick))).toEqual(new Set(["retreat", "phase"]));
    const reckless = rig(persona(100, (p) => { p.sliders.selfpreservation = 90; p.quirks.deathwish.on = true; }));
    const wild = draws(reckless, answers({ fight: 0.6, retreat: 0.25, phase: 0.15 }));
    expect(wild.some((d) => d.pick === "fight")).toBe(true);
    expect(wild.some((d) => d.pick !== "fight")).toBe(true);
  });

  it.each([0.7, 0.9])("takes the top option once the escape gate narrows the choice (answer %d)", (p) => {
    const r = rig(persona(100));
    const out = draws(r, answers(SPREAD, p), 200);
    expect(r.q.context.pack?.gate?.band).not.toBe("stay");
    expect(new Set(out.map((d) => d.pick))).toEqual(new Set(["retreat"]));
    expect(out.every((d) => d.chaos === undefined)).toBe(true);
  });

  it("does not draw for the low-confidence fallback", () => {
    const r = rig(persona(100));
    for (let i = 0; i < 100; i += 1) {
      r.planner.choose(answers(SPREAD, 0.1, 0.1), r.q.context, r.w.view);
      expect(r.q.context.pack?.lowConfidence).toBe("fight");
      expect(r.q.context.chaos).toBeUndefined();
    }
  });

  it("does not draw when Squire picks by its own rules", () => {
    const r = rig(persona(100));
    const picks = new Set<string>();
    for (let i = 0; i < 100; i += 1) {
      r.planner.choose({}, r.q.context, r.w.view);
      picks.add(r.q.context.trace?.pick ?? "");
      expect(r.q.context.chaos).toBeUndefined();
      const ruled = r.planner.rules?.(r.w.view, "no model");
      if (ruled === undefined) throw new Error("expected a planner with rules");
      if (!("reflex" in ruled)) throw new Error("expected a decision by the rules");
      expect(ruled.context.chaos).toBeUndefined();
    }
    expect(picks.size).toBe(1);
  });

  it("does not draw for a survival reflex", () => {
    const w = suppliedWorld({ map: CORRIDOR, player: { hp: 3, maxHp: 40 }, pack: [], monsters: [{ grid: { x: 3, y: 1 }, race: "cave orc", level: 10 }] });
    const planner = createGoalPlanner({ cfg: defaultCfg(), terrain: w.terrain, log: () => {}, persona: persona(100), rng: seeded(4) });
    const q = planner.ask(w.view);
    if ("handBack" in q || !("reflex" in q)) throw new Error("expected a reflex");
    expect(q.context.chaos).toBeUndefined();
  });

  it("does not draw with a sole option", () => {
    const r = rig(persona(100));
    const out = draws(r, answers({ retreat: 0.7, none_of_these: 0.3 }), 200);
    expect(new Set(out.map((d) => d.pick))).toEqual(new Set(["retreat"]));
    expect(out.every((d) => d.chaos === undefined)).toBe(true);
  });

  it("does not stray from an option an order carries", () => {
    const orders = {
      passes: () => new Set(["retreat"]), weigh: (dist: Readonly<Record<string, number>>) => ({ ...dist }),
      revision: () => "1", note: () => null, ask: () => ({}), decided: () => {}, carried: () => {}, promote: <T>(aims: T) => aims,
    } as unknown as Orders;
    const r = rig(persona(100), { orders });
    const out = draws(r, answers({ retreat: 0.5, fight: 0.3, phase: 0.2 }), 200);
    expect(new Set(out.map((d) => d.pick))).toEqual(new Set(["retreat"]));
    expect(out.every((d) => d.chaos === undefined)).toBe(true);
  });

  it("does not draw an option an order carries past the ceiling when it is not the top option", () => {
    const orders = {
      passes: () => new Set(["fight"]), weigh: (dist: Readonly<Record<string, number>>) => ({ ...dist }),
      revision: () => "1", note: () => null, ask: () => ({}), decided: () => {}, carried: () => {}, promote: <T>(aims: T) => aims,
    } as unknown as Orders;
    const careful = rig(persona(100, (p) => { p.sliders.selfpreservation = 90; }), { orders });
    expect(careful.q.context.offers.find((o) => o.goal === "fight")!.risk).toBeGreaterThan(0.15);
    const out = draws(careful, answers({ retreat: 0.5, fight: 0.3, phase: 0.2 }));
    expect(out.some((d) => d.pick === "fight")).toBe(false);
    expect(new Set(out.map((d) => d.pick))).toEqual(new Set(["retreat", "phase"]));
  });

  it("never turns a refusal into an action, nor an action into a refusal", () => {
    const refused = rig(persona(100));
    const no = draws(refused, answers({ none_of_these: 0.55, fight: 0.45 }), 200);
    expect(no.every((d) => d.pick === "none_of_these" && d.chaos === undefined)).toBe(true);
    const acted = rig(persona(100));
    const yes = draws(acted, answers({ fight: 0.5, none_of_these: 0.45, retreat: 0.05 }), 400);
    expect(yes.some((d) => d.pick === "none_of_these")).toBe(false);
    expect(yes.some((d) => d.pick === "retreat")).toBe(true);
  });

  it("logs every roll, with the dice, when the method is the roll", () => {
    const method: ChaosMethod = "roll";
    const r = rig(persona(100), { chaosMethod: method, rng: scripted(0.99, 0, 0.3) });
    r.planner.choose(answers(SPREAD), r.q.context, r.w.view);
    expect(r.q.context.chaos).toMatchObject({ method: "roll", threshold: 15, top: "fight" });
    const rolled = r.logged.filter((line) => line.startsWith("goal: Law to Chaos"));
    expect(rolled).toHaveLength(1);
    expect(rolled[0]).toMatch(/^goal: Law to Chaos (keeps fight|picks \w+ over fight) \(d20 rolled \d+, needing 15(; d4 rolled \d)?\)$/);
    const many = rig(persona(100), { chaosMethod: method });
    const out = draws(many, answers(SPREAD), 300);
    expect(out.every((d) => d.chaos?.method === "roll" && d.chaos.d20 !== undefined)).toBe(true);
    expect(many.logged.filter((line) => line.startsWith("goal: Law to Chaos"))).toHaveLength(300);
    expect(out.some((d) => d.pick !== "fight")).toBe(true);
  });

  it("is switched off by the planner's chaos option, for errands", () => {
    const r = rig(persona(100), { chaos: false });
    const out = draws(r, answers(SPREAD));
    expect(new Set(out.map((d) => d.pick))).toEqual(new Set(["fight"]));
    expect(out.every((d) => d.chaos === undefined)).toBe(true);
  });
});
