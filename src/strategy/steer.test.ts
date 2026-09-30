import { describe, expect, it } from "vitest";
import { suppliedWorld as world } from "../harness.js";
import { createGoalPlanner, type GoalDigest, type Offer } from "../brain/goals.js";
import type { Question } from "../brain/brain.js";
import { applySafetyFloor, riskCeiling } from "../persona/blend.js";
import { defaultPersona } from "../persona/persona.js";
import { gearCandidates } from "../gear/compare.js";
import { defaultCfg } from "../settings.js";
import type { Aim } from "./aims.js";
import { MAX_NUDGE, nudgeAims, steerOffers, type Steering } from "./steer.js";

const ROOM = ["######", "#.@..#", "######"];
const OPEN = ["########", "#.@....#", "#.#### #", "########"];

const lantern: Aim = { kind: "lantern", label: "lantern over torch", detail: "", how: "save", price: 100, depth: null };
const book: Aim = { kind: "spellbook", label: "next spellbook", detail: "", how: "save", price: 300, depth: null };
const dive = (depth: number): Aim => ({ kind: "depth", label: "depth target", detail: "", how: "dive", price: null, depth });
const armour: Aim = { kind: "armour", label: "armour for empty slots", detail: "", how: "try", price: null, depth: null };
const hunt: Aim = { kind: "free-action", label: "free action", detail: "", how: "hunt", price: null, depth: null };

function steering(aims: readonly Aim[], allowed = true): Steering {
  return { aims, tripAllowed: () => allowed };
}

const offer = (goal: Offer["goal"], criteria = "Do the thing.", risk = 0.02): Offer => ({ goal, criteria, risk });
const make = (goal: "recall_town", criteria: string, risk: number): Offer => ({ goal, criteria, risk });
const context = { recallActive: false, tripRisk: 0.02 };

function steer(w: ReturnType<typeof world>, offers: Offer[], aims: readonly Aim[], allowed = true, ctx = context): Offer[] {
  return steerOffers(offers, w.view, steering(aims, allowed), ctx, make);
}

function goalsOf(offers: readonly Offer[]): string[] {
  return offers.map((o) => o.goal);
}

describe("criteria suffix", () => {
  it("names the aim an offer serves and drops the trailing period", () => {
    const w = world({ map: OPEN, worn: ["Wooden Torch"], pack: ["Lantern"], player: { depth: 1 } });
    const candidate = gearCandidates(w.view)[0];
    expect(candidate).toBeDefined();
    const said = candidate?.criteria ?? "";
    const out = steer(w, [offer("wear", said)], [lantern]);
    expect(out[0]?.criteria).toBe(`${said.replace(/\.$/, "")}, which serves the aim: lantern over torch.`);
    expect(out[0]?.aim?.kind).toBe("lantern");
  });

  it("leaves an offer that serves no aim untouched", () => {
    const w = world({ map: OPEN, player: { depth: 1 } });
    const out = steer(w, [offer("rest", "Rest.")], [lantern, dive(5)]);
    expect(out[0]).toEqual(offer("rest", "Rest."));
  });

  it("changes nothing when there are no aims", () => {
    const w = world({ map: OPEN, player: { depth: 1 } });
    const start = [offer("explore", "Walk.")];
    expect(steer(w, start, [])).toEqual(start);
  });

  it("reaches the model's question through the planner", () => {
    const w = world({ map: OPEN, player: { depth: 2 } });
    const p = createGoalPlanner({ cfg: defaultCfg(), terrain: w.terrain, log: () => undefined, reflex: false, strategy: () => steering([dive(5)]) });
    const q = p.ask(w.view) as Question<GoalDigest>;
    const goal = q.request.questions["goal"] as { criteria: Record<string, string | null> };
    expect(goal.criteria["explore"] ?? "").not.toContain("serves the aim");
    expect(JSON.stringify(q.request.state)).toContain("depth target");
  });
});

describe("explore versus descend", () => {
  it("favours descending while the depth target is deeper than the current depth", () => {
    const w = world({ map: OPEN, player: { depth: 2 } });
    const out = steer(w, [offer("explore"), offer("descend")], [dive(5)]);
    expect(out.find((o) => o.goal === "descend")?.aim?.kind).toBe("depth");
    expect(out.find((o) => o.goal === "explore")?.aim).toBeUndefined();
  });

  it("favours exploring once the depth target is reached", () => {
    const w = world({ map: OPEN, player: { depth: 5 } });
    const out = steer(w, [offer("explore"), offer("descend")], [dive(5)]);
    expect(out.find((o) => o.goal === "explore")?.aim?.kind).toBe("depth");
    expect(out.find((o) => o.goal === "descend")?.aim).toBeUndefined();
  });

  it("favours exploring in the dungeon for an aim that needs a find, and never in town", () => {
    const dungeon = world({ map: OPEN, player: { depth: 2 } });
    expect(steer(dungeon, [offer("explore")], [hunt])[0]?.aim?.kind).toBe("free-action");
    const town = world({ map: OPEN, player: { depth: 0 } });
    expect(steer(town, [offer("explore")], [hunt, dive(1)])[0]?.aim).toBeUndefined();
  });

  it("shifts the persona-blended weights toward descend by the ambition slider", () => {
    const w = world({ map: OPEN, player: { depth: 2 } });
    const out = steer(w, [offer("explore"), offer("descend")], [dive(5)]);
    const base = { explore: 0.5, descend: 0.5 };
    const eager = nudgeAims(base, out, 100, 1);
    expect(eager["descend"]).toBeGreaterThan(0.5);
    expect(eager["explore"]).toBe(0.5);
  });
});

describe("pickup priority", () => {
  it("serves picking up while an aim is being saved for, and not once it is affordable", () => {
    const poor = world({ map: OPEN, player: { depth: 2, gold: 10 } });
    expect(steer(poor, [offer("pick_up")], [lantern])[0]?.aim?.kind).toBe("lantern");
    const rich = world({ map: OPEN, player: { depth: 2, gold: 500 } });
    expect(steer(rich, [offer("pick_up")], [lantern])[0]?.aim).toBeUndefined();
    const nothing = world({ map: OPEN, player: { depth: 2, gold: 10 } });
    expect(steer(nothing, [offer("pick_up")], [dive(4), armour])[0]?.aim).toBeUndefined();
  });

  it("gives picking up its full weight, unscaled by rank", () => {
    const w = world({ map: OPEN, player: { depth: 2, gold: 10 } });
    const out = steer(w, [offer("pick_up")], [dive(4), armour, book]);
    expect(out[0]?.aim?.rank).toBe(2);
    expect(nudgeAims({ pick_up: 0.5 }, out, 100, 1)["pick_up"]).toBeCloseTo(0.5 * (1 + MAX_NUDGE));
  });
});

describe("town trip", () => {
  const scroll = "Scroll of Word of Recall";

  it("is offered once an aim is affordable with the gold on hand", () => {
    const w = world({ map: OPEN, player: { depth: 3, gold: 150 }, pack: [scroll] });
    const out = steer(w, [offer("explore")], [book, lantern]);
    expect(goalsOf(out)).toContain("recall_town");
    const trip = out.find((o) => o.goal === "recall_town");
    expect(trip?.criteria).toContain("aim: lantern over torch");
    expect(trip?.aim?.kind).toBe("lantern");
  });

  it("is not offered when no aim is affordable", () => {
    const w = world({ map: OPEN, player: { depth: 3, gold: 50 }, pack: [scroll] });
    expect(goalsOf(steer(w, [offer("explore")], [book, lantern]))).not.toContain("recall_town");
  });

  it("is not offered in town, without a scroll, while a recall is active, or after a recent trip", () => {
    const town = world({ map: OPEN, player: { depth: 0, gold: 500 }, pack: [scroll] });
    expect(goalsOf(steer(town, [], [lantern]))).not.toContain("recall_town");
    const bare = world({ map: OPEN, player: { depth: 3, gold: 500 } });
    expect(goalsOf(steer(bare, [], [lantern]))).not.toContain("recall_town");
    const w = world({ map: OPEN, player: { depth: 3, gold: 500 }, pack: [scroll] });
    expect(goalsOf(steer(w, [], [lantern], true, { recallActive: true, tripRisk: 0.02 }))).not.toContain("recall_town");
    expect(goalsOf(steer(w, [], [lantern], false))).not.toContain("recall_town");
  });

  it("is not added twice when supplies already prompted one", () => {
    const w = world({ map: OPEN, player: { depth: 3, gold: 500 }, pack: [scroll] });
    const out = steer(w, [offer("recall_town", "Restock.")], [lantern]);
    expect(goalsOf(out).filter((g) => g === "recall_town")).toHaveLength(1);
  });

  it("reaches the planner's offers", () => {
    const w = world({ map: OPEN, player: { depth: 3, gold: 150 }, pack: [scroll] });
    const p = createGoalPlanner({ cfg: defaultCfg(), terrain: w.terrain, log: () => undefined, reflex: false, strategy: () => steering([lantern]) });
    const q = p.ask(w.view) as Question<GoalDigest>;
    expect(q.context.offers.map((o) => o.goal)).toContain("recall_town");
  });
});

describe("nudge and the safety floor", () => {
  const tagged = (goal: Offer["goal"], risk: number, rank = 0): Offer => ({ ...offer(goal, "x", risk), aim: { kind: "depth", rank } });

  it("scales with ambition and does nothing at zero", () => {
    const dist = { descend: 0.5, explore: 0.5 };
    const offers = [tagged("descend", 0.1)];
    expect(nudgeAims(dist, offers, 0, 1)).toEqual(dist);
    expect(nudgeAims(dist, offers, 50, 1)["descend"]).toBeCloseTo(0.5 * 1.1);
    expect(nudgeAims(dist, offers, 100, 1)["descend"]).toBeCloseTo(0.5 * (1 + MAX_NUDGE));
  });

  it("stays small: never more than the cap, less for lower ranks", () => {
    const dist = { descend: 1 };
    for (const rank of [0, 1, 2, 5]) {
      const factor = nudgeAims(dist, [tagged("descend", 0, rank)], 100, 1)["descend"] ?? 0;
      expect(factor).toBeLessThanOrEqual(1 + MAX_NUDGE);
      expect(factor).toBeGreaterThan(1);
    }
    expect(MAX_NUDGE).toBeLessThanOrEqual(0.2);
  });

  it("does not raise an offer whose risk is over the ceiling", () => {
    const dist = { descend: 0.5, explore: 0.5 };
    expect(nudgeAims(dist, [tagged("descend", 0.9)], 100, 0.5)).toEqual(dist);
  });

  it("leaves an untagged offer and unknown goals alone", () => {
    const dist = { explore: 0.5 };
    expect(nudgeAims(dist, [offer("explore"), tagged("descend", 0)], 100, 1)).toEqual(dist);
  });

  it("never brings back an option the safety floor removes, even at full ambition", () => {
    const persona = defaultPersona();
    persona.sliders.ambition = 100;
    const ceiling = riskCeiling(persona);
    const risky = ceiling + 0.2;
    const offers = [tagged("descend", risky), offer("explore", "x", 0.01)];
    const dist = { descend: 0.9, explore: 0.1 };
    const risk = { descend: risky, explore: 0.01, none_of_these: 0 };
    const floor = applySafetyFloor(nudgeAims(dist, offers, 100, ceiling), risk, ceiling, false);
    expect(floor.removed).toContain("descend");
    expect(floor.dist["descend"] ?? 0).toBe(0);
  });

  it("is applied by the planner before the floor: a risky aim-serving offer is not picked", () => {
    const w = world({ map: OPEN, player: { depth: 2 }, monsters: [{ grid: { x: 3, y: 1 }, race: "cave orc" }] });
    const persona = defaultPersona();
    persona.sliders.ambition = 100;
    const p = createGoalPlanner({ cfg: defaultCfg(), terrain: w.terrain, log: () => undefined, reflex: false, persona, strategy: () => steering([dive(9)]) });
    const q = p.ask(w.view) as Question<GoalDigest>;
    const chosen = p.choose({ goal: { type: "choice", choice: "explore", confidence: 0.9, probabilities: { explore: 0.9, none_of_these: 0.1 } } }, q.context, w.view);
    expect(JSON.stringify(chosen)).not.toContain("descend");
  });
});