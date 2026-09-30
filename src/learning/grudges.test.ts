import { describe, expect, it } from "vitest";
import { world } from "../harness.js";
import { defaultCfg } from "../settings.js";
import { memoryStore } from "../memory/kv.js";
import { createRuntime } from "../runtime.js";
import { withAncestor } from "../journal.js";
import { createGoalPlanner, type GoalDigest } from "../brain/goals.js";
import type { Question } from "../brain/brain.js";
import type { Answer } from "../brain/systemone.js";
import { applySafetyFloor } from "../persona/blend.js";
import { defaultPersona, type Persona } from "../persona/persona.js";
import { avengeAim, withAvenge } from "../strategy/heirs.js";
import { nudgeAims, steerOffers } from "../strategy/steer.js";
import { inherit, type Lineage } from "./lineage.js";
import {
  fearedBand, feelingKind, feelingLine, feelingsFor, intensityOf, killerOf, nudgeGrudges, readFeelings, readKillers,
  recordDeath, remembered, settle, type Feeling, type Killer,
} from "./grudges.js";

const GRIP = "Grip, Farmer Maggot's Dog";

function persona(sliders: Partial<Persona["sliders"]> = {}, name = "Heir"): Persona {
  const p = defaultPersona(name);
  p.sliders.inheritance = 100;
  p.sliders.resemblance = 0;
  Object.assign(p.sliders, sliders);
  return p;
}

/** A line whose characters die one after another, each by the given cause. */
function generations(causes: readonly string[], seen: readonly { race: string; raceFlags: readonly string[] }[] = [], heir: Persona = persona()): Lineage {
  let line: Lineage | undefined;
  let parent = persona({}, "Founder");
  for (const [i, cause] of causes.entries()) {
    const dead = withAncestor(line, `Gen${String(i + 1)}`, "Human", "Warrior", { depth: 3, cause, turn: 100 * (i + 1) }, [], seen);
    const born = inherit(dead, parent, heir, () => 0.5);
    line = born.lineage;
    parent = { ...born.persona, sliders: { ...born.persona.sliders, inheritance: 100 } };
  }
  return line!;
}

describe("the family record of killers", () => {
  it("names the killer from the death cause, and tells a unique from an ordinary monster", () => {
    expect(killerOf(`Killed by ${GRIP}`)).toEqual({ name: GRIP, unique: true });
    expect(killerOf("Killed by a cave spider")).toEqual({ name: "cave spider", unique: false });
    expect(killerOf("an orc")).toEqual({ name: "orc", unique: false });
    expect(killerOf("Killed by a trap")).toBeNull();
    expect(killerOf("starvation")).toBeNull();
    expect(killerOf("Bullroarer the Hobbit", [{ race: "Bullroarer the Hobbit", raceFlags: [] }])).toEqual({ name: "Bullroarer the Hobbit", unique: false });
  });

  it("counts each creature's kills across generations, and when", () => {
    const line = generations([GRIP, "a cave spider", GRIP]);
    expect(line.generation).toBe(4);
    expect(line.killers).toEqual([
      { name: GRIP, unique: true, deaths: [{ generation: 1, depth: 3, turn: 100 }, { generation: 3, depth: 3, turn: 300 }] },
      { name: "cave spider", unique: false, deaths: [{ generation: 2, depth: 3, turn: 200 }] },
    ]);
  });

  it("reads a stored record back and drops what does not fit", () => {
    const stored: unknown = [{ name: GRIP, unique: true, deaths: [{ generation: 1, depth: 2, turn: 9 }, "x"], settled: 2 }, { name: "" }, { name: "rat", deaths: [] }];
    expect(readKillers(stored)).toEqual([{ name: GRIP, unique: true, deaths: [{ generation: 1, depth: 2, turn: 9 }], settled: 2 }]);
    expect(readFeelings([{ name: GRIP, unique: true, kind: "hatred", intensity: "mild", count: 2 }, { name: "rat", kind: "love", count: 1 }]))
      .toEqual([{ name: GRIP, unique: true, kind: "hatred", intensity: "strong", count: 2 }]);
  });
});

describe("hatred or fear, by persona", () => {
  it("has a bold or proud heir hate and a cautious or craven one fear", () => {
    expect(feelingKind(persona({ boldness: 80 }), 3)).toBe("hatred");
    expect(feelingKind(persona({ pride: 80 }), 3)).toBe("hatred");
    expect(feelingKind(persona({ boldness: 20 }), 1)).toBe("fear");
    expect(feelingKind(persona({ paranoia: 80 }), 1)).toBe("fear");
    const craven = persona({ boldness: 90 });
    craven.quirks.cowardice.on = true;
    expect(feelingKind(craven, 1)).toBe("fear");
  });

  it("has a middling heir lean by degree: hate one death, fear several", () => {
    const middling = persona();
    expect(feelingKind(middling, 1)).toBe("hatred");
    expect(feelingKind(middling, 2)).toBe("fear");
    expect(feelingKind(persona({ boldness: 62 }), 2)).toBe("hatred");
    expect(feelingKind(persona({ boldness: 62 }), 3)).toBe("fear");
  });

  it("grows with the number of ancestors killed: one mild, two strong, three or more lasting", () => {
    expect([0, 1, 2, 3, 5].map(intensityOf)).toEqual([null, "mild", "strong", "lasting", "lasting"]);
    const line = generations([GRIP, GRIP, GRIP], [], persona({ boldness: 90 }));
    expect(line.feelings).toEqual([{ name: GRIP, unique: true, kind: "hatred", intensity: "lasting", count: 3 }]);
  });

  it("says where each feeling comes from", () => {
    expect(feelingLine({ name: GRIP, unique: true, kind: "hatred", intensity: "strong", count: 2 }))
      .toBe(`Remembers that ${GRIP} killed two of the family, and hates it (strong).`);
    expect(feelingLine({ name: "cave spider", unique: false, kind: "fear", intensity: "mild", count: 1 }))
      .toBe("Remembers that the cave spider killed one of the family, and fears it (mild).");
  });
});

describe("inheritance, settling and fading", () => {
  it("starts an heir with no grudge when the parent passes nothing on", () => {
    const dead = withAncestor(undefined, "Ada", "Human", "Warrior", { depth: 1, cause: GRIP, turn: 5 }, []);
    const parent = persona({ inheritance: 0 });
    const born = inherit(dead, parent, persona(), () => 0.5);
    expect(born.lineage.feelings).toEqual([]);
    expect(born.lineage.killers).toHaveLength(1);
    const off = persona();
    off.toggles.grudges = false;
    expect(inherit(dead, off, persona(), () => 0.5).lineage.feelings).toEqual([]);
  });

  it("passes fewer feelings at partial inheritance, strongest first", () => {
    const killers: Killer[] = ["a", "b", "c", "d", "e", "f"].map((name, i) => ({ name, unique: false, deaths: Array.from({ length: i === 5 ? 3 : 1 }, () => ({ generation: 1, depth: 1, turn: 1 })) }));
    const half = feelingsFor(killers, 2, persona(), 20);
    expect(half.map((f) => f.name)).toEqual(["f", "a"]);
  });

  it("settles a unique's grudge for the whole family when it is killed, until it kills again", () => {
    const killers: Killer[] = [{ name: GRIP, unique: true, deaths: [{ generation: 1, depth: 1, turn: 1 }, { generation: 2, depth: 1, turn: 1 }] }];
    expect(settle(killers, "cave spider", 3)).toBeNull();
    const settled = settle(killers, GRIP.toLowerCase(), 3)!;
    expect(settled[0]?.settled).toBe(3);
    expect(settle(settled, GRIP, 3)).toBeNull();
    expect(feelingsFor(settled, 4, persona(), 100)).toEqual([]);
    const again = recordDeath(settled, { name: GRIP, unique: true }, { generation: 5, depth: 2, turn: 7 });
    expect(feelingsFor(again, 6, persona({ boldness: 90 }), 100)).toEqual([{ name: GRIP, unique: true, kind: "hatred", intensity: "mild", count: 1 }]);
  });

  it("fades a feeling toward an ordinary monster over later generations unless it kills again", () => {
    const spider: Killer = { name: "cave spider", unique: false, deaths: [{ generation: 1, depth: 1, turn: 1 }, { generation: 2, depth: 1, turn: 1 }] };
    expect([3, 4, 5].map((g) => remembered(spider, g))).toEqual([2, 1, 0]);
    const unique: Killer = { ...spider, name: GRIP, unique: true };
    expect(remembered(unique, 9)).toBe(2);
    const lasting: Killer = { ...spider, deaths: [...spider.deaths, { generation: 3, depth: 1, turn: 1 }] };
    expect(remembered(lasting, 20)).toBe(3);
    const line = generations(["a cave spider", "a jackal", "a jackal"]);
    expect(line.feelings?.map((f) => f.name)).toEqual(["jackal"]);
    const again = generations(["a cave spider", "a jackal", "a cave spider"]);
    expect(again.feelings?.map((f) => [f.name, f.count])).toEqual([["cave spider", 2]]);
  });

  it("settles through the runtime when the heir kills the unique, and says so", () => {
    const logged: string[] = [];
    const rt = createRuntime({ log: (m) => logged.push(m) }, { store: memoryStore() });
    const feelings: Feeling[] = [{ name: GRIP, unique: true, kind: "hatred", intensity: "strong", count: 2 }];
    const lineage: Lineage = { name: "Bea", generation: 3, ancestors: [], lore: [], grudges: [], feelings,
      killers: [{ name: GRIP, unique: true, deaths: [{ generation: 1, depth: 1, turn: 1 }, { generation: 2, depth: 1, turn: 1 }] }] };
    rt.saveConfig({ ...rt.config(), lineages: { Ada: lineage } });
    rt.saveCharacter({ ...rt.character(), lineage: "Ada", persona: defaultPersona("Bea") });
    expect(rt.grudgeLines()).toEqual([`Remembers that ${GRIP} killed two of the family, and hates it (strong).`]);
    rt.recordKill(GRIP, true, null);
    expect(rt.config().lineages["Ada"]?.killers?.[0]?.settled).toBe(3);
    expect(rt.grudgeLines()).toEqual([]);
    expect(logged).toContain(`Bea has slain ${GRIP}. The family's grudge is settled.`);
  });
});

describe("how a feeling plays", () => {
  const hate: Feeling = { name: GRIP, unique: true, kind: "hatred", intensity: "strong", count: 2 };
  const fear: Feeling = { name: "cave spider", unique: false, kind: "fear", intensity: "lasting", count: 3 };
  const offers = [{ goal: "fight", risk: 0.1 }, { goal: "retreat", risk: 0.05 }, { goal: "explore", risk: 0.02 }];
  const dist = { fight: 0.4, retreat: 0.4, explore: 0.2 };

  it("raises the weight on fighting a hated creature in sight, more with intensity", () => {
    expect(nudgeGrudges(dist, offers, [hate], [GRIP], 0.5)).toEqual({ fight: 0.4 * 1.3, retreat: 0.4, explore: 0.2 });
    expect(nudgeGrudges(dist, offers, [{ ...hate, intensity: "mild" }], [GRIP], 0.5).fight).toBeCloseTo(0.46);
    expect(nudgeGrudges(dist, offers, [hate], ["jackal"], 0.5)).toEqual(dist);
  });

  it("raises the weight on getting away from a feared creature", () => {
    expect(nudgeGrudges(dist, offers, [fear], ["cave spider"], 0.5)).toEqual({ fight: 0.4, retreat: 0.4 * 1.45, explore: 0.2 });
  });

  it("raises the believed danger of a feared creature, and nothing else's", () => {
    expect(fearedBand(1, 5, fear)).toBe(3);
    expect(fearedBand(1, 5, { ...fear, intensity: "mild" })).toBe(2);
    expect(fearedBand(4, 5, fear)).toBe(4);
    expect(fearedBand(1, 5, hate)).toBe(1);
    expect(fearedBand(1, 5, undefined)).toBe(1);
  });

  it("never lifts an option past the death-risk ceiling, so the safety floor still wins", () => {
    const risky = [{ goal: "fight", risk: 0.7 }, { goal: "retreat", risk: 0.05 }];
    const nudged = nudgeGrudges({ fight: 0.9, retreat: 0.1 }, risky, [{ ...hate, intensity: "lasting" }], [GRIP], 0.25);
    expect(nudged).toEqual({ fight: 0.9, retreat: 0.1 });
    const floor = applySafetyFloor(nudged, { fight: 0.7, retreat: 0.05 }, 0.25, false);
    expect(floor.removed).toEqual(["fight"]);
    expect(floor.dist).toEqual({ retreat: 1 });
  });

  it("makes a hated unique an aim that adds weight to fighting it, and never a feared one", () => {
    expect(avengeAim([fear])).toBeNull();
    expect(avengeAim([{ ...hate, kind: "fear" }])).toBeNull();
    const aim = avengeAim([fear, hate]);
    expect(aim).toMatchObject({ kind: "avenge", label: `avenge the family on ${GRIP}`, how: "hunt", target: GRIP });
    expect(withAvenge([], [hate]).map((a) => a.kind)).toEqual(["avenge"]);
    const w = world({ map: ["########", "#.@....#", "########"], player: { depth: 2 }, monsters: [{ grid: { x: 4, y: 1 }, race: GRIP, level: 2, raceFlags: ["UNIQUE"] }] });
    const steered = steerOffers([{ goal: "fight", criteria: "Fight it.", risk: 0.1 }, { goal: "fight2", criteria: "x", risk: 0.1 }], w.view, { aims: [aim!], tripAllowed: () => false }, { recallActive: false, tripRisk: 0 }, (goal, criteria, risk) => ({ goal, criteria, risk }));
    expect(steered[0]?.criteria).toContain(`serves the aim: avenge the family on ${GRIP}`);
    expect(nudgeAims({ fight: 0.5 }, [{ ...steered[0]!, risk: 0.9 }], 100, 0.25)).toEqual({ fight: 0.5 });
  });
});

describe("in the planner", () => {
  const CORRIDOR = ["########", "#<@....#", "########"];
  const OPEN = ["########", "#.@....#", "#.#### #", "########"];
  const spider = { grid: { x: 5, y: 1 }, race: "cave spider", level: 2 };

  function planner(w: ReturnType<typeof world>, p: Persona, feelings: readonly Feeling[], logged: string[] = []) {
    return createGoalPlanner({ cfg: defaultCfg(), terrain: w.terrain, log: (m) => logged.push(m), persona: p, rng: () => 0.5, reflex: false, grudges: () => feelings });
  }

  function asked(q: ReturnType<ReturnType<typeof createGoalPlanner>["ask"]>): Question<GoalDigest> {
    if ("handBack" in q || "reflex" in q) throw new Error("expected a question");
    return q;
  }

  it("believes a feared creature more dangerous, offers to leave the level, and logs where the fear comes from", () => {
    const w = world({ map: CORRIDOR, player: { depth: 2, level: 20, hp: 200, maxHp: 200 }, monsters: [spider] });
    const logged: string[] = [];
    const heir = persona({ optimism: 50 }, "Bea");
    const fear: Feeling = { name: "cave spider", unique: false, kind: "fear", intensity: "lasting", count: 3 };
    const q = asked(planner(w, heir, [fear], logged).ask(w.view));
    const believes = String((q.request.state["persona"] as Record<string, string>)["believes"]);
    expect(believes).toContain("the cave spider is");
    expect(believes).toContain("the cave spider killed three of the family, and the character fears it");
    expect(q.context.offers.map((o) => o.goal)).toContain("leave_level");
    expect(logged).toContain("Bea remembers that the cave spider killed three of the family, and fears it (lasting).");
    const plain = asked(planner(w, heir, []).ask(w.view));
    expect(plain.request.state["persona"]).not.toHaveProperty("believes");
    expect(plain.context.offers.map((o) => o.goal)).not.toContain("leave_level");
    expect(plain.request.state["creatures"]).toEqual(q.request.state["creatures"]);
  });

  it("fights a hated creature the model was split on, but the safety floor still removes a fight past the ceiling", () => {
    const hate: Feeling = { name: "cave orc", unique: false, kind: "hatred", intensity: "strong", count: 2 };
    const heir = persona({ strength: 0, volatility: 0 });
    const split: Readonly<Record<string, Answer>> = { goal: { type: "choice", choice: "retreat", confidence: 0.5, probabilities: { retreat: 0.51, fight: 0.49 } } };
    const orc = { grid: { x: 5, y: 1 }, race: "cave orc", level: 3 };
    const safe = world({ map: OPEN, monsters: [orc] });
    const calm = planner(safe, heir, []);
    const angry = planner(safe, heir, [hate]);
    const q1 = asked(calm.ask(safe.view));
    expect(q1.context.offers.map((o) => o.goal)).toEqual(expect.arrayContaining(["fight", "retreat"]));
    expect(calm.choose(split, q1.context, safe.view)).toMatchObject({ plan: { label: "back away" } });
    const q2 = asked(angry.ask(safe.view));
    expect(angry.choose(split, q2.context, safe.view)).toMatchObject({ plan: { label: "fight" } });

    const deadly = world({ map: OPEN, player: { hp: 2, maxHp: 40 }, monsters: [{ ...orc, grid: { x: 4, y: 1 }, level: 30 }] });
    const careful = persona({ strength: 0, volatility: 0, selfpreservation: 100 });
    const p = planner(deadly, careful, [{ ...hate, intensity: "lasting", count: 3 }]);
    const q3 = asked(p.ask(deadly.view));
    const choice = p.choose({ goal: { type: "choice", choice: "fight", confidence: 0.6, probabilities: { fight: 0.6, retreat: 0.4 } } }, q3.context, deadly.view);
    expect(q3.context.trace?.removed).toContain("fight");
    expect(choice).not.toMatchObject({ plan: { label: "fight" } });
  });
});
