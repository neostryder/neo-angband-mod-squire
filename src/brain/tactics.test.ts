import { describe, expect, it } from "vitest";
import { archetype, defaultPersona } from "../persona/persona.js";
import type { Offer } from "./goals.js";
import { allowedGoals, bandOf, classOf, ESCAPE_HIGH, ESCAPE_LOW, escapeThresholds, lowConfidencePick, pruneDominated, purposeClauses, tacticalLog } from "./tactics.js";

const offer = (goal: Offer["goal"], extra: Partial<Offer> = {}): Offer => ({ goal, criteria: `${goal}.`, risk: 0.1, ...extra });

describe("escape gate thresholds", () => {
  it("uses the base edges without a persona and for a balanced one", () => {
    expect(escapeThresholds(null)).toEqual({ low: ESCAPE_LOW, high: ESCAPE_HIGH });
    const even = defaultPersona();
    const lean = (even.sliders.selfpreservation - even.sliders.boldness) / 100;
    expect(escapeThresholds(even).low).toBeCloseTo(ESCAPE_LOW - lean * 0.15, 2);
  });

  it("asks a bold persona for a stronger yes before it steps back, and a careful one for a weaker one", () => {
    const bold = escapeThresholds(archetype("berserker"));
    const careful = escapeThresholds(archetype("coward"));
    expect(bold.low).toBeGreaterThan(ESCAPE_LOW);
    expect(bold.high).toBeGreaterThan(ESCAPE_HIGH);
    expect(careful.low).toBeLessThan(ESCAPE_LOW);
    expect(careful.high).toBeLessThan(ESCAPE_HIGH);
    for (const bands of [bold, careful]) expect(bands.high - bands.low).toBeGreaterThanOrEqual(0.1 - 1e-9);
  });

  it("puts the same answer in a lower band for a bold persona", () => {
    const p = 0.6;
    expect(bandOf(p, escapeThresholds(archetype("coward")))).toBe("consider");
    expect(bandOf(p, escapeThresholds(archetype("berserker")))).toBe("stay");
    expect(bandOf(0.95, escapeThresholds(archetype("berserker")))).toBe("get_out");
  });
});

describe("escape bands", () => {
  const offers = [offer("fight"), offer("phase"), offer("heal"), offer("explore"), offer("quaff_unknown")];

  it("leaves the choice alone under the low edge", () => {
    expect(allowedGoals("stay", offers)).toBeNull();
  });

  it("shrinks the middle band to escapes, heals, gambles and positions without naming one", () => {
    expect([...allowedGoals("consider", offers)!].sort()).toEqual(["heal", "none_of_these", "phase", "quaff_unknown"]);
  });

  it("leaves only escapes at the top, falling back to the middle set when none is offered", () => {
    expect([...allowedGoals("get_out", offers)!].sort()).toEqual(["none_of_these", "phase"]);
    expect([...allowedGoals("get_out", [offer("fight"), offer("heal")])!].sort()).toEqual(["heal", "none_of_these"]);
    expect(allowedGoals("get_out", [offer("fight"), offer("explore")])).toBeNull();
  });
});

describe("low-confidence fallback", () => {
  const offers = [offer("fight", { risk: 0.3, survival: 5 }), offer("wait", { risk: 0.2, survival: 5 }), offer("phase", { risk: 0.1, survival: 10 }), offer("retreat", { risk: 0.05, survival: -2 })];

  it("takes the safest escape when the gate leans toward getting out, preferring one that leaves hit points", () => {
    expect(lowConfidencePick(offers, 0.6, 0.55)).toBe("phase");
  });

  it("takes the safest attack or wait otherwise", () => {
    expect(lowConfidencePick(offers, 0.2, 0.55)).toBe("wait");
    /* A bold persona whose low edge sits above the answer is not pushed out by an unsure pick. */
    expect(lowConfidencePick(offers, 0.6, 0.64)).toBe("wait");
    expect(lowConfidencePick(offers, null, 0.55)).toBe("wait");
    expect(lowConfidencePick([offer("explore")], 0.1, 0.55)).toBeNull();
  });
});

describe("pruning dominated options", () => {
  it("drops an attack another beats on every count, and keeps one that wins anywhere", () => {
    const fight = offer("fight", { risk: 0.2, cost: 0, progress: 0.8, survival: 10 });
    const oil = offer("throw_oil", { risk: 0.2, cost: 1, progress: 0.6, survival: 10 });
    const spell = offer("cast_attack", { risk: 0.2, cost: 0.5, progress: 1, survival: 10 });
    const { kept, pruned } = pruneDominated([fight, oil, spell], true);
    expect(pruned).toEqual([{ goal: "throw_oil", by: "fight" }]);
    expect(kept.map((o) => o.goal)).toEqual(["fight", "cast_attack"]);
  });

  it("never compares a walk to the target with an attack from where the character stands", () => {
    const walk = offer("fight", { risk: 0.2, cost: 0, progress: 0.8, survival: 10 });
    const oil = offer("throw_oil", { risk: 0.2, cost: 1, progress: 0.6, survival: 10 });
    expect(pruneDominated([walk, oil], false).pruned).toEqual([]);
  });

  it("does not let an uncertain option stand in for a sure one", () => {
    const phase = offer("phase", { risk: 0.05, cost: 1, progress: 0.6, survival: 10, uncertain: true });
    const retreat = offer("retreat", { risk: 0.1, cost: 0, progress: 0.4, survival: 8 });
    expect(pruneDominated([phase, retreat], true).pruned).toEqual([]);
  });

  it("never prunes gambles, errands, waits or anything an order keeps", () => {
    const quaff = offer("quaff_unknown", { risk: 0.5, cost: 1, progress: 0 });
    const heal = offer("heal", { risk: 0.1, cost: 1, progress: 1, survival: 10 });
    const healWorse = offer("cast_heal", { risk: 0.2, cost: 1, progress: 0.5, survival: 5 });
    expect(pruneDominated([quaff, heal, offer("explore"), offer("wait")], true).pruned).toEqual([]);
    expect(pruneDominated([heal, healWorse], true).pruned).toEqual([{ goal: "cast_heal", by: "heal" }]);
    expect(pruneDominated([heal, healWorse], true, new Set(["cast_heal"])).pruned).toEqual([]);
  });

  it("only compares options of the same class", () => {
    expect(classOf("phase")).toBe("escape");
    expect(classOf("rest")).toBe("heal");
    expect(classOf("explore")).toBe("errand");
    const retreat = offer("retreat", { risk: 0.05, cost: 0, progress: 1, survival: 10 });
    const fight = offer("fight", { risk: 0.3, cost: 0, progress: 0.5, survival: 5 });
    expect(pruneDominated([retreat, fight], true).pruned).toEqual([]);
  });
});

describe("option purposes", () => {
  it("names only what differs, one clause per option", () => {
    const clauses = purposeClauses([
      offer("fight", { risk: 0.35, cost: 0, costNote: "nothing", progress: 0.5 }),
      offer("phase", { risk: 0.1, cost: 1, costNote: "1 of 3 carried", progress: 0.6 }),
    ], null);
    expect(clauses.get("fight")).toBe("Purpose: serves the fight; progress: part of the way; costs nothing; high risk.");
    expect(clauses.get("phase")).toBe("Purpose: serves survival; progress: most of the way; costs 1 of 3 carried; some risk.");
  });

  it("leaves out a field every option shares, and gives no clause when nothing differs", () => {
    const clauses = purposeClauses([offer("phase", { costNote: "1 of 3 carried" }), offer("teleport", { costNote: "the last one carried" })], null);
    expect(clauses.get("phase")).toBe("Purpose: costs 1 of 3 carried.");
    expect(purposeClauses([offer("explore"), offer("descend")].map((o) => ({ ...o, criteria: "" })), "explore").get("explore")).toBe("Purpose: serves the near goal of exploring this level.");
    expect(purposeClauses([offer("phase"), offer("teleport")], null).size).toBe(0);
  });

  it("ties an option to the near-term goal it moves along", () => {
    const clauses = purposeClauses([offer("rest"), offer("explore")], "rest");
    expect(clauses.get("rest")).toBe("Purpose: serves the near goal of recovering.");
    expect(clauses.get("explore")).toBe("Purpose: serves exploring.");
  });

  it("always names a birth option the choice runs into, even when nothing else differs", () => {
    const clauses = purposeClauses([offer("phase"), offer("teleport")], null, new Map([["teleport", ["forced descent is on"]]]));
    expect(clauses.get("teleport")).toBe("Purpose: birth option: forced descent is on.");
    expect(clauses.has("phase")).toBe(false);
  });
});

describe("decision log entry", () => {
  it("keeps the gate, pruning, unsure fallback and loop, and nothing when none happened", () => {
    expect(tacticalLog(undefined, undefined)).toEqual({});
    expect(tacticalLog({ pruned: [{ goal: "throw_oil", by: "fight" }], gate: { low: 0.55, high: 0.78, p: 0.9, band: "get_out", allowed: ["phase"] }, lowConfidence: "phase" },
      { kind: "repeat", tactic: "fight", detail: "fight chosen 3 times", fellBack: true })).toEqual({
      tactical: { escape: { p: 0.9, low: 0.55, high: 0.78, band: "get_out" }, pruned: ["throw_oil"], lowConfidence: "phase", loop: { kind: "repeat", tactic: "fight", fellBack: true } },
    });
    expect(tacticalLog({ pruned: [], gate: { low: 0.5, high: 0.7 } }, undefined)).toEqual({ tactical: { escape: { p: null, low: 0.5, high: 0.7 } } });
  });
});
