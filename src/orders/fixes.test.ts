import { describe, expect, it } from "vitest";
import type { StoreView } from "@rpgm-tools/neo-angband-core";
import { FEAT, world } from "../harness.js";
import { createTally } from "../brain/tally.js";
import { JEV, type AskResult } from "../brain/backend.js";
import type { Answer, SystemOneRequest } from "../brain/systemone.js";
import { createGoalPlanner, type GoalDigest } from "../brain/goals.js";
import type { Question } from "../brain/brain.js";
import { defaultCfg } from "../settings.js";
import { defaultPersona, type Persona } from "../persona/persona.js";
import { createOrders, type Orders } from "./book.js";

const CORRIDOR = ["########", "#.@....#", "#.#### #", "########"];
const GRIP = [{ grid: { x: 4, y: 1 }, race: "Grip, Farmer Maggot's Dog", level: 30 }];
const SHOP = { feat: FEAT.GENERAL, featName: "General Store", isHome: false, owner: { name: "Bilbo", purse: 5000 }, stock: [] } as unknown as StoreView;

function careful(): Persona {
  const p = defaultPersona("Careful");
  p.sliders.strength = 100;
  p.sliders.volatility = 0;
  p.sliders.selfpreservation = 100;
  p.sliders.boldness = 100;
  p.sliders.devotion = 100;
  p.sliders.resentment = 0;
  p.sliders.stubbornness = 0;
  return p;
}

function book(persona: Persona, reply?: (r: SystemOneRequest) => Promise<AskResult>): { orders: Orders; requests: SystemOneRequest[] } {
  const requests: SystemOneRequest[] = [];
  const orders = createOrders({
    backend: () => (reply === undefined ? null : JEV),
    send: (r) => { requests.push(r); return reply === undefined ? Promise.reject(new Error("no model")) : reply(r); },
    tally: createTally({ perSessionUsd: 0, perDayUsd: 0 }),
    now: () => 0,
    persona: () => persona,
    setPersona: () => {},
    kept: () => 50,
    note: () => {},
    log: () => {},
    save: () => {},
    rng: () => 0.5,
  });
  return { orders, requests };
}

function choice(probabilities: Record<string, number>): Answer {
  const top = Object.entries(probabilities).sort((a, b) => b[1] - a[1])[0]![0];
  return { type: "choice", choice: top, confidence: probabilities[top]!, probabilities };
}

function question(q: ReturnType<ReturnType<typeof createGoalPlanner>["ask"]>): Question<GoalDigest> {
  if ("handBack" in q) throw new Error(`expected a question, got a hand-back: ${q.handBack}`);
  if ("reflex" in q) throw new Error(`expected a question, got a reflex: ${q.reflex}`);
  return q;
}

describe("a reused answer and the current orders", () => {
  it("asks again once the order that carried a fight past the ceiling is withdrawn", async () => {
    const w = world({ map: CORRIDOR, player: { hp: 2, maxHp: 40 }, monsters: GRIP });
    const persona = careful();
    const { orders } = book(persona);
    const given = orders.give("Fight the monsters you meet", "panel", { kind: "order" });
    if (!given.ok) throw new Error(given.problem);
    await orders.settled();
    orders.observe(w.view);
    const p = createGoalPlanner({ cfg: defaultCfg(), terrain: w.terrain, log: () => {}, persona, rng: () => 0.5, reflex: true, orders });
    const q = question(p.ask(w.view));
    const answers = { goal: choice({ retreat: 0.6, fight: 0.4 }), in_character: choice({ fight: 1 }) };
    const first = p.choose(answers, q.context, w.view);
    expect("plan" in first ? first.plan.label : undefined).toBe("fight");
    orders.retire(given.instruction.id);
    const again = p.ask(w.view);
    expect("reflex" in again).toBe(false);
    expect("request" in again).toBe(true);
  });

  it("still reuses the answer when nothing about the orders changed", async () => {
    const w = world({ map: CORRIDOR, player: { hp: 2, maxHp: 40 }, monsters: GRIP });
    const persona = careful();
    const { orders } = book(persona);
    orders.give("Fight the monsters you meet", "panel", { kind: "order" });
    await orders.settled();
    orders.observe(w.view);
    const p = createGoalPlanner({ cfg: defaultCfg(), terrain: w.terrain, log: () => {}, persona, rng: () => 0.5, reflex: true, orders });
    const q = question(p.ask(w.view));
    p.choose({ goal: choice({ retreat: 0.6, fight: 0.4 }), in_character: choice({ fight: 1 }) }, q.context, w.view);
    const again = p.ask(w.view);
    expect("reflex" in again ? again.reflex : null).toBe("same situation as the last answer");
  });
});

describe("a one-time instruction and its plan", () => {
  it("is done only after the chosen plan takes game time", async () => {
    const w = world({ map: CORRIDOR, player: { hp: 2, maxHp: 40 }, monsters: [{ grid: { x: 4, y: 1 }, race: "Grip, Farmer Maggot's Dog", level: 30, raceFlags: ["UNIQUE"] }] });
    const persona = careful();
    const { orders } = book(persona);
    orders.give("Fight the first time you see a unique", "panel", { kind: "order" });
    await orders.settled();
    orders.observe(w.view);
    const p = createGoalPlanner({ cfg: defaultCfg(), terrain: w.terrain, log: () => {}, persona, rng: () => 0.5, reflex: false, orders });
    const q = question(p.ask(w.view));
    const chosen = p.choose({ goal: choice({ retreat: 0.6, fight: 0.4 }), in_character: choice({ fight: 1 }) }, q.context, w.view);
    if (!("plan" in chosen)) throw new Error("expected a plan");
    expect(chosen.plan.label).toBe("fight");
    expect(orders.live()).toHaveLength(1);
    expect(chosen.plan.step(w.view, w.act)).not.toBeNull();
    expect(p.trigger(w.view, chosen.plan)).toBeNull();
    expect(orders.live()).toHaveLength(1);
    w.advance(1);
    p.trigger(w.view, chosen.plan);
    expect(orders.live()).toHaveLength(0);
    expect(orders.list()[0]!.state).toBe("done");
  });
});

describe("a level feeling on a new floor at the same depth", () => {
  it("is forgotten when the next floor announces its own feeling", () => {
    const w = world({ map: ["########", "#@....>#", "########"], player: { depth: 2, maxDepth: 2 }, messages: ["Omens of death haunt this place, and there are good treasures here."] });
    const p = createGoalPlanner({ cfg: defaultCfg(), terrain: w.terrain, log: () => {}, reflex: false });
    const first = question(p.ask(w.view));
    expect(first.context.offers.map((o) => o.goal)).toContain("leave_level");
    w.setMessages(["This place seems reasonably safe."]);
    const next = question(p.ask(w.view));
    expect(next.context.offers.map((o) => o.goal)).not.toContain("leave_level");
  });

  it("is kept on the same floor while no new feeling arrives", () => {
    const w = world({ map: ["########", "#@....>#", "########"], player: { depth: 2, maxDepth: 2 }, messages: ["Omens of death haunt this place, and there are good treasures here."] });
    const p = createGoalPlanner({ cfg: defaultCfg(), terrain: w.terrain, log: () => {}, reflex: false });
    question(p.ask(w.view));
    w.setMessages(["You hit the kobold."]);
    expect(question(p.ask(w.view)).context.offers.map((o) => o.goal)).toContain("leave_level");
  });
});

describe("sorting a burst of viewers' orders", () => {
  it("spends one request on every order queued in one poll", async () => {
    const { orders, requests } = book(careful(), () => Promise.resolve({ ok: true, answers: {}, usage: { inputTokens: 10, outputTokens: 2, estimated: false }, model: null, latencyMs: 1, server: "test" }));
    for (let n = 0; n < 6; n++) orders.give(`Always rest when you are wounded, number ${String(n)}`, "channel", { viewer: `v${String(n)}`, deferSort: true });
    expect(requests).toHaveLength(0);
    orders.flush();
    await orders.settled();
    expect(requests).toHaveLength(1);
    expect(orders.live()).toHaveLength(6);
  });
});

describe("more live instructions than one decision holds", () => {
  it("brings every one of them into the decision state over a few decisions", async () => {
    const w = world({ map: ["#####", "#.@.#", "#####"], player: { depth: 1 } });
    const { orders } = book(careful());
    const texts = Array.from({ length: 9 }, (_, n) => `Always keep ${String(n + 2)} flasks of oil`);
    for (const t of texts) orders.give(t, "panel");
    await orders.settled();
    orders.observe(w.view);
    const seen = new Set<string>();
    for (let n = 0; n < 3; n++) {
      const note = orders.note(w.view) ?? "";
      expect(note.split("Your patron's standing instruction").length - 1).toBeLessThanOrEqual(6);
      for (const t of texts) if (note.includes(`"${t}"`)) seen.add(t);
    }
    expect(seen.size).toBe(texts.length);
  });

  it("asks at most three questions and rotates the rest in", async () => {
    const w = world({ map: ["#####", "#.@.#", "#####"], player: { depth: 1, hp: 5, maxHp: 20 } });
    const { orders } = book(careful());
    for (let n = 0; n < 5; n++) orders.give(`Always rest when you are wounded, number ${String(n)}`, "panel");
    await orders.settled();
    orders.observe(w.view);
    const offers = [{ goal: "rest", criteria: "rest" }, { goal: "explore", criteria: "walk" }];
    const asked = new Set<string>();
    for (let n = 0; n < 2; n++) {
      const qs = Object.keys(orders.ask(offers, w.view));
      expect(qs.length).toBeLessThanOrEqual(3);
      for (const k of qs) asked.add(k);
    }
    expect(asked.size).toBe(5);
  });

  it("puts a situational instruction ahead of standing ones that always apply", async () => {
    const w = world({ map: ["#####", "#.@.#", "#####"], player: { depth: 1, hp: 10, maxHp: 100 } });
    const { orders } = book(careful());
    for (let n = 0; n < 7; n++) orders.give(`Always keep ${String(n + 2)} flasks of oil`, "panel");
    orders.give("Rest when below 30 HP", "panel");
    await orders.settled();
    orders.observe(w.view);
    expect(orders.note(w.view)).toContain('"Rest when below 30 HP"');
  });
});

describe("triggers read from the words", () => {
  it("applies an entering-a-store instruction only on a store's entrance", async () => {
    const w = world({ map: ["#####", "#@G.#", "#####"], player: { depth: 0 }, stores: [SHOP] });
    const { orders } = book(careful());
    orders.give("Buy a Flask of oil whenever you enter a store", "panel");
    await orders.settled();
    orders.observe(w.view);
    expect(orders.note(w.view)).toBeNull();
    w.moveTo({ x: 2, y: 1 });
    expect(orders.note(w.view)).toContain("enter a store");
  });

  it("applies a hit point instruction at the line the words name", async () => {
    const w = world({ map: ["#####", "#.@.#", "#####"], player: { depth: 1, hp: 40, maxHp: 100 } });
    const { orders } = book(careful());
    orders.give("Rest when below 30 HP", "panel");
    await orders.settled();
    orders.observe(w.view);
    expect(orders.note(w.view)).toBeNull();
    w.setPlayer({ hp: 25 });
    expect(orders.note(w.view)).toContain("below 30 HP");
  });

  it("reads a share of maximum hit points", async () => {
    const w = world({ map: ["#####", "#.@.#", "#####"], player: { depth: 1, hp: 40, maxHp: 100 } });
    const { orders } = book(careful());
    orders.give("Rest when under a third of your hit points", "panel");
    await orders.settled();
    orders.observe(w.view);
    expect(orders.note(w.view)).toBeNull();
    w.setPlayer({ hp: 30 });
    expect(orders.note(w.view)).not.toBeNull();
  });
});

describe("an item-use ban", () => {
  const offers = [{ goal: "teleport", criteria: "Read a Scroll of Teleportation to get away." }, { goal: "fight", criteria: "Attack the orc." }];

  it("weighs down the option it forbids, in a fight only", async () => {
    const { orders } = book(careful());
    orders.give("Never read scrolls of teleportation in a fight", "panel");
    await orders.settled();
    const calm = world({ map: ["#######", "#.@...#", "#######"], player: { depth: 1 } });
    orders.observe(calm.view);
    const dist = { teleport: 0.5, fight: 0.5 };
    expect(orders.weigh(dist, {}, calm.view, offers)["teleport"]).toBeCloseTo(0.5);
    const hot = world({ map: ["#######", "#.@.o.#", "#######"], player: { depth: 1 }, monsters: [{ grid: { x: 4, y: 1 }, race: "cave orc", level: 7 }] });
    orders.observe(hot.view);
    expect(orders.weigh(dist, {}, hot.view, offers)["teleport"]!).toBeLessThan(0.5);
  });
});

describe("a viewer's request", () => {
  it("reads to the model as a viewer's request, not the patron's order", async () => {
    const w = world({ map: ["#####", "#.@.#", "#####"], player: { depth: 1 } });
    const { orders } = book(careful());
    orders.give("Always rest when you are wounded", "channel", { viewer: "Ada" });
    await orders.settled();
    w.setPlayer({ hp: 5, maxHp: 20 });
    orders.observe(w.view);
    const note = orders.note(w.view) ?? "";
    expect(note).toContain('A viewer, Ada, asked: "Always rest when you are wounded".');
    expect(note).not.toContain("patron");
    const qs = Object.values(orders.ask([{ goal: "rest", criteria: "rest" }, { goal: "explore", criteria: "walk" }], w.view));
    expect(qs[0]!.instructions).toContain("A viewer, Ada, asked:");
  });
});
