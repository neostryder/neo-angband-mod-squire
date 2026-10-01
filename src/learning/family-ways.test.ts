import { describe, expect, it } from "vitest";
import type { AgentView } from "@rpgm-tools/neo-angband-core";
import { itemNamed, suppliedWorld, world } from "../harness.js";
import { defaultPersona } from "../persona/persona.js";
import { inherit, type Lineage } from "./lineage.js";
import { createGoalPlanner, type GoalDigest } from "../brain/goals.js";
import type { Question } from "../brain/brain.js";
import { defaultCfg } from "../settings.js";
import { applySafetyFloor } from "../persona/blend.js";
import { readPack } from "../brain/pack.js";
import { supplyNeeds } from "../town/needs.js";
import { basketNeeds } from "../town/departure.js";
import { sellList } from "../town/shop.js";
import { townTripPlan } from "../town/plan.js";
import { memoryStore } from "../memory/kv.js";
import { createRuntime, type RunReportLike } from "../runtime.js";
import { readConfig, writeConfig } from "../config.js";
import { TV } from "../gear/compare.js";
import type { Milestone } from "./flourishes.js";
import {
  distrusted, distrustedUse, emptyFamilyFlourishes, emptyFlourishes, familyAfterDeath, flourishLines, inheritWays,
  mayReplaceMotto, nudgeGrounds, observeFlourishes, readFamilyFlourishes, readWays, trophyHandles, unknownUse, usedItem,
  type FamilyFlourishes,
} from "./family-ways.js";
import type { Persona } from "../persona/persona.js";

const GRIP = "Grip, Farmer Maggot's Dog";
const SCROLL = "a Scroll titled 'FOO BAR'";
const taboo = unknownUse(itemNamed(SCROLL, 1))!;
const MAP = ["########", "#.@....#", "########"];
const family = { superstitions: [taboo], darkDeaths: 1, bestFind: { depth: 3, value: 500, name: "a Dagger" }, motto: null, ancestralWeapons: [], cursedDepth: null };
const memories = { ...emptyFlourishes(), superstitions: [taboo], darkLesson: true, favouredDepth: 3 };
const baseLine: Lineage = { name: "Ada", generation: 1, ancestors: [], lore: [], grudges: [], flourishRecord: family };

function parent() {
  const p = defaultPersona("Ada");
  p.sliders.inheritance = 100;
  p.sliders.resemblance = 0;
  return p;
}

function asked(q: ReturnType<ReturnType<typeof createGoalPlanner>["ask"]>): Question<GoalDigest> {
  if ("handBack" in q || "reflex" in q) throw new Error("expected a question");
  return q;
}

describe("flourish inheritance", () => {
  it("enables each lineage setting by default and passes memories without passing physical trophies", () => {
    const p = parent();
    for (const id of ["inheritedSuperstitions", "darkLessons", "trophies", "favouredGrounds"] as const) expect(p.toggles[id]).toBe(true);
    const born = inherit({ ...baseLine, flourishes: { ...memories, trophies: [{ unique: GRIP, handle: 1, name: "a Dagger" }] } }, p, defaultPersona("Bea"), () => 1);
    expect(born.lineage.flourishes).toMatchObject({ superstitions: [taboo], darkLesson: true, favouredDepth: 3, trophies: [], uniqueKills: [], bestFind: null, lastUse: null });
    expect(born.lineage.flourishRecord).toEqual(family);
  });

  it("passes nothing with inheritance off, while keeping the family's record", () => {
    const p = parent();
    p.sliders.inheritance = 0;
    const born = inherit(baseLine, p, defaultPersona("Bea"), () => 0);
    expect(born.lineage.flourishes).toEqual(emptyFlourishes());
    expect(born.lineage.flourishRecord).toEqual(family);
  });

  it.each(["inheritedSuperstitions", "darkLessons", "favouredGrounds"] as const)("honours %s off on either parent or heir", (id) => {
    for (const side of ["parent", "heir"]) {
      const p = parent();
      const heir = defaultPersona("Bea");
      (side === "parent" ? p : heir).toggles[id] = false;
      const run = inheritWays(family, p, heir, () => 0);
      expect(id === "inheritedSuperstitions" ? run.superstitions : id === "darkLessons" ? run.darkLesson : run.favouredDepth).toEqual(id === "inheritedSuperstitions" ? [] : id === "darkLessons" ? false : null);
    }
  });

  it("trims superstitions and samples the single memories at partial inheritance", () => {
    const p = parent();
    p.sliders.inheritance = 25;
    const record = { ...family, superstitions: Array.from({ length: 6 }, (_, n) => ({ key: String(n), name: "a potion" })) };
    expect(inheritWays(record, p, defaultPersona(), () => 0.5)).toMatchObject({ superstitions: record.superstitions.slice(-2), darkLesson: false, favouredDepth: null });
    expect(inheritWays(family, p, defaultPersona(), () => 0.1)).toMatchObject({ darkLesson: true, favouredDepth: 3 });
  });
});

describe("superstitions", () => {
  it.each([SCROLL, "a Smoky Potion", "an Ivory Wand (3 charges)"])("records an unknown use of %s, without guessing its effect", (name) => {
    const w = world({ map: ["@"], pack: [name] });
    const code = /Scroll/.test(name) ? "read" : /Potion/.test(name) ? "quaff" : "aim-wand";
    const use = usedItem({ code, args: { handle: 1 } }, w.view);
    expect(use).toEqual(unknownUse(w.view.inventory()[0]!));
    const run = { ...emptyFlourishes(), lastUse: use };
    expect(familyAfterDeath(emptyFamilyFlourishes(), run, w.view, parent()).superstitions).toEqual([use]);
    expect(usedItem({ code: "walk", dir: 6 }, w.view)).toBeNull();
  });

  it("avoids an unknown item but permits its known kind and every known survival item", () => {
    const p = parent();
    const unknown = itemNamed(SCROLL, 1);
    expect(distrusted(unknown, memories, p)).toBe(true);
    for (const name of ["a Scroll of Phase Door", "a Scroll of Word of Recall", "a Potion of Cure Light Wounds", "a Wand of Magic Missile"]) {
      expect(distrusted(itemNamed(name, 1), memories, p)).toBe(false);
    }
    p.toggles.inheritedSuperstitions = false;
    expect(distrusted(unknown, memories, p)).toBe(false);
    expect(flourishLines(memories, p).some((l) => l.includes("distrusts"))).toBe(false);
  });

  it("checks the command and releases the fear when the same kind is identified", () => {
    const w = world({ map: ["@"], pack: [SCROLL] });
    const command = { code: "read", args: { handle: 1 } };
    expect(distrustedUse(command, w.view, memories, parent())).toBe(true);
    w.setPack(["a Scroll of Phase Door"]);
    expect(distrustedUse(command, w.view, memories, parent())).toBe(false);
    const next = observeFlourishes(memories, w.view, parent(), [], new Set());
    expect(next.superstitions).toEqual([]);
    expect(familyAfterDeath(family, { ...memories, lastUse: taboo }, w.view, parent()).superstitions).toEqual([]);
  });

  it("does not record a superstition with the setting off", () => {
    const p = parent();
    p.toggles.inheritedSuperstitions = false;
    expect(familyAfterDeath(emptyFamilyFlourishes(), { ...emptyFlourishes(), lastUse: taboo }, null, p).superstitions).toEqual([]);
  });

  it("leaves the pack capacity and known healing offers intact", () => {
    const w = suppliedWorld({ map: ["########", "#.@...>#", "########"], pack: [SCROLL], player: { hp: 15, maxHp: 60 }, monsters: [{ grid: { x: 3, y: 1 }, level: 4 }] });
    const p = createGoalPlanner({ cfg: defaultCfg(), terrain: w.terrain, log: () => {}, persona: parent(), reflex: false, flourishes: () => memories });
    expect(asked(p.ask(w.view)).context.offers.map((o) => o.goal)).toContain("heal");
    w.setMonsters([]);
    w.setPack([...Array.from({ length: 19 }, () => SCROLL), "3 Potions of Cure Light Wounds", "3 Scrolls of Phase Door", "5 Rations of Food", "2 Wooden Torches"]);
    w.setFloor([{ x: 2, y: 1, name: "a Potion of Cure Light Wounds" }]);
    expect(asked(p.ask(w.view)).context.offers.map((o) => o.goal)).not.toContain("pick_up");
  });
});

describe("lessons of the dark", () => {
  it("records death without light and raises the fuel target by one", () => {
    const w = world({ map: ["@"], player: { light: 0 }, worn: ["a Wooden Torch (0 turns)"] });
    expect(familyAfterDeath(emptyFamilyFlourishes(), emptyFlourishes(), w.view, parent()).darkDeaths).toBe(1);
    const normal = supplyNeeds(w.view, readPack(w.view), parent()).find((n) => n.kind === "light")!;
    const careful = supplyNeeds(w.view, readPack(w.view), parent(), true).find((n) => n.kind === "light")!;
    expect(careful.want).toBe(normal.want + 1);
    w.setPlayer({ light: 2 });
    expect(familyAfterDeath(emptyFamilyFlourishes(), emptyFlourishes(), w.view, parent()).darkDeaths).toBe(0);
  });

  it("uses lantern fuel and honours the setting and lights that need no fuel", () => {
    const w = world({ map: ["@"], worn: ["a Lantern"] });
    const p = parent();
    expect(supplyNeeds(w.view, readPack(w.view), p, true).find((n) => n.kind === "light")).toMatchObject({ name: "Flask of Oil", want: 11 });
    p.toggles.darkLessons = false;
    expect(supplyNeeds(w.view, readPack(w.view), p, true).find((n) => n.kind === "light")?.want).toBe(2);
    w.setPlayer({ light: 0 });
    expect(familyAfterDeath(emptyFamilyFlourishes(), memories, w.view, p).darkDeaths).toBe(0);
    p.toggles.darkLessons = true;
    w.setPlayer({ objectFlags: ["NO_FUEL"] });
    expect(supplyNeeds(w.view, readPack(w.view), p, true).some((n) => n.kind === "light")).toBe(false);
  });

  it("keeps the survival basket ahead of the extra fuel target", () => {
    const w = world({ map: ["@"], player: { depth: 0, light: 0 } });
    const needs = supplyNeeds(w.view, readPack(w.view), parent(), true);
    expect(needs.find((n) => n.kind === "light")?.want).toBe(3);
    expect(basketNeeds(w.view, needs).find((n) => n.kind === "light")?.want).toBe(2);
  });

  it.each([false, true])("buys an actual extra fuel unit for a lantern: %s", (lantern) => {
    const wareName = lantern ? "a Flask of Oil" : "a Wooden Torch";
    const w = world({ map: ["@G"], player: { depth: 0 }, worn: [lantern ? "a Lantern (7500 turns)" : "a Wooden Torch (5000 turns)"],
      pack: ["6 Potions of Cure Light Wounds", "5 Scrolls of Phase Door", "5 Rations of Food", "2 Wooden Torches (5000 turns)", "10 Flasks of Oil"] });
    w.moveTo({ x: 1, y: 0 });
    w.setStores([{ feat: 6, featName: "General Store", isHome: false, owner: { name: "Shopkeeper", purse: 1000 },
      stock: [{ ...itemNamed(wareName, 0), index: 0, price: 5, number: 10 }] }]);
    expect(townTripPlan(w.terrain, parent(), new Set(), () => {}, [], () => memories).step(w.view, w.act)).toEqual({ code: "shop-buy", args: { index: 0, quantity: 1 } });
    expect(townTripPlan(w.terrain, parent()).step(w.view, w.act)).toEqual({ code: "shop-exit" });
  });
});

describe("trophies", () => {
  const names = ["a Dagger (1d4) (+0,+0)", "3 Daggers (1d4) (+0,+0)"];
  function kit() {
    const w = world({ map: ["@"], player: { depth: 0 }, pack: names, worn: ["a Long Sword (2d5) (+0,+0)"], inspect: (ref) => ref === 2 ? `Dropped by ${GRIP} at 50 feet (level 1)` : null });
    const p = parent();
    p.sliders.pride = 90;
    p.sliders.selling = 90;
    return { w, p };
  }

  it("keeps one item per slain unique and sells the rest of a stack", () => {
    const { w, p } = kit();
    const run = observeFlourishes(emptyFlourishes(), w.view, p, [GRIP], new Set());
    expect(run.trophies).toEqual([{ unique: GRIP, handle: 2, name: names[1] }]);
    expect(observeFlourishes(run, w.view, p, [GRIP], new Set()).trophies).toHaveLength(1);
    expect(sellList(readPack(w.view), w.view, p, trophyHandles(run, w.view, p))).toMatchObject([{ handle: 2, quantity: 2 }]);
    expect(flourishLines(run, p)[0]).toContain(GRIP);
  });

  it("requires pride, the setting, and confirmed provenance from a unique it killed", () => {
    const { w, p } = kit();
    const observe = () => observeFlourishes(emptyFlourishes(), w.view, p, [GRIP], new Set());
    p.sliders.pride = 50;
    expect(observe().trophies).toEqual([]);
    p.sliders.pride = 90;
    p.toggles.trophies = false;
    expect(observe().trophies).toEqual([]);
    p.toggles.trophies = true;
    expect(observeFlourishes(emptyFlourishes(), w.view, p, [], new Set()).trophies).toEqual([]);
    expect(observeFlourishes(emptyFlourishes(), { ...w.view, inspectItem: undefined } as unknown as AgentView, p, [GRIP], new Set()).trophies).toEqual([]);
  });

  it("releases sale protection with trophies off or a full pack", () => {
    const { w, p } = kit();
    const run = observeFlourishes(emptyFlourishes(), w.view, p, [GRIP], new Set());
    p.toggles.trophies = false;
    expect(trophyHandles(run, w.view, p).size).toBe(0);
    expect(sellList(readPack(w.view), w.view, p, trophyHandles(run, w.view, p))).toMatchObject([{ handle: 2, quantity: 3 }]);
    p.toggles.trophies = true;
    w.setPack([...names, ...Array.from({ length: 21 }, () => "a Ration of Food")]);
    expect(trophyHandles(run, w.view, p).size).toBe(0);
    expect(observeFlourishes(emptyFlourishes(), w.view, p, [GRIP], new Set()).trophies).toEqual([]);
  });

  it("leaves needed gear available to wear and records no trophy for it", () => {
    const { w, p } = kit();
    w.setPack(["a Long Sword (3d6) (+5,+5)", "a Long Sword (3d6) (+5,+5)"]);
    expect(observeFlourishes(emptyFlourishes(), w.view, p, [GRIP], new Set()).trophies).toEqual([]);
  });

  it("passes preservation through the town selling plan", () => {
    const { w, p } = kit();
    const town = world({ map: ["@W"], player: { depth: 0 }, pack: names, worn: ["a Long Sword (2d5) (+0,+0)"] });
    town.moveTo({ x: 1, y: 0 });
    town.setStores([{ feat: 8, featName: "Weapon Smiths", isHome: false, owner: { name: "Smith", purse: 1000 }, stock: [] }]);
    const run = observeFlourishes(emptyFlourishes(), w.view, p, [GRIP], new Set());
    const plan = townTripPlan(town.terrain, p, new Set(), () => {}, [], () => run);
    expect(plan.step(town.view, town.act)).toEqual({ code: "shop-sell", args: { handle: 2, quantity: 2 } });
  });
});

describe("favoured grounds", () => {
  const dist = { descend: 0.4, explore: 0.6, retreat: 0.1 };
  const offers = [{ goal: "descend", risk: 0.1 }, { goal: "explore", risk: 0.1 }, { goal: "retreat", risk: 0.01 }];
  function ready(depth = 2) {
    return suppliedWorld({ map: ["########", "#.@...>#", "#.#### #", "########"], player: { depth, level: 10, maxLevel: 10, hp: 100, maxHp: 100 } });
  }

  it("remembers the highest valued dungeon find and its actual origin depth", () => {
    const w = world({ map: ["@"], player: { depth: 1 }, pack: ["a Dagger"], inspect: () => "Found lying on the floor at 150 feet (level 3)" });
    const view = { ...w.view, inventory: () => w.view.inventory().map((i) => ({ ...i, value: 500 })) };
    const run = observeFlourishes(emptyFlourishes(), view, parent(), [], new Set());
    expect(run.bestFind).toEqual(family.bestFind);
    expect(familyAfterDeath(emptyFamilyFlourishes(), run, view, parent()).bestFind).toEqual(family.bestFind);
    expect(familyAfterDeath(family, { ...run, bestFind: { depth: 2, value: 100, name: "a Dagger" } }, view, parent()).bestFind).toEqual(family.bestFind);
  });

  it("ignores store purchases and stops collecting finds with the setting off", () => {
    const w = world({ map: ["@"], player: { depth: 0 }, pack: ["a Dagger"], inspect: () => "Bought from a store" });
    const view = { ...w.view, inventory: () => w.view.inventory().map((i) => ({ ...i, value: 500 })) };
    expect(observeFlourishes(emptyFlourishes(), view, parent(), [], new Set([1])).bestFind).toBeNull();
    w.setPlayer({ depth: 2 });
    expect(observeFlourishes(emptyFlourishes(), view, parent(), [], new Set([1])).bestFind).toBeNull();
    const p = parent();
    p.toggles.favouredGrounds = false;
    expect(observeFlourishes(emptyFlourishes(), view, p, [], new Set([1])).bestFind).toBeNull();
  });

  it("nudges descent toward ready grounds, then exploration there, without going past them", () => {
    const w = ready();
    expect(nudgeGrounds(dist, offers, memories, w.view, parent(), 0.5).descend).toBeCloseTo(0.44);
    w.setPlayer({ depth: 3 });
    expect(nudgeGrounds(dist, offers, memories, w.view, parent(), 0.5).explore).toBeCloseTo(0.66);
    w.setPlayer({ depth: 4 });
    expect(nudgeGrounds(dist, offers, memories, w.view, parent(), 0.5)).toEqual(dist);
  });

  it("leaves unready depths, missing offers and options past the ceiling alone", () => {
    const w = ready();
    w.setPlayer({ maxLevel: 1, maxHp: 15 });
    expect(nudgeGrounds(dist, offers, memories, w.view, parent(), 0.5)).toEqual(dist);
    const strong = ready();
    expect(nudgeGrounds(dist, [], memories, strong.view, parent(), 0.5)).toEqual(dist);
    const risky = [{ goal: "descend", risk: 0.9 }, { goal: "retreat", risk: 0.01 }];
    const weights = nudgeGrounds(dist, risky, memories, strong.view, parent(), 0.2);
    expect(weights).toEqual(dist);
    expect(applySafetyFloor(weights, { descend: 0.9, explore: 0.9, retreat: 0.01 }, 0.2, false).dist).toEqual({ retreat: 1 });
    const p = parent();
    p.toggles.favouredGrounds = false;
    expect(nudgeGrounds(dist, offers, memories, strong.view, p, 0.5)).toEqual(dist);
  });

  it("changes a close planner choice while the readiness gate still removes descent", () => {
    const w = ready();
    const p = parent();
    p.sliders.strength = 0;
    p.sliders.volatility = 0;
    const planner = createGoalPlanner({ cfg: defaultCfg(), terrain: w.terrain, log: () => {}, persona: p, reflex: false, flourishes: () => memories });
    const q = asked(planner.ask(w.view));
    expect(q.context.offers.map((o) => o.goal)).toEqual(expect.arrayContaining(["explore", "descend"]));
    expect(planner.choose({ goal: { type: "choice", choice: "explore", confidence: 0.51, probabilities: { descend: 0.49, explore: 0.51 } } }, q.context, w.view)).toMatchObject({ plan: { label: "take the stairs down" } });
    expect(q.request.state["persona"]).toHaveProperty("family");
    w.setPlayer({ maxLevel: 1, maxHp: 15 });
    expect(asked(planner.ask(w.view)).context.offers.map((o) => o.goal)).not.toContain("descend");
  });
});

describe("runtime and saved flourishes", () => {
  it("persists family memories through the config envelope and rejects malformed records", () => {
    const rt = createRuntime({ log: () => {} }, { store: memoryStore() });
    expect(readConfig(writeConfig({ ...rt.config(), lineages: { Ada: { ...baseLine, flourishes: memories } } })).lineages["Ada"]?.flourishes).toEqual(memories);
    expect(readWays({ favouredDepth: Infinity, trophies: [{ handle: -1 }], lastUse: 7 })).toEqual(emptyFlourishes());
    expect(readFamilyFlourishes({ darkDeaths: NaN, bestFind: { depth: 300 } })).toEqual(emptyFamilyFlourishes());
  });

  it("shows memories, learns a kind for the whole family, and reloads the character record", () => {
    const logged: string[] = [];
    let stored: unknown;
    const host = { log: (s: string) => logged.push(s), characterStore: { get: () => stored, set: (s: unknown) => { stored = s; } } };
    const rt = createRuntime(host, { store: memoryStore() });
    rt.saveConfig({ ...rt.config(), lineages: { Ada: baseLine } });
    rt.saveCharacter({ ...rt.character(), persona: parent(), lineage: "Ada", flourishes: memories });
    expect(rt.flourishLines()).toHaveLength(3);
    const w = world({ map: ["@"], pack: ["a Scroll of Phase Door"] });
    rt.observe(w.view);
    expect(rt.character().flourishes?.superstitions).toEqual([]);
    expect(rt.config().lineages["Ada"]?.flourishRecord?.superstitions).toEqual([]);
    expect(logged).toContain("Ada trusts the Scroll titled 'FOO BAR' now.");
    expect(createRuntime(host, { store: memoryStore() }).character().flourishes).toEqual(rt.character().flourishes);
  });

  it("records a human item use at death and clears it after a later command", async () => {
    let end: ((report: RunReportLike) => void) | undefined;
    const rt = createRuntime({ log: () => {}, character: { key: () => null, onRunEnd: (fn) => { end = fn; return () => {}; } } }, { store: memoryStore() });
    const p = parent();
    rt.saveCharacter({ ...rt.character(), persona: p });
    const w = world({ map: ["@"], player: { light: 0 }, pack: [SCROLL] });
    rt.observe(w.view);
    rt.recordCommand({ code: "read", args: { handle: 1 } }, w.view);
    expect(rt.character().flourishes?.lastUse).toEqual(taboo);
    rt.recordCommand({ code: "walk", dir: 6 }, w.view);
    expect(rt.character().flourishes?.lastUse).toBeNull();
    rt.recordCommand({ code: "read", args: { handle: 1 } }, w.view);
    end?.({ name: "Ada", race: "Human", cls: "Warrior", cause: "a cave orc", turn: 10, maxDepth: 1, outcome: "death" } as RunReportLike);
    await new Promise<void>((resolve) => setTimeout(resolve, 20));
    expect(rt.config().lineages["Ada"]?.flourishRecord).toMatchObject({ superstitions: [taboo], darkDeaths: 1 });
  });

  it("records unique trophies through the kill hook and keeps ordinary kills out", () => {
    const logged: string[] = [];
    const rt = createRuntime({ log: (s) => logged.push(s) }, { store: memoryStore() });
    const p = parent();
    p.sliders.pride = 90;
    rt.saveCharacter({ ...rt.character(), persona: p });
    const w = world({ map: ["@"], pack: ["a Dagger (1d4) (+0,+0)"], worn: ["a Long Sword (2d5) (+0,+0)"], inspect: () => `Dropped by ${GRIP} at 50 feet (level 1)` });
    rt.recordKill(GRIP, false, w.view);
    expect(rt.character().flourishes?.trophies ?? []).toEqual([]);
    rt.recordKill(GRIP, true, w.view);
    expect(rt.character().flourishes?.trophies).toHaveLength(1);
    expect(rt.flourishLines()[0]).toContain("trophy");
    expect(logged.some((s) => s.includes("trophy"))).toBe(true);
  });
});

describe("mayReplaceMotto slider bind", () => {
  function personaWith(sliders: Record<string, number>): Persona {
    const p = parent();
    for (const [key, value] of Object.entries(sliders)) (p.sliders as unknown as Record<string, number>)[key] = value;
    return p;
  }
  const motto = { text: "test", generation: 1 };

  it("compares each measured slider with the heir's same slider, not a fixed first one", () => {
    const older = personaWith({ inheritance: 50, resemblance: 50, boldness: 10, patience: 10 });
    const heir = personaWith({ inheritance: 50, resemblance: 50, boldness: 80, patience: 10 });
    /* With one slider of many moved, the share is below 0.05; any normal roll keeps the motto. */
    expect(mayReplaceMotto(older, heir, motto, () => 0.32)).toBe(false);
    expect(mayReplaceMotto(older, heir, motto, () => 0.99)).toBe(false);
  });

  it("does replace when the heir's full slider set has moved", () => {
    const older = personaWith({ inheritance: 50, resemblance: 50, boldness: 10, patience: 10 });
    const heir = personaWith({ inheritance: 80, resemblance: 20, boldness: 80, patience: 80 });
    /* Now four sliders moved by 30+, so share is roughly 4/N. A low roll still keeps the motto;
     * the bug keyed every comparison at the heir's first slider and would return true here too,
     * but the more decisive case is when most sliders stayed put yet the first one moved. */
    expect(mayReplaceMotto(older, heir, motto, () => 0.05)).toBe(true);
  });

  it("falls back to the bootstrap chance when the older persona is missing", () => {
    expect(mayReplaceMotto(null, parent(), null, () => 0.5)).toBe(true);
    /* With no older persona, the roll must beat the bootstrap chance (0.25). */
    expect(mayReplaceMotto(null, parent(), motto, () => 0.1)).toBe(true);
    expect(mayReplaceMotto(null, parent(), motto, () => 0.5)).toBe(false);
  });

  it("returns false for a non-finite random draw and true when no motto is set yet", () => {
    const older = personaWith({ inheritance: 50, resemblance: 50, boldness: 10 });
    expect(mayReplaceMotto(older, personaWith({ inheritance: 50, resemblance: 50, boldness: 80 }), motto, () => Number.NaN)).toBe(false);
    expect(mayReplaceMotto(older, personaWith({ inheritance: 50, resemblance: 50, boldness: 80 }), null, () => 0.99)).toBe(true);
  });
});

describe("favoured kind in inheritance", () => {
  const armed: FamilyFlourishes = { ...family, ancestralWeapons: [{ generation: 1, kind: "sword", kills: 5 }] };

  it("returns null when inheritance is 0, mirroring the other share-gated ways", () => {
    const p = parent();
    p.sliders.inheritance = 0;
    const heir = defaultPersona("Bea");
    heir.toggles.favouredWeapons = true;
    expect(inheritWays(armed, p, heir, () => 0).favouredKind).toBeNull();
  });

  it("returns the kind with full share when the heir opts in", () => {
    const p = parent();
    p.sliders.inheritance = 100;
    const heir = defaultPersona("Bea");
    heir.toggles.favouredWeapons = true;
    expect(inheritWays(armed, p, heir, () => 0).favouredKind).toBe("sword");
  });

  it("returns null when the heir turns the setting off, even with full share", () => {
    const p = parent();
    p.sliders.inheritance = 100;
    const heir = defaultPersona("Bea");
    heir.toggles.favouredWeapons = false;
    expect(inheritWays(armed, p, heir, () => 0).favouredKind).toBeNull();
  });
});

describe("ancestor superstition forgotten", () => {
  it("matches each run superstition against the same key in the next observation, not against itself", () => {
    const logged: string[] = [];
    const host = { log: (s: string) => logged.push(s), characterStore: { get: () => undefined, set: () => {} } };
    const rt = createRuntime(host, { store: memoryStore() });
    /* The family carries two superstitions. When the player identifies only one kind, the other
     * should still surface as forgotten through observeFlourishes; the prior self-comparison
     * ("t.key === t.key") silently dropped every forgotten line. */
    const other = unknownUse(itemNamed("a Smoky Potion", 2))!;
    const inherited = {
      ...memories,
      superstitions: [taboo, other],
    };
    rt.saveConfig({ ...rt.config(), lineages: { Ada: { ...baseLine, flourishRecord: family } } });
    rt.saveCharacter({ ...rt.character(), persona: parent(), lineage: "Ada", flourishes: inherited });
    const w = world({ map: ["@"], pack: ["a Scroll of Phase Door"] });
    rt.observe(w.view);
    expect(rt.character().flourishes?.superstitions).toEqual([other]);
    expect(logged.some((line) => line.includes("Scroll titled 'FOO BAR'"))).toBe(true);
    expect(logged.some((line) => line.includes("Smoky Potion"))).toBe(false);
  });
});

describe("once-per-run cursed ground and near-death motto", () => {
  it("announces cursed ground at most once per depth and the near-death motto at most once per run", () => {
    const logged: string[] = [];
    const host = { log: (s: string) => logged.push(s), characterStore: { get: () => undefined, set: () => {} } };
    const rt = createRuntime(host, { store: memoryStore() });
    const p = parent();
    p.toggles.familyMotto = true;
    p.toggles.cursedGround = true;
    rt.saveConfig({ ...rt.config(), lineages: { Ada: { ...baseLine, flourishRecord: { ...family, cursedDepth: 3, motto: { text: "hold the line and push on", generation: 1 } } } } });
    rt.saveCharacter({ ...rt.character(), persona: p, lineage: "Ada" });
    const depthLines = (l: string): boolean => l.includes("150 ft") && l.includes("ancestor");
    /* First descent to the cursed depth logs the line. */
    const w = world({ map: ["@"], player: { depth: 3, hp: 80, maxHp: 80 } });
    rt.observe(w.view);
    expect(logged.filter(depthLines)).toHaveLength(1);
    /* A second observe at the same depth does not repeat it. */
    rt.observe(w.view);
    expect(logged.filter(depthLines)).toHaveLength(1);
    /* Returning to the same depth later still does not repeat it. */
    rt.observe(w.view);
    expect(logged.filter(depthLines)).toHaveLength(1);
    /* The first HP plunge below the threshold speaks the motto. */
    const wounded = world({ map: ["@"], player: { depth: 3, hp: 6, maxHp: 80 } });
    rt.observe(wounded.view);
    expect(logged.some((line) => line.includes("hold the line"))).toBe(true);
    const mottoCount = logged.filter((line) => line.includes("hold the line")).length;
    /* Recovery and another plunge must not repeat the motto. */
    const recovered = world({ map: ["@"], player: { depth: 3, hp: 80, maxHp: 80 } });
    rt.observe(recovered.view);
    rt.observe(wounded.view);
    expect(logged.filter((line) => line.includes("hold the line")).length).toBe(mottoCount);
  });
});

describe("floor heirloom recognition from known floor items", () => {
  function floorItem(args: { readonly tval: number; readonly name: string; readonly artifactName: string | null; readonly visibility: "seen" | "remembered" }) {
    return {
      ref: { id: 1 },
      grid: { x: 1, y: 1 },
      visibility: args.visibility,
      sensed: false as const,
      item: { tval: args.tval, name: args.name, artifactName: args.artifactName, pval: 0, number: 1, weight: 0, ac: 0, toA: 0, toH: 0, toD: 0, dd: 0, ds: 0, flags: [], modifiers: [], brands: [], slays: [], resists: [], curses: [], egoName: null, inscription: null },
    };
  }
  function withKnownFloor(view: AgentView, cells: Record<string, readonly unknown[]>): AgentView {
    return { ...view, knownFloorItems: ((x: number, y: number) => cells[`${String(x)},${String(y)}`] ?? []) as unknown as AgentView["knownFloorItems"] & (() => never) };
  }

  it("recognises an artifact name the player can read on the floor in sight", () => {
    const logged: string[] = [];
    const host = { log: (s: string) => logged.push(s), characterStore: { get: () => undefined, set: () => {} } };
    const rt = createRuntime(host, { store: memoryStore() });
    const p = parent();
    p.toggles.heirlooms = true;
    const milestone: Milestone = { kind: "artifact", name: "Ada", generation: 1, depth: 1, fact: "Dethanc" };
    rt.saveConfig({ ...rt.config(), lineages: { Ada: { ...baseLine, milestones: [milestone] } } });
    rt.saveCharacter({ ...rt.character(), persona: p, lineage: "Ada" });
    const w = world({ map: MAP, player: { depth: 2, maxDepth: 2 } });
    const view = withKnownFloor(w.view, {
      "1,1": [floorItem({ tval: TV.SWORD, name: "Dethanc (Defender) (2d4)", artifactName: "Dethanc", visibility: "seen" })],
    });
    rt.observe(view);
    expect(logged.some((line) => line.includes("Dethanc"))).toBe(true);
  });

  it("skips an artifact whose name is not yet known to the player", () => {
    const logged: string[] = [];
    const host = { log: (s: string) => logged.push(s), characterStore: { get: () => undefined, set: () => {} } };
    const rt = createRuntime(host, { store: memoryStore() });
    const p = parent();
    p.toggles.heirlooms = true;
    const milestone: Milestone = { kind: "artifact", name: "Ada", generation: 1, depth: 1, fact: "Dethanc" };
    rt.saveConfig({ ...rt.config(), lineages: { Ada: { ...baseLine, milestones: [milestone] } } });
    rt.saveCharacter({ ...rt.character(), persona: p, lineage: "Ada" });
    const w = world({ map: MAP, player: { depth: 2, maxDepth: 2 } });
    const view = withKnownFloor(w.view, {
      "1,1": [floorItem({ tval: TV.SWORD, name: "a Long Sword", artifactName: null, visibility: "seen" })],
    });
    rt.observe(view);
    expect(logged.some((line) => line.includes("Dethanc"))).toBe(false);
  });

  it("skips items that are remembered but not in sight", () => {
    const logged: string[] = [];
    const host = { log: (s: string) => logged.push(s), characterStore: { get: () => undefined, set: () => {} } };
    const rt = createRuntime(host, { store: memoryStore() });
    const p = parent();
    p.toggles.heirlooms = true;
    const milestone: Milestone = { kind: "artifact", name: "Ada", generation: 1, depth: 1, fact: "Dethanc" };
    rt.saveConfig({ ...rt.config(), lineages: { Ada: { ...baseLine, milestones: [milestone] } } });
    rt.saveCharacter({ ...rt.character(), persona: p, lineage: "Ada" });
    const w = world({ map: MAP, player: { depth: 2, maxDepth: 2 } });
    const view = withKnownFloor(w.view, {
      "1,1": [floorItem({ tval: TV.SWORD, name: "Dethanc", artifactName: "Dethanc", visibility: "remembered" })],
    });
    rt.observe(view);
    expect(logged.some((line) => line.includes("Dethanc"))).toBe(false);
  });
});
