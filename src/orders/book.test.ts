import { describe, expect, it } from "vitest";
import { world } from "../harness.js";
import { createTally } from "../brain/tally.js";
import { JEV, type AskResult } from "../brain/backend.js";
import type { Answer, SystemOneRequest } from "../brain/systemone.js";
import { defaultPersona, type Persona } from "../persona/persona.js";
import { REVIEW_TURNS } from "../strategy/review.js";
import { createOrders, type Orders, type OrdersState } from "./book.js";
import { PASS_ADHERENCE, clash, nextAdherence, stanceOf, targetAdherence, weigh } from "./adherence.js";
import { FAINT, FORGET_BELOW, fade, fadeRate } from "./memory.js";
import { sortByCode } from "./sort.js";
import type { Instruction } from "./types.js";

const ROOM = ["#####", "#.@.#", "#####"];

interface Kit {
  readonly orders: Orders;
  readonly persona: { current: Persona };
  readonly notes: { text: string; notable: boolean }[];
  readonly saved: OrdersState[];
  readonly kept: { n: number };
  readonly requests: SystemOneRequest[];
}

function kit(options: { persona?: (p: Persona) => void; reply?: (r: SystemOneRequest) => Promise<AskResult>; rng?: () => number } = {}): Kit {
  const persona = { current: defaultPersona("Test") };
  options.persona?.(persona.current);
  const notes: Kit["notes"] = [];
  const saved: OrdersState[] = [];
  const kept = { n: 8 };
  const requests: SystemOneRequest[] = [];
  const reply = options.reply;
  const orders = createOrders({
    backend: () => (reply === undefined ? null : JEV),
    send: (r) => { requests.push(r); return reply === undefined ? Promise.reject(new Error("no model")) : reply(r); },
    tally: createTally({ perSessionUsd: 0, perDayUsd: 0 }),
    now: () => 0,
    persona: () => persona.current,
    setPersona: (p) => { persona.current = p; },
    kept: () => kept.n,
    note: (text, notable) => { notes.push({ text, notable }); },
    log: () => {},
    save: (s) => { saved.push(s); },
    rng: options.rng ?? (() => 0.5),
  });
  return { orders, persona, notes, saved, kept, requests };
}

function good(answers: Record<string, Answer>): AskResult {
  return { ok: true, answers, usage: { inputTokens: 10, outputTokens: 2, estimated: false }, model: null, latencyMs: 1, server: "test" };
}

function only(k: Kit): Instruction {
  const list = k.orders.list();
  expect(list).toHaveLength(1);
  return list[0]!;
}

function pickAnswer(choice: string): Answer {
  return { type: "choice", choice, confidence: 0.9, probabilities: { [choice]: 0.9 } };
}

/** A persona that plainly follows orders: high devotion, no grudge, no stubbornness, and nothing in its temper that the test orders push against. */
function devout(p: Persona): void {
  p.sliders.devotion = 100;
  p.sliders.resentment = 0;
  p.sliders.stubbornness = 0;
  p.sliders.strength = 100;
  p.sliders.selfpreservation = 0;
  p.sliders.ambition = 100;
  p.sliders.savings = 0;
  p.sliders.pricesense = 0;
  p.sliders.greed = 0;
  p.sliders.impulsiveness = 0;
  p.sliders.boldness = 0;
  p.sliders.pride = 0;
  p.sliders.patience = 100;
}

describe("an order's life cycle", () => {
  it("is taken, sorted and shown as following", async () => {
    const k = kit({ persona: devout });
    const w = world({ map: ROOM, player: { depth: 1, maxDepth: 1, gold: 10 } });
    const r = k.orders.give("Reach 500 ft", "panel");
    expect(r.ok).toBe(true);
    await k.orders.settled();
    k.orders.observe(w.view);
    expect(only(k)).toMatchObject({ kind: "order", state: "following", source: "panel", text: "Reach 500 ft" });
    expect(k.notes[0]!.text).toBe("New order: Reach 500 ft");
    expect(k.saved.length).toBeGreaterThan(0);
  });

  it("is done when its test passes, with a Chronicle line", async () => {
    const k = kit({ persona: devout });
    const w = world({ map: ROOM, player: { depth: 1, maxDepth: 1 } });
    k.orders.give("Reach 500 ft", "panel");
    await k.orders.settled();
    k.orders.observe(w.view);
    expect(only(k).state).toBe("following");
    w.setPlayer({ depth: 10, maxDepth: 10 });
    k.orders.observe(w.view);
    expect(only(k).state).toBe("done");
    expect(k.notes.at(-1)).toEqual({ text: "Order done: Reach 500 ft", notable: true });
    expect(k.orders.live()).toHaveLength(0);
  });

  it("is done when the gold is saved or the item is held", async () => {
    const k = kit({ persona: devout });
    const w = world({ map: ROOM, player: { gold: 50 }, pack: [] });
    k.orders.give("Save up 100 gold", "panel");
    k.orders.give("Bring back a Potion of Cure Light Wounds", "panel");
    await k.orders.settled();
    k.orders.observe(w.view);
    expect(k.orders.live()).toHaveLength(2);
    w.setPlayer({ gold: 120 });
    w.advance(REVIEW_TURNS + 1);
    k.orders.observe(w.view);
    expect(k.orders.list().map((i) => i.state).sort()).toEqual(["done", "following"]);
  });

  it("is abandoned when its level deadline passes", async () => {
    const k = kit({ persona: devout });
    const w = world({ map: ROOM, player: { level: 5, depth: 1, maxDepth: 1 } });
    k.orders.give("Reach 500 ft before level 8", "panel");
    await k.orders.settled();
    k.orders.observe(w.view);
    w.setPlayer({ level: 8 });
    k.orders.observe(w.view);
    expect(only(k).state).toBe("abandoned");
    expect(k.notes.at(-1)!.text).toBe("Order dropped, out of time: Reach 500 ft before level 8");
  });

  it("is abandoned after three reviews at ignoring", async () => {
    const k = kit({ persona: (p) => { p.sliders.devotion = 0; p.sliders.resentment = 100; p.sliders.strength = 100; p.sliders.stubbornness = 0; } });
    const w = world({ map: ROOM, player: { depth: 1, maxDepth: 1 } });
    k.orders.give("Reach 500 ft", "panel");
    await k.orders.settled();
    for (let n = 0; n < 4; n += 1) {
      k.orders.observe(w.view);
      w.advance(REVIEW_TURNS + 1);
    }
    expect(only(k).state).toBe("abandoned");
    expect(k.notes.at(-1)!.text).toBe("Order dropped, never followed: Reach 500 ft");
  });

  it("is abandoned when the player retires it", () => {
    const k = kit();
    const r = k.orders.give("Reach 500 ft", "panel");
    if (!r.ok) throw new Error("not taken");
    expect(k.orders.retire(r.instruction.id)).toBe(true);
    expect(only(k).state).toBe("abandoned");
    expect(k.notes.at(-1)!.text).toBe("Order withdrawn: Reach 500 ft");
    expect(k.orders.retire(r.instruction.id)).toBe(false);
  });

  it("builds Resentment when a disliked order is done, and Devotion when a followed one is", async () => {
    const grudge = kit({ persona: (p) => { p.sliders.devotion = 45; p.sliders.resentment = 70; p.sliders.stubbornness = 0; } });
    const w = world({ map: ROOM, player: { depth: 10, maxDepth: 10 } });
    grudge.orders.give("Reach 500 ft", "panel");
    await grudge.orders.settled();
    expect(only(grudge).disliked).toBe(true);
    grudge.orders.observe(w.view);
    expect(grudge.persona.current.sliders.resentment).toBe(75);

    const glad = kit({ persona: devout });
    glad.persona.current.sliders.devotion = 60;
    glad.persona.current.sliders.gratitude = 80;
    glad.orders.give("Reach 500 ft", "panel");
    await glad.orders.settled();
    glad.orders.observe(w.view);
    expect(glad.persona.current.sliders.devotion).toBeGreaterThan(60);
  });
});

describe("a standing instruction's life cycle", () => {
  it("lasts until the player retires it", async () => {
    const k = kit({ persona: devout });
    const w = world({ map: ROOM, player: { depth: 2 } });
    const r = k.orders.give("Always rest when you are wounded", "panel");
    if (!r.ok) throw new Error("not taken");
    await k.orders.settled();
    expect(r.instruction.kind).toBe("standing");
    for (let n = 0; n < 3; n += 1) {
      k.orders.observe(w.view);
      w.advance(REVIEW_TURNS + 1);
    }
    expect(only(k).state).toBe("following");
    expect(k.orders.retire(r.instruction.id)).toBe(true);
    expect(only(k).state).toBe("done");
    expect(k.notes.at(-1)!.text).toBe("Standing instruction retired: Always rest when you are wounded");
  });

  it("lapses at its until-level line", async () => {
    const k = kit({ persona: devout });
    const w = world({ map: ROOM, player: { level: 5 } });
    k.orders.give("Fight everything until level 8", "panel", { kind: "standing" });
    await k.orders.settled();
    k.orders.observe(w.view);
    expect(k.orders.live()).toHaveLength(1);
    w.setPlayer({ level: 8 });
    k.orders.observe(w.view);
    expect(only(k).state).toBe("done");
    expect(k.notes.at(-1)!.text).toBe("Reached level 8, so the instruction lapsed: Fight everything until level 8");
  });

  it("ends after its first act when it applies once", async () => {
    const k = kit({ persona: devout });
    const w = world({ map: ROOM, monsters: [{ grid: { x: 3, y: 1 }, race: "Fang, Farmer Maggot's Dog", level: 5, raceFlags: ["UNIQUE"] }] });
    k.orders.give("Run away the first time you see a unique", "panel");
    await k.orders.settled();
    expect(only(k).sorted.frequency.mode).toBe("once");
    k.orders.observe(w.view);
    k.orders.decided("fight", w.view);
    expect(only(k).acted).toBe(0);
    k.orders.decided("retreat", w.view);
    expect(only(k).state).toBe("done");
    expect(k.notes.at(-1)).toEqual({ text: "Did as told, once: Run away the first time you see a unique", notable: true });
  });

  it("puts its line in the decision state and asks one typed question for it", async () => {
    const k = kit({ persona: devout });
    const w = world({ map: ROOM, player: { depth: 1 } });
    k.orders.give("Always rest when you are wounded", "panel");
    await k.orders.settled();
    w.setPlayer({ hp: 5, maxHp: 20 });
    k.orders.observe(w.view);
    expect(k.orders.note(w.view)).toContain('Your patron\'s standing instruction: "Always rest when you are wounded".');
    const qs = k.orders.ask([{ goal: "rest", criteria: "hurt" }, { goal: "explore", criteria: "walk" }], w.view);
    expect(Object.keys(qs)).toEqual([`order_${only(k).id}`]);
  });
});

describe("the model sorts an instruction", () => {
  it("refines the code reading and never blocks the give", async () => {
    const k = kit({
      reply: () => Promise.resolve(good({ aim: pickAnswer("weapon"), kind: pickAnswer("order") })),
    });
    const r = k.orders.give("Sing to the moon", "panel");
    if (!r.ok) throw new Error("not taken");
    expect(r.instruction.sorted.aim).toBeNull();
    await k.orders.settled();
    expect(only(k).sorted.aim).toBe("weapon");
    expect(k.requests).toHaveLength(1);
  });

  it("keeps the code reading when no model is available", async () => {
    const k = kit();
    k.orders.give("Suit up in the armor shop", "panel");
    await k.orders.settled();
    expect(only(k).sorted).toEqual(sortByCode("Suit up in the armor shop").sorted);
  });

  it("keeps a player's correction over a later model answer", async () => {
    const k = kit({ reply: () => Promise.resolve(good({ aim: pickAnswer("weapon") })) });
    const r = k.orders.give("Suit up in the armor shop", "panel");
    if (!r.ok) throw new Error("not taken");
    k.orders.correct(r.instruction.id, { sorted: { aim: "lantern" } });
    await k.orders.settled();
    expect(only(k).sorted.aim).toBe("lantern");
  });

  it("repeating an instruction refreshes it instead of adding a copy", () => {
    const k = kit();
    k.orders.give("Reach 500 ft", "panel");
    const again = k.orders.give("  reach 500   FT ", "hotkey");
    expect(again.ok && again.repeated).toBe(true);
    expect(k.orders.list()).toHaveLength(1);
  });

  it("refuses empty text and cuts very long text", () => {
    const k = kit();
    expect(k.orders.give("   ", "panel")).toEqual({ ok: false, problem: "Write the instruction first." });
    const r = k.orders.give("x".repeat(5000), "panel");
    expect(r.ok && r.instruction.text.length).toBe(2000);
  });
});

describe("adherence", () => {
  const neutral = (): Persona => {
    const p = defaultPersona("N");
    p.sliders.devotion = 50;
    p.sliders.resentment = 0;
    p.sliders.stubbornness = 50;
    p.sliders.strength = 50;
    return p;
  };
  const flee = sortByCode("Run away from uniques").sorted;
  const plain = sortByCode("Rest when wounded").sorted;

  it("rises with Devotion", () => {
    const lo = neutral(); lo.sliders.devotion = 10;
    const hi = neutral(); hi.sliders.devotion = 90;
    expect(targetAdherence(plain, hi)).toBeGreaterThan(targetAdherence(plain, lo));
  });

  it("falls with Resentment", () => {
    const lo = neutral();
    const hi = neutral(); hi.sliders.resentment = 90;
    expect(targetAdherence(plain, hi)).toBeLessThan(targetAdherence(plain, lo));
  });

  it("falls when the instruction clashes with the persona's traits, more for a stubborn one", () => {
    const meek = neutral(); meek.sliders.boldness = 0; meek.sliders.pride = 0;
    const proud = neutral(); proud.sliders.boldness = 100; proud.sliders.pride = 100;
    expect(clash(flee, proud)).toBeGreaterThan(clash(flee, meek));
    expect(targetAdherence(flee, proud)).toBeLessThan(targetAdherence(flee, meek));
    const mild = { ...proud, sliders: { ...proud.sliders, stubbornness: 0 } };
    const dug = { ...proud, sliders: { ...proud.sliders, stubbornness: 100 } };
    expect(targetAdherence(flee, dug)).toBeLessThan(targetAdherence(flee, mild));
  });

  it("changes slowly for a stubborn persona", () => {
    const soft = neutral(); soft.sliders.stubbornness = 0; soft.sliders.devotion = 100;
    const hard = neutral(); hard.sliders.stubbornness = 100; hard.sliders.devotion = 100;
    const a = nextAdherence(0.2, plain, soft);
    const b = nextAdherence(0.2, plain, hard);
    expect(a).toBeGreaterThan(b);
    expect(b).toBeGreaterThan(0.2);
  });

  it("scales with persona strength", () => {
    const weak = neutral(); weak.sliders.devotion = 100; weak.sliders.strength = 0;
    const strong = neutral(); strong.sliders.devotion = 100; strong.sliders.strength = 100;
    expect(targetAdherence(plain, strong)).toBeGreaterThan(targetAdherence(plain, weak));
  });

  it("always stays between 0 and 1 and names the stance", () => {
    const p = neutral(); p.sliders.devotion = 100; p.sliders.strength = 100;
    expect(targetAdherence(plain, p)).toBeLessThanOrEqual(1);
    const q = neutral(); q.sliders.devotion = 0; q.sliders.resentment = 100; q.sliders.strength = 100;
    expect(targetAdherence(plain, q)).toBeGreaterThanOrEqual(0);
    expect(stanceOf(0.1, plain, p)).toBe("ignoring");
    expect(stanceOf(0.3, plain, p)).toBe("grudgingly");
    expect(stanceOf(0.9, plain, p)).toBe("following");
  });

  it("weighs served options up and broken options down, by adherence", () => {
    const k = kit({ persona: devout });
    const r = k.orders.give("Run away from uniques", "panel");
    if (!r.ok) throw new Error("not taken");
    const dist = { retreat: 0.3, fight: 0.3, explore: 0.4 };
    const out = weigh(dist, { ...r.instruction, adherence: 1, memory: 1 });
    expect(out["retreat"]).toBeGreaterThan(dist.retreat);
    expect(out["fight"]).toBeLessThan(dist.fight);
    expect(out["explore"]).toBe(dist.explore);
    const half = weigh(dist, { ...r.instruction, adherence: 0.5, memory: 1 });
    expect(half["retreat"]).toBeLessThan(out["retreat"]!);
  });

  it("puts the stance in the decision state", async () => {
    const k = kit({ persona: (p) => { devout(p); p.sliders.resentment = 70; } });
    const w = world({ map: ROOM, player: { depth: 1 } });
    k.orders.give("Reach 500 ft", "panel");
    await k.orders.settled();
    k.orders.observe(w.view);
    expect(k.orders.note(w.view)).toContain('Your patron ordered: "Reach 500 ft". You intend to follow it grudgingly.');
  });
});

describe("the ceiling pass-through", () => {
  async function ordered(persona: (p: Persona) => void, text = "Run away from uniques", kind: "order" | "standing" = "order") {
    const k = kit({ persona });
    const w = world({ map: ROOM, player: { depth: 1 }, monsters: [{ grid: { x: 3, y: 1 }, race: "Fang, Farmer Maggot's Dog", level: 5, raceFlags: ["UNIQUE"] }] });
    k.orders.give(text, "panel", { kind });
    await k.orders.settled();
    k.orders.observe(w.view);
    return { k, w };
  }

  it("lets an order carry its options past the ceiling at high adherence", async () => {
    const { k, w } = await ordered(devout);
    expect(only(k).adherence).toBeGreaterThanOrEqual(PASS_ADHERENCE);
    expect(k.orders.passes(w.view).has("retreat")).toBe(true);
  });

  it("does not below that adherence", async () => {
    const { k, w } = await ordered((p) => { devout(p); p.sliders.devotion = 65; });
    expect(only(k).adherence).toBeLessThan(PASS_ADHERENCE);
    expect(k.orders.passes(w.view).size).toBe(0);
  });

  it("never passes for a standing instruction", async () => {
    const { k, w } = await ordered(devout, "Always run away when you see a unique", "standing");
    expect(only(k).kind).toBe("standing");
    expect(k.orders.passes(w.view).size).toBe(0);
  });

  it("does not pass for an order that is only faintly remembered", async () => {
    const { k, w } = await ordered(devout);
    k.orders.load({ items: [{ ...only(k), memory: 0.3 }] });
    expect(k.orders.passes(w.view).size).toBe(0);
  });
});

describe("forgetting and remembering", () => {
  const plain = (): Persona => {
    const p = defaultPersona("F");
    p.sliders.devotion = 50;
    p.quirks.forgetful.on = false;
    return p;
  };

  it("fades with game turns and with level changes", () => {
    const p = plain();
    expect(fade(1, 60_000, 0, p)).toBeLessThan(1);
    expect(fade(1, 0, 3, p)).toBeLessThan(fade(1, 0, 1, p));
    expect(fade(1, 0, 0, p)).toBe(1);
    expect(fade(0.01, 10_000_000, 0, p)).toBe(0);
  });

  it("fades faster when Forgetful and slower with high Devotion", () => {
    const base = plain();
    const forgetful = plain(); forgetful.quirks.forgetful.on = true; forgetful.quirks.forgetful.strength = 100;
    const devoted = plain(); devoted.sliders.devotion = 100;
    const cold = plain(); cold.sliders.devotion = 0;
    expect(fadeRate(forgetful)).toBeGreaterThan(fadeRate(base));
    expect(fadeRate(devoted)).toBeLessThan(fadeRate(base));
    expect(fadeRate(cold)).toBeGreaterThan(fadeRate(base));
  });

  it("drops an order from the state below the threshold, with a journal line", async () => {
    const k = kit({ persona: (p) => { devout(p); p.quirks.forgetful.on = true; p.quirks.forgetful.strength = 100; } });
    const w = world({ map: ROOM, player: { depth: 1 } });
    k.orders.give("Reach 500 ft", "panel");
    await k.orders.settled();
    k.orders.observe(w.view);
    w.advance(500_000);
    k.orders.observe(w.view);
    expect(only(k).state).toBe("forgotten");
    expect(only(k).memory).toBeLessThan(FORGET_BELOW);
    expect(k.notes.at(-1)).toEqual({ text: "Forgot the order: Reach 500 ft", notable: true });
    expect(k.orders.note(w.view)).toBeNull();
  });

  it("refreshes a standing instruction when it is repeated or acted on", async () => {
    const k = kit({ persona: devout });
    const w = world({ map: ROOM, player: { depth: 1 } });
    k.orders.give("Always rest when you are wounded", "panel");
    await k.orders.settled();
    k.orders.load({ items: [{ ...only(k), memory: 0.4 }] });
    w.setPlayer({ hp: 5, maxHp: 20 });
    k.orders.decided("rest", w.view);
    expect(only(k).memory).toBeCloseTo(0.65, 5);
    k.orders.give("Always rest when you are wounded", "panel");
    expect(only(k).memory).toBe(1);
  });

  it("keeps a faint memory of a forgotten standing instruction and brings it back on its trigger", async () => {
    let draw = 0.99;
    const k = kit({ persona: (p) => { devout(p); p.quirks.forgetful.on = true; p.quirks.forgetful.strength = 100; }, rng: () => draw });
    const w = world({ map: ROOM, player: { depth: 1 } });
    k.orders.give("Always rest when you are wounded", "panel");
    await k.orders.settled();
    k.orders.observe(w.view);
    w.advance(500_000);
    k.orders.observe(w.view);
    expect(only(k)).toMatchObject({ state: "forgotten", memory: FAINT });
    w.setPlayer({ hp: 5, maxHp: 20 });
    k.orders.observe(w.view);
    expect(only(k).state).toBe("forgotten");
    w.setPlayer({ hp: 20, maxHp: 20 });
    k.orders.observe(w.view);
    draw = 0;
    w.setPlayer({ hp: 5, maxHp: 20 });
    k.orders.observe(w.view);
    expect(only(k).state).not.toBe("forgotten");
    expect(k.notes.at(-1)!.text).toBe("Remembered: Always rest when you are wounded");
  });

  it("never brings an order back", async () => {
    const k = kit({ persona: (p) => { devout(p); p.quirks.forgetful.on = true; p.quirks.forgetful.strength = 100; }, rng: () => 0 });
    const w = world({ map: ROOM, player: { depth: 1 } });
    k.orders.give("Reach 500 ft", "panel");
    await k.orders.settled();
    k.orders.observe(w.view);
    w.advance(500_000);
    k.orders.observe(w.view);
    w.setPlayer({ depth: 2 });
    k.orders.observe(w.view);
    expect(only(k).state).toBe("forgotten");
  });
});

describe("instructions kept", () => {
  function three(k: Kit): void {
    k.orders.give("Reach 500 ft", "panel", { kind: "order" });
    k.orders.give("Always rest when you are wounded", "panel");
    k.orders.give("Keep two Flasks of Oil", "panel");
  }

  it("drops the one the model names when the limit is passed", async () => {
    const k = kit({
      reply: (r) => Promise.resolve({
        ok: true,
        answers: r.questions["drop"] === undefined ? {} : { drop: pickAnswer("i2") },
        usage: { inputTokens: 5, outputTokens: 1, estimated: false }, latencyMs: 1,
      } as AskResult),
    });
    k.kept.n = 2;
    three(k);
    await k.orders.settled();
    expect(k.orders.live()).toHaveLength(2);
    expect(k.orders.list().find((i) => i.id === "i2")!.state).toBe("abandoned");
    expect(k.notes.some((n) => n.text.startsWith("Dropped the standing instruction to keep the number down: Always rest"))).toBe(true);
  });

  it("drops the lowest adherence times memory without a model", async () => {
    const k = kit();
    k.kept.n = 2;
    three(k);
    await k.orders.settled();
    expect(k.orders.live()).toHaveLength(2);
    expect(k.orders.list().filter((i) => i.state === "abandoned")).toHaveLength(1);
  });

  it("keeps everything under the limit", async () => {
    const k = kit();
    three(k);
    await k.orders.settled();
    expect(k.orders.live()).toHaveLength(3);
  });
});

describe("persistence", () => {
  it("saves ended items only up to a cap and loads them back", async () => {
    const k = kit({ persona: devout });
    for (let n = 0; n < 30; n += 1) {
      const r = k.orders.give(`Reach ${String(n + 1)}00 ft`, "panel", { kind: "order" });
      if (r.ok) k.orders.retire(r.instruction.id);
    }
    await k.orders.settled();
    expect(k.saved.at(-1)!.items.length).toBeLessThanOrEqual(20);
    const other = kit();
    other.orders.load(k.saved.at(-1)!);
    expect(other.orders.list()).toHaveLength(k.saved.at(-1)!.items.length);
    other.orders.give("Reach 9900 ft", "panel");
    expect(new Set(other.orders.list().map((i) => i.id)).size).toBe(other.orders.list().length);
    other.orders.reset();
    expect(other.orders.list()).toHaveLength(0);
  });

  it("recognises an item in the pack for an item order", async () => {
    const k = kit({ persona: devout });
    const w = world({ map: ROOM, pack: ["2 Flasks of Oil"] });
    k.orders.give("Keep two Flasks of Oil", "panel", { kind: "order" });
    await k.orders.settled();
    k.orders.observe(w.view);
    expect(only(k).state).toBe("done");
  });
});

describe("Gratitude", () => {
  it("rises by 3 with the blessing when a liked order is done", async () => {
    const glad = kit({ persona: devout });
    glad.persona.current.sliders.devotion = 60;
    glad.persona.current.sliders.gratitude = 80;
    glad.orders.give("Reach 500 ft", "panel");
    await glad.orders.settled();
    glad.orders.observe(world({ map: ROOM, player: { depth: 10, maxDepth: 10 } }).view);
    expect(glad.persona.current.sliders.gratitude).toBe(83);
    expect(glad.persona.current.sliders.devotion).toBeGreaterThan(60);
  });

  it("rises by 2 with the Resentment when a disliked order was followed grudgingly", async () => {
    const grudge = kit({ persona: (p) => { p.sliders.devotion = 45; p.sliders.resentment = 70; p.sliders.gratitude = 40; p.sliders.stubbornness = 0; } });
    grudge.orders.give("Reach 500 ft", "panel");
    await grudge.orders.settled();
    expect(only(grudge).state).toBe("grudgingly");
    grudge.orders.observe(world({ map: ROOM, player: { depth: 10, maxDepth: 10 } }).view);
    expect(grudge.persona.current.sliders.resentment).toBe(75);
    expect(grudge.persona.current.sliders.gratitude).toBe(42);
  });

  it("stops at 100", async () => {
    const glad = kit({ persona: devout });
    glad.persona.current.sliders.gratitude = 99;
    glad.orders.give("Reach 500 ft", "panel");
    await glad.orders.settled();
    glad.orders.observe(world({ map: ROOM, player: { depth: 10, maxDepth: 10 } }).view);
    expect(glad.persona.current.sliders.gratitude).toBe(100);
  });
});