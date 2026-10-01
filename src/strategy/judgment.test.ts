import { describe, expect, it } from "vitest";
import type { StoreView } from "@rpgm-tools/neo-angband-core";
import { suppliedWorld, world } from "../harness.js";
import { JEV, type AskResult } from "../brain/backend.js";
import { createTally } from "../brain/tally.js";
import type { Answer, SystemOneRequest } from "../brain/systemone.js";
import { archetype, defaultPersona, type Persona } from "../persona/persona.js";
import { readPack } from "../brain/pack.js";
import { supplyNeeds } from "../town/needs.js";
import { shoppingList } from "../town/shop.js";
import { judgmentsFor, purchaseCandidates, purchaseOrder, townChance, townReason, type PurchaseKind } from "./judgment.js";
import { drive, pursuitsFor, readinessExtra } from "./pursuits.js";
import { missingEssentials } from "./readiness.js";
import { createStrategy } from "./review.js";
import { candidateAims } from "./aims.js";

const ROOM = ["#####", "#.@.#", "#####"];

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

function reply(answers: Record<string, Answer>): AskResult {
  return { ok: true, answers, usage: { inputTokens: 100, outputTokens: 10, estimated: false }, model: null, latencyMs: 1 } as AskResult;
}

/** A character on dungeon level 6 with a Recall scroll, above the margin that forces a trip but short of a full kit. */
function shortKit() {
  return world({
    map: ROOM,
    player: { depth: 6, maxDepth: 6, level: 12, maxLevel: 12, hp: 90, maxHp: 90, gold: 400, light: 1 },
    pack: ["a Scroll of Word of Recall", "3 Potions of Cure Light Wounds", "2 Scrolls of Phase Door", "5 Rations of Food", "2 Wooden Torches (5000 turns)"],
    worn: ["a Wooden Torch (5000 turns)"],
  });
}

function rig(persona: Persona | null, send: (request: SystemOneRequest) => Promise<AskResult>, backend: typeof JEV | null = JEV, rng: () => number = () => 0) {
  const requests: SystemOneRequest[] = [];
  const logs: string[] = [];
  const strategy = createStrategy({
    backend: () => backend,
    send: (request) => {
      requests.push(request);
      return send(request);
    },
    tally: createTally({ perSessionUsd: 0, perDayUsd: 0 }),
    now: () => 0,
    log: (m) => logs.push(m),
    persona: () => persona,
    seed: () => "run-1",
    rng,
  });
  return { strategy, requests, logs };
}

describe("the trip to town as the persona's call", () => {
  it("is only weighed in the dungeon above the supply margin and short of the persona's kit", () => {
    const w = shortKit();
    expect(townReason(w.view, defaultPersona())).toMatch(/^The pack holds .*Word of Recall scroll is in the pack\. The character has 400 gold\.$/);
    w.setPlayer({ depth: 0 });
    expect(townReason(w.view, defaultPersona())).toBeNull();
    const low = world({ map: ROOM, player: { depth: 6, maxDepth: 6, level: 12, gold: 400, light: 1 }, pack: ["a Scroll of Word of Recall", "a Potion of Cure Light Wounds"], worn: ["a Wooden Torch (5000 turns)"] });
    expect(townReason(low.view, defaultPersona())).toBeNull();
  });

  it("counts only supplies the persona would buy before saving its gold", () => {
    const w = shortKit();
    const saver: Persona = { ...defaultPersona(), sliders: { ...defaultPersona().sliders, savings: 100 } };
    const pursuits = pursuitsFor(saver, 6);
    expect(townReason(w.view, defaultPersona(), pursuitsFor(defaultPersona(), 6))).not.toBeNull();
    expect(townReason(w.view, saver, pursuits)).toBeNull();
  });

  it("reports the reason and the shortfall when a trip is worth weighing, and nothing once it is chosen", () => {
    const w = shortKit();
    const persona = archetype("tourist");
    const j = judgmentsFor(w.view, persona, [], true);
    expect(j.town?.reason).toMatch(/^The pack holds /);
    expect(j.town?.short).toBeGreaterThan(0);
    expect(judgmentsFor(w.view, persona, [], false).town).toBeNull();
  });

  it("sends a town lover home more often than a driven persona with a seeded rng", () => {
    const trips = (persona: Persona) => {
      const rng = seeded(11);
      const pursuits = pursuitsFor(persona, 6);
      let n = 0;
      for (let i = 0; i < 1000; i += 1) if (rng() < townChance(persona, pursuits, 0.4)) n += 1;
      return n;
    };
    const tourist = trips(archetype("tourist"));
    const berserker = trips(archetype("berserker"));
    expect(tourist).toBeGreaterThan(berserker * 1.3);
    expect(trips(defaultPersona())).toBeGreaterThan(berserker);
  });

  it("decides the trip home in code without a model", async () => {
    const r = rig(defaultPersona(), () => Promise.reject(new Error("unexpected request")), null, () => 0);
    r.strategy.observe(shortKit().view);
    await r.strategy.settled();
    expect(r.requests).toEqual([]);
    expect(r.strategy.townCall()).not.toBeNull();
  });

  it("keeps the persona's call for the trip and clears it at depth 0", async () => {
    const r = rig(archetype("tourist"), () => Promise.resolve(reply({})));
    const w = shortKit();
    r.strategy.observe(w.view);
    await r.strategy.settled();
    expect(r.strategy.townCall()).not.toBeNull();
    for (const request of r.requests) expect(request.questions).not.toHaveProperty("town_now");
    w.setPlayer({ depth: 0 });
    r.strategy.observe(w.view);
    expect(r.strategy.townCall()).toBeNull();
  });

  it("stays when the draw goes against the trip", async () => {
    const r = rig(archetype("berserker"), () => Promise.resolve(reply({})), JEV, () => 0.99);
    r.strategy.observe(shortKit().view);
    await r.strategy.settled();
    expect(r.strategy.townCall()).toBeNull();
    expect(r.logs).toContain("Squire thought about a trip to town and stayed below; the pack can last a while yet.");
  });
});

describe("the buying order beyond the survival basket", () => {
  function town(persona: Persona) {
    const w = suppliedWorld({ map: ROOM, player: { depth: 0, maxDepth: 4, level: 10, maxLevel: 10, gold: 2000 } });
    return { w, candidates: purchaseCandidates(w.view, persona, candidateAims(w.view, [], persona)) };
  }

  it("offers saving the gold beside what the pack still lacks, and only once the basket is stocked", () => {
    const { candidates } = town(defaultPersona());
    expect(candidates).toContain("save");
    expect(candidates.length).toBeGreaterThan(1);
    const bare = world({ map: ROOM, player: { depth: 0, gold: 2000 } });
    expect(purchaseCandidates(bare.view, defaultPersona(), [])).toEqual([]);
  });

  it("reports the purchase candidates once the basket is stocked", () => {
    const persona = archetype("miser");
    const { w } = town(persona);
    const j = judgmentsFor(w.view, persona, candidateAims(w.view, [], persona), true);
    expect(j.purchases.length).toBeGreaterThan(1);
    expect(j.purchases).toContain("save");
  });

  it("orders a miser's gold into savings and a gear lover's into gear with a seeded rng", () => {
    const candidates: PurchaseKind[] = ["healing", "phase", "gear", "save"];
    const collector = defaultPersona("Collector");
    Object.assign(collector.sliders, { greed: 80, curiosity: 90, hoarding: 95, savings: 10 });
    const first = (persona: Persona, kind: PurchaseKind) => {
      const rng = seeded(3);
      let n = 0;
      for (let i = 0; i < 200; i += 1) {
        const order = purchaseOrder(candidates, persona, pursuitsFor(persona, 4), rng);
        if (order.indexOf(kind) < order.indexOf(kind === "save" ? "gear" : "save")) n += 1;
      }
      return n;
    };
    expect(first(archetype("miser"), "save")).toBeGreaterThan(150);
    expect(first(collector, "gear")).toBeGreaterThan(150);
    const coward = purchaseOrder(candidates, archetype("coward"), pursuitsFor(archetype("coward"), 4), seeded(5));
    expect(coward.indexOf("phase")).toBeLessThan(coward.indexOf("gear"));
  });

  it("does not buy supplies the persona ranked below keeping its gold", () => {
    const w = suppliedWorld({ map: ROOM, player: { depth: 0, level: 10, gold: 2000 } });
    const needs = supplyNeeds(w.view, readPack(w.view), null);
    const store: StoreView = {
      featName: "Alchemy Shop", isHome: false, owner: "", maxCost: 0, gold: 2000,
      stock: [{ index: 0, name: "Potions of Cure Light Wounds", price: 20, number: 10, weight: 4, tval: 0, sval: 0 }],
    } as unknown as StoreView;
    expect(shoppingList(needs, store, 2000, null).map((p) => p.kind)).toContain("healing");
    expect(shoppingList(needs, store, 2000, null, ["save", "healing"])).toEqual([]);
    expect(shoppingList(needs, store, 2000, null, ["healing", "save"]).map((p) => p.kind)).toContain("healing");
  });

  it("sets this visit's order in code without a model", async () => {
    const persona = archetype("miser");
    const r = rig(persona, () => Promise.reject(new Error("unexpected request")), null, () => 0);
    r.strategy.observe(town(persona).w.view);
    await r.strategy.settled();
    expect(r.requests).toEqual([]);
    expect(r.strategy.purchaseOrder()?.[0]).toBe("save");
  });
});

describe("town readiness reads drive", () => {
  it("asks a driven persona for the floor and a cautious one for more", () => {
    expect(drive(archetype("berserker"))).toBeGreaterThan(drive(archetype("tourist")));
    expect(readinessExtra(archetype("berserker"))).toBe(0);
    expect(readinessExtra(null)).toBe(1);
    expect(readinessExtra(archetype("tourist"))).toBe(2);
    const w = world({ map: ROOM, player: { depth: 0, light: 1 }, pack: ["a Potion of Cure Light Wounds", "a Scroll of Phase Door", "2 Rations of Food", "a Wooden Torch (5000 turns)"], worn: ["a Wooden Torch (5000 turns)"] });
    expect(missingEssentials(w.view, archetype("berserker")).map((need) => need.kind)).toEqual(["healing", "phase"]);
    expect(missingEssentials(w.view, archetype("tourist")).map((need) => need.kind)).toEqual(expect.arrayContaining(["healing", "phase", "food"]));
  });

  it("keeps today's wants and wording for the default persona", () => {
    const w = world({ map: ROOM, player: { depth: 0, light: 0 } });
    expect(missingEssentials(w.view, defaultPersona()).map((need) => need.reason)).toEqual(missingEssentials(w.view).map((need) => need.reason));
    expect(missingEssentials(w.view).map((need) => need.reason)).toEqual(expect.arrayContaining(["two healing potions", "two usable Phase Doors", "two food units"]));
  });
});
