import { describe, expect, it } from "vitest";
import { world } from "../harness.js";
import { archetype, ARCHETYPES, defaultPersona, type ArchetypeId, type Persona } from "../persona/persona.js";
import { readPack } from "../brain/pack.js";
import { supplyNeeds } from "../town/needs.js";
import { candidateAims } from "./aims.js";
import { inheritAims } from "./heirs.js";
import { nudgePursuits, paceFactor, pursuitFacts, pursuitsFor, pursuitWeight, sameRace, winStep, type Pursuit } from "./pursuits.js";

const IDS = Object.keys(ARCHETYPES) as ArchetypeId[];

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

function withSliders(changes: Partial<Persona["sliders"]>): Persona {
  const persona = defaultPersona("Test");
  Object.assign(persona.sliders, changes);
  return persona;
}

/** How often each option wins when the same random model answers are nudged by this persona's goals. */
function picks(persona: Persona, goals: readonly string[], trials = 2000): Record<string, number> {
  const w = world({ map: ["#######", "#.@...#", "#######"], player: { depth: 3, maxDepth: 3, level: 10, hp: 80, maxHp: 80 } });
  const pursuits = pursuitsFor(persona, 3);
  const offers = goals.map((goal) => ({ goal, risk: 0.05 }));
  const rng = seeded(7);
  const counts: Record<string, number> = Object.fromEntries(goals.map((goal) => [goal, 0]));
  for (let trial = 0; trial < trials; trial += 1) {
    const dist = Object.fromEntries(goals.map((goal) => [goal, rng()]));
    const nudged = nudgePursuits(dist, offers, pursuits, w.view, 1, false);
    const best = goals.reduce((a, b) => ((nudged[b] ?? 0) > (nudged[a] ?? 0) ? b : a));
    counts[best] = (counts[best] ?? 0) + 1;
  }
  return counts;
}

function weightOf(pursuits: readonly Pursuit[], kind: Pursuit["kind"]): number {
  return pursuitWeight(pursuits, kind);
}

describe("the win as a goal", () => {
  it("is held by every archetype and the default persona", () => {
    for (const persona of [defaultPersona("Plain"), ...IDS.map((id) => archetype(id))]) {
      expect(weightOf(pursuitsFor(persona, 0), "win")).toBeGreaterThan(0);
    }
    expect(weightOf(pursuitsFor(withSliders({ ambition: 0, pride: 0 }), 0), "win")).toBeGreaterThan(0.1);
  });

  it("carries a large weight for most archetypes", () => {
    const large = IDS.filter((id) => weightOf(pursuitsFor(archetype(id), 0), "win") >= 0.5);
    expect(large.length).toBeGreaterThanOrEqual(IDS.length - 1);
    expect(weightOf(pursuitsFor(defaultPersona("Plain"), 0), "win")).toBeGreaterThanOrEqual(0.5);
  });

  it("rises with Ambition", () => {
    const content = weightOf(pursuitsFor(withSliders({ ambition: 0 }), 0), "win");
    const driven = weightOf(pursuitsFor(withSliders({ ambition: 100 }), 0), "win");
    expect(driven).toBeGreaterThan(content + 0.5);
  });

  it("names Sauron and Morgoth as the last steps", () => {
    expect(winStep(0).depth).toBe(5);
    expect(winStep(95).text).toContain("Sauron");
    expect(winStep(99).text).toContain("Morgoth");
    expect(pursuitFacts(pursuitsFor(defaultPersona("Plain"), 0))["win_urgency"]).toContain("Morgoth");
  });

  it("is an aim at every review, next to the depth target", () => {
    const w = world({ map: ["#####", "#.@.#", "#####"], player: { depth: 1, maxDepth: 12 } });
    expect(candidateAims(w.view).find((aim) => aim.kind === "win")?.depth).toBe(15);
  });
});

describe("an archetype built around another goal", () => {
  it("ranks that goal above the win", () => {
    const tourist = pursuitsFor(archetype("tourist"), 0);
    expect(weightOf(tourist, "sights")).toBeGreaterThan(weightOf(tourist, "win"));
    expect(tourist[0]?.kind).toBe("sights");
    const miser = pursuitsFor(archetype("miser"), 0);
    expect(weightOf(miser, "riches")).toBeGreaterThan(weightOf(miser, "win"));
    const berserker = pursuitsFor(archetype("berserker"), 0);
    expect(weightOf(berserker, "uniques")).toBeGreaterThan(0);
    expect(weightOf(pursuitsFor(archetype("coward"), 0), "lineage")).toBeGreaterThan(weightOf(berserker, "lineage"));
  });

  it("adds a family record only for an heir whose ancestor went deeper", () => {
    const proud = withSliders({ pride: 90 });
    expect(weightOf(pursuitsFor(proud, 4, [], { deepest: 12, heir: true }), "record")).toBeGreaterThan(0);
    expect(weightOf(pursuitsFor(proud, 14, [], { deepest: 12, heir: true }), "record")).toBe(0);
    expect(weightOf(pursuitsFor(proud, 4, [], null), "record")).toBe(0);
  });
});

describe("the same choice, different personas", () => {
  it("a driven character dives sooner than a content one", () => {
    const driven = picks(withSliders({ ambition: 100 }), ["descend", "explore"]);
    const content = picks(withSliders({ ambition: 0 }), ["descend", "explore"]);
    expect(driven["descend"]!).toBeGreaterThan(content["descend"]! + 300);
  });

  it("a greedy character detours for gold more than a plain one", () => {
    const miser = picks(archetype("miser"), ["fetch", "descend", "explore"]);
    const plain = picks(defaultPersona("Plain"), ["fetch", "descend", "explore"]);
    expect(miser["fetch"]!).toBeGreaterThan(plain["fetch"]! + 100);
  });

  it("a tourist lingers to see a level where a berserker takes the stairs", () => {
    const tourist = picks(archetype("tourist"), ["descend", "explore"]);
    const berserker = picks(archetype("berserker"), ["descend", "explore"]);
    expect(tourist["explore"]!).toBeGreaterThan(berserker["explore"]! + 300);
    expect(tourist["explore"]!).toBeGreaterThan(tourist["descend"]!);
  });

  it("a cautious character keeps more escapes", () => {
    const w = world({ map: ["#####", "#.@.#", "#####"], player: { depth: 0, maxDepth: 5 } });
    const want = (persona: Persona) => supplyNeeds(w.view, readPack(w.view), persona).find((need) => need.kind === "phase")?.want ?? 0;
    expect(want(archetype("coward"))).toBeGreaterThan(want(archetype("berserker")));
  });

  it("an ambitious character sets a deeper depth target", () => {
    expect(paceFactor(withSliders({ ambition: 100 }))).toBeGreaterThan(paceFactor(withSliders({ ambition: 0 })));
    const w = world({ map: ["#####", "#.@.#", "#####"], player: { level: 20, maxHp: 200 } });
    const depth = (persona: Persona) => candidateAims(w.view, [], persona).find((aim) => aim.kind === "depth")?.depth ?? 0;
    expect(depth(withSliders({ ambition: 100 }))).toBeGreaterThan(depth(withSliders({ ambition: 0 })));
  });

  it("never lifts an option past the risk ceiling or a descent that would be an escape", () => {
    const w = world({ map: ["#####", "#.@.#", "#####"] });
    const pursuits = pursuitsFor(withSliders({ ambition: 100 }), 3);
    expect(nudgePursuits({ descend: 0.5 }, [{ goal: "descend", risk: 0.9 }], pursuits, w.view, 0.3, false)["descend"]).toBe(0.5);
    expect(nudgePursuits({ descend: 0.5 }, [{ goal: "descend", risk: 0.05 }], pursuits, w.view, 0.3, true)["descend"]).toBe(0.5);
  });
});

describe("an heir's depth ceiling", () => {
  it("shortens an inherited target instead of walling off depth", () => {
    const parent = withSliders({ inheritance: 100 });
    const heir = withSliders({ ambition: 0 });
    expect(inheritAims([{ kind: "depth", depth: 40 }], parent, heir)).toEqual([{ kind: "depth", depth: 5 }]);
    expect(weightOf(pursuitsFor(heir, 0), "win")).toBeGreaterThan(0);
  });
});

describe("a character's own jitter on its goals", () => {
  it("is fixed for one character and differs between two built from one persona", () => {
    const persona = archetype("tourist");
    const once = pursuitsFor(persona, 3, [], null, "run-a");
    expect(pursuitsFor(persona, 3, [], null, "run-a")).toEqual(once);
    const other = pursuitsFor(persona, 3, [], null, "run-b");
    expect(other.map((p) => p.weight)).not.toEqual(once.map((p) => p.weight));
    const plain = pursuitsFor(persona, 3);
    for (const p of once) {
      const base = plain.find((q) => q.kind === p.kind);
      if (base !== undefined) expect(Math.abs(p.weight - base.weight)).toBeLessThanOrEqual(0.15);
    }
  });

  it("keeps the win above its floor and adds nothing without a seed", () => {
    const persona = withSliders({ ambition: 0, strength: 100, volatility: 100 });
    for (const seed of ["a", "b", "c", "d", "e"]) expect(weightOf(pursuitsFor(persona, 0, [], null, seed), "win")).toBeGreaterThanOrEqual(weightOf(pursuitsFor(persona, 0), "win") - 0.15);
    expect(pursuitsFor(persona, 0)).toEqual(pursuitsFor(persona, 0, [], null, null));
  });
});

describe("the grudge in sight", () => {
  const grudge: Pursuit = { kind: "grudge", label: "settle the grudge with Fang, Farmer Maggot's Dog", weight: 0.8, detail: "", target: "Fang, Farmer Maggot's Dog" };
  const lift = (race: string) => {
    const w = world({ map: ["#####", "#.@.#", "#####"], monsters: [{ grid: { x: 3, y: 1 }, race, level: 5, raceFlags: ["UNIQUE"] }] });
    return nudgePursuits({ fight: 0.5 }, [{ goal: "fight", risk: 0.05 }], [grudge], w.view, 1, false)["fight"];
  };

  it("matches the whole race name, ignoring case, and not a name that only ends the same way", () => {
    expect(sameRace("fang, farmer maggot's dog ", "Fang, Farmer Maggot's Dog")).toBe(true);
    expect(sameRace("Dog", "Fang, Farmer Maggot's Dog")).toBe(false);
    expect(lift("Fang, Farmer Maggot's Dog")).toBeGreaterThan(0.5);
    expect(lift("Dog")).toBe(0.5);
    expect(lift("Grip, Farmer Maggot's Dog")).toBe(0.5);
  });
});