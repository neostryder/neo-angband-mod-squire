import type { AgentView, StoreView } from "@rpgm-tools/neo-angband-core";
import { describe, expect, it } from "vitest";
import { JEV, type AskResult } from "../brain/backend.js";
import { createGoalPlanner } from "../brain/goals.js";
import { createTally } from "../brain/tally.js";
import { FEAT, itemNamed, suppliedWorld, world } from "../harness.js";
import { memoryStore } from "../memory/kv.js";
import { defaultPersona, type Persona } from "../persona/persona.js";
import { createRuntime } from "../runtime.js";
import { defaultCfg } from "../settings.js";
import { candidateAims } from "../strategy/aims.js";
import { createStrategy, rankByScore } from "../strategy/review.js";
import { emptyFlourishes } from "../learning/family-ways.js";
import { createStoreMemory, LASTING_MEMORY, readStoreMemory, stockConfidence } from "./memory.js";
import { neededEntrances, townTripPlan } from "./plan.js";

function shop(name = "a Lantern", price = 100, owner = "Bilbo"): StoreView {
  return {
    feat: FEAT.GENERAL, featName: "STORE_GENERAL", isHome: false, owner: { name: owner, purse: 5000 },
    stock: [{ ...itemNamed(name, 0), index: 0, number: 1, price }],
  };
}

function rig(persona: Persona | null = null) {
  const logs: string[] = [];
  const strategy = createStrategy({
    persona: () => persona,
    backend: () => null, send: () => Promise.reject(new Error("unexpected request")),
    tally: createTally({ perSessionUsd: 0, perDayUsd: 0 }), now: () => 0, log: (line) => logs.push(line),
  });
  return { strategy, logs };
}

describe("shop memory", () => {
  it("learns only the entered shop and never reads stock while outside or underground", () => {
    const unseen = { ...shop(), feat: FEAT.ALCHEMY, get stock(): never { throw new Error("unvisited shelf"); } };
    const w = world({ map: ["######", "#@.GA#", "######"], player: { depth: 0 }, stores: [shop(), unseen] });
    let reads = 0;
    const view: AgentView = { ...w.view, stores: () => { reads += 1; return w.view.stores(); } };
    const memory = createStoreMemory();
    memory.observe(view, w.terrain, null);
    expect(reads).toBe(0);
    expect(memory.all()).toEqual([]);
    w.moveTo({ x: 3, y: 1 });
    memory.observe(view, w.terrain, null);
    expect(reads).toBe(1);
    expect(memory.all()).toMatchObject([{ feat: FEAT.GENERAL, name: "General Store", owner: "Bilbo", turn: 1, stock: [{ name: "a Lantern", price: 100, count: 1 }] }]);
    w.setPlayer({ depth: 1 });
    memory.observe(view, w.terrain, null);
    expect(reads).toBe(1);
  });

  it("plans outside from remembered prices even when live stock changes", () => {
    const w = world({ map: ["#####", "#@.G#", "#####"], player: { depth: 0 }, worn: ["a Wooden Torch"], stores: [shop()] });
    const { strategy } = rig();
    expect(candidateAims(w.view).find((aim) => aim.kind === "lantern")?.how).toBe("hunt");
    w.moveTo({ x: 3, y: 1 });
    strategy.remember(w.view, w.terrain);
    w.moveTo({ x: 1, y: 1 });
    strategy.remember(w.view, w.terrain);
    w.setStores([shop("a Lantern", 700)]);
    const view = { ...w.view, stores: (): never => { throw new Error("outside"); } };
    strategy.observe(view);
    expect(strategy.ranked().find((aim) => aim.kind === "lantern")).toMatchObject({ how: "save", price: 100, stock: { feat: FEAT.GENERAL, confidence: 1 } });
  });

  it("fades for a forgetful persona, discounts both rankings, and stops funding an expired aim", async () => {
    const w = world({ map: ["#####", "#@.G#", "#####"], player: { depth: 0 }, worn: ["a Wooden Torch"], stores: [shop()] });
    const forgetful = defaultPersona();
    forgetful.quirks.forgetful = { on: true, strength: 0 };
    forgetful.sliders.patience = 50;
    forgetful.sliders.greed = 50;
    forgetful.sliders.impulsiveness = 50;
    forgetful.sliders.strength = 0;
    forgetful.sliders.volatility = 0;
    const { strategy } = rig(forgetful);
    const view = { ...w.view, constants: () => ({ ...w.view.constants(), storeTurns: 20 }) };
    w.moveTo({ x: 3, y: 1 });
    strategy.remember(view, w.terrain);
    w.moveTo({ x: 1, y: 1 });
    strategy.remember(view, w.terrain);
    strategy.observe(view);
    await strategy.settled();
    w.advance(200);
    strategy.observe(view);
    const aims = strategy.ranked();
    const lantern = aims.find((aim) => aim.kind === "lantern")!;
    const depth = aims.find((aim) => aim.kind === "depth")!;
    expect(lantern.stock?.confidence).toBe(0.5);
    expect(aims.findIndex((aim) => aim.kind === "armour")).toBeLessThan(aims.indexOf(lantern));
    const score = (value: number) => ({ type: "score" as const, score: value, confidence: 1, probabilities: [] });
    expect(rankByScore([lantern, depth], { lantern: score(3), depth: score(2) })[0]?.kind).toBe("depth");
    w.advance(200);
    strategy.observe(view);
    expect(stockConfidence(strategy.shops()[0]!, view.turn())).toBe(0);
    expect(strategy.ranked().find((aim) => aim.kind === "lantern")).toMatchObject({ how: "hunt", price: null });
  });

  it("keeps an exact memory unless the persona is forgetful, whose habits then shape how fast it fades", () => {
    const w = world({ map: ["#####", "#@.G#", "#####"], player: { depth: 0 }, stores: [shop()] });
    w.moveTo({ x: 3, y: 1 });
    const persona = defaultPersona();
    const lifetime = (rng: () => number) => {
      const memory = createStoreMemory([], () => {}, rng);
      memory.observe(w.view, w.terrain, persona);
      return memory.all()[0]!.lifetime;
    };
    expect(lifetime(() => 0.5)).toBe(LASTING_MEMORY);
    persona.sliders.patience = 100;
    persona.sliders.greed = 100;
    persona.sliders.impulsiveness = 0;
    expect(lifetime(() => 0.5)).toBe(LASTING_MEMORY);
    persona.quirks.forgetful = { on: true, strength: 20 };
    persona.sliders.strength = 70;
    persona.sliders.volatility = 100;
    const patient = lifetime(() => 0.5);
    expect(patient).toBeLessThan(LASTING_MEMORY);
    persona.sliders.patience = 0;
    persona.sliders.greed = 0;
    persona.sliders.impulsiveness = 100;
    expect(lifetime(() => 0.5)).toBeLessThan(patient);
  });

  it("replaces the former owner's memory only on revisiting the shop", () => {
    const w = world({ map: ["#####", "#@.G#", "#####"], player: { depth: 0 }, stores: [shop()] });
    const memory = createStoreMemory();
    w.moveTo({ x: 3, y: 1 });
    memory.observe(w.view, w.terrain, null);
    w.moveTo({ x: 1, y: 1 });
    memory.observe(w.view, w.terrain, null);
    w.setStores([{ ...shop("a Flask of Oil", 3, "Ada"), stock: [] }]);
    memory.observe(w.view, w.terrain, null);
    expect(memory.all()[0]?.owner).toBe("Bilbo");
    w.moveTo({ x: 3, y: 1 });
    memory.observe(w.view, w.terrain, null);
    expect(memory.all()[0]).toMatchObject({ owner: "Ada", stock: [] });
  });

  it("reshapes a sold-out saving aim and logs one disappointment on entry", () => {
    const w = world({ map: ["#####", "#@.G#", "#####"], player: { depth: 0, gold: 20 }, worn: ["a Wooden Torch"], stores: [shop()] });
    const { strategy, logs } = rig();
    w.moveTo({ x: 3, y: 1 });
    strategy.remember(w.view, w.terrain);
    expect(strategy.ranked().find((aim) => aim.kind === "lantern")?.how).toBe("save");
    w.moveTo({ x: 1, y: 1 });
    strategy.remember(w.view, w.terrain);
    w.setStores([{ ...shop(), stock: [] }]);
    w.moveTo({ x: 3, y: 1 });
    strategy.remember(w.view, w.terrain);
    strategy.remember(w.view, w.terrain);
    expect(strategy.ranked().find((aim) => aim.kind === "lantern")).toMatchObject({ how: "hunt", price: null });
    expect(logs).toEqual(["I put coins aside for a Lantern. Now the shopkeeper has none. I should have come back sooner."]);
  });

  it("does not mourn an item the character just bought", () => {
    const w = world({ map: ["#####", "#@.G#", "#####"], player: { depth: 0 }, worn: ["a Wooden Torch"], stores: [shop()] });
    const { strategy, logs } = rig();
    w.moveTo({ x: 3, y: 1 });
    strategy.remember(w.view, w.terrain);
    w.setPack(["a Lantern"]);
    w.setStores([{ ...shop(), stock: [] }]);
    strategy.remember(w.view, w.terrain);
    expect(logs).toEqual([]);
    expect(strategy.ranked().find((aim) => aim.kind === "lantern")?.how).toBe("try");
  });

  it("keeps an aim when a remembered stack becomes singular", () => {
    const stock = { ...shop("2 Lanterns"), stock: [{ ...shop("2 Lanterns").stock[0]!, number: 2 }] };
    const w = world({ map: ["#####", "#@.G#", "#####"], player: { depth: 0 }, worn: ["a Wooden Torch"], stores: [stock] });
    const { strategy, logs } = rig();
    w.moveTo({ x: 3, y: 1 });
    strategy.remember(w.view, w.terrain);
    expect(strategy.shops()[0]?.stock[0]?.count).toBe(2);
    w.moveTo({ x: 1, y: 1 });
    strategy.remember(w.view, w.terrain);
    w.setStores([shop()]);
    w.moveTo({ x: 3, y: 1 });
    strategy.remember(w.view, w.terrain);
    expect(logs).toEqual([]);
    expect(strategy.shops()[0]?.stock[0]?.count).toBe(1);
    expect(strategy.ranked().find((aim) => aim.kind === "lantern")?.how).toBe("save");
  });

  it("drops a sold weapon aim and rejects a late ranking of the old shelf", async () => {
    const w = world({ map: ["#####", "#@.G#", "#####"], player: { depth: 0 }, stores: [shop("a Dagger (1d4) of Slay Evil", 900)] });
    const logs: string[] = [];
    let release!: (value: AskResult) => void;
    const strategy = createStrategy({
      backend: () => JEV, send: () => new Promise((resolve) => { release = resolve; }),
      tally: createTally({ perSessionUsd: 0, perDayUsd: 0 }), now: () => 0, log: (line) => logs.push(line),
    });
    w.moveTo({ x: 3, y: 1 });
    strategy.remember(w.view, w.terrain);
    strategy.observe(w.view);
    w.moveTo({ x: 1, y: 1 });
    strategy.remember(w.view, w.terrain);
    w.setStores([{ ...shop(), stock: [] }]);
    w.moveTo({ x: 3, y: 1 });
    strategy.remember(w.view, w.terrain);
    release({ ok: true, answers: {}, usage: { inputTokens: 0, outputTokens: 0, estimated: false }, model: null, latencyMs: 0, server: "test" });
    await strategy.settled();
    expect(strategy.ranked().some((aim) => aim.kind === "weapon")).toBe(false);
    expect(logs).toHaveLength(1);
    expect(logs[0]).toContain("Dagger (1d4) of Slay Evil");
  });

  it("offers one visit to an unvisited mapped shop even with a full supply basket", () => {
    const w = suppliedWorld({ map: ["#####", "#@.W#", "#####"], player: { depth: 0, gold: 0 } });
    const steering = () => ({ aims: [], tripAllowed: () => true, storeMemory: [] });
    const planner = createGoalPlanner({ cfg: defaultCfg(), terrain: w.terrain, log: () => {}, strategy: steering });
    expect(planner.ask(w.view).context?.offers.some((offer) => offer.goal === "shop")).toBe(true);
    const visited = new Set<number>();
    const plan = townTripPlan(w.terrain, null, visited, () => {}, [], emptyFlourishes, steering);
    expect(plan.step(w.view, w.act)).toEqual({ code: "walk", dir: 6 });
    w.moveTo({ x: 3, y: 1 });
    expect(plan.step(w.view, w.act)).toEqual({ code: "shop-exit" });
    expect(plan.step(w.view, w.act)).toBeNull();
    expect(neededEntrances(w.view, w.terrain, null, visited, [], emptyFlourishes(), [])).toEqual([]);
  });

  it("persists through the character store and reloads without reading live stock", async () => {
    let stored: unknown;
    const host = { log: () => {}, characterStore: { get: () => stored, set: (value: unknown) => { stored = JSON.parse(JSON.stringify(value)); } } };
    const w = world({ map: ["#####", "#@.G#", "#####"], player: { depth: 0 }, worn: ["a Wooden Torch"], stores: [shop()] });
    const runtime = createRuntime(host, { store: memoryStore() });
    w.moveTo({ x: 3, y: 1 });
    runtime.observe(w.view, w.terrain);
    expect(runtime.character().storeMemory?.[0]?.stock[0]).toMatchObject({ name: "a Lantern", price: 100, count: 1 });
    const reloaded = createRuntime(host, { store: memoryStore() });
    expect(reloaded.strategy().shops()).toEqual(runtime.strategy().shops());
    w.moveTo({ x: 1, y: 1 });
    const view = { ...w.view, stores: (): never => { throw new Error("outside"); } };
    reloaded.strategy().observe(view);
    await reloaded.strategy().settled();
    expect(reloaded.strategy().ranked().find((aim) => aim.kind === "lantern")).toMatchObject({ how: "save", price: 100 });
    reloaded.strategy().reset();
    expect(createRuntime(host, { store: memoryStore() }).strategy().shops()).toEqual([]);
    expect(createRuntime({ log: () => {} }, { store: memoryStore() }).strategy().shops()).toEqual([]);
  });

  it("discards malformed saved stock", () => {
    expect(readStoreMemory([{ feat: 1, name: "shop", turn: 0, lifetime: Infinity, stock: [] }, null])).toEqual([]);
  });
});
