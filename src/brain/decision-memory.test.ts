import { describe, expect, it } from "vitest";
import { world } from "../harness.js";
import { defaultPersona } from "../persona/persona.js";
import type { Goal, Offer } from "./goals.js";
import { createDecisionMemory, DECISION_MEMORY_SIZE, stuckThresholds } from "./decision-memory.js";

const ROOM = ["#########", "#...,...#", "#...@...#", "#.......#", "#########"];

function rig() {
  const w = world({ map: ROOM });
  const memory = createDecisionMemory();
  function decide(goal: Goal) {
    memory.begin(goal, w.view);
    w.advance(10);
    memory.finish(w.view);
  }
  return { w, memory, decide };
}

function offer(goal: Goal): Offer {
  return { goal, criteria: goal, risk: 0.1 };
}

describe("decision memory", () => {
  it("keeps an XP drought through healing and revisits, and clears it on XP", () => {
    const { w, memory } = rig();
    w.setPlayer({ hp: 59 });
    memory.observe(w.view);
    w.advance(500);
    w.setPlayer({ hp: 60 });
    expect(memory.facts(w.view, null).turnsWithoutExperience).toBe(500);
    w.setPlayer({ depth: 0 });
    memory.observe(w.view);
    w.setPlayer({ depth: 1 });
    expect(memory.facts(w.view, null).turnsWithoutExperience).toBe(500);
    w.setPlayer({ exp: w.view.player().exp + 1 });
    expect(memory.facts(w.view, null).turnsWithoutExperience).toBe(0);
  });

  it("requires hunting and the persona cooldown between refresh attempts", () => {
    const w = world({ map: ROOM });
    let time = 0;
    const memory = createDecisionMemory(() => time);
    const decide = (goal: Goal) => { memory.begin(goal, w.view); w.advance(10); memory.finish(w.view); };
    expect(memory.canRefresh(w.view, null)).toBe(false);
    time = 180000;
    expect(memory.canRefresh(w.view, null)).toBe(true);
    decide("leave_level");
    w.advance(stuckThresholds(null).cooldown);
    time += 180000;
    expect(memory.canRefresh(w.view, null)).toBe(false);
    w.setPlayer({ exp: w.view.player().exp + 1 });
    expect(memory.canRefresh(w.view, null)).toBe(true);
    decide("leave_level");
    w.setPlayer({ exp: w.view.player().exp + 1 });
    expect(memory.canRefresh(w.view, null)).toBe(false);
  });

  it("keeps a bounded record with depth, game turn, coarse position and hit points", () => {
    const { w, memory, decide } = rig();
    for (let i = 0; i < DECISION_MEMORY_SIZE + 1; i++) decide("step_aside");
    expect(memory.record()).toHaveLength(DECISION_MEMORY_SIZE);
    memory.begin("swing_unseen", w.view);
    const turn = w.view.turn();
    const hp = w.view.player().hp;
    w.setPlayer({ hp: hp - 2 });
    w.advance(10);
    memory.finish(w.view);
    expect(memory.record().at(-1)).toMatchObject({ goal: "swing_unseen", depth: 1, turn, region: "0,0", hpBefore: hp, hpAfter: hp - 2 });
    const copy = memory.record();
    expect(copy).not.toBe(memory.record());
  });

  it("counts gains and confirmed kills without treating damage to the character as progress", () => {
    const { w, memory } = rig();
    w.setPlayer({ gold: 0 });
    memory.begin("explore", w.view);
    w.setPlayer({ depth: 2, maxDepth: 2, exp: 105, gold: 7, hp: 10 });
    memory.observe(w.view);
    w.reveal({ x: 4, y: 1 });
    w.setPack(["2 Potions of Cure Light Wounds"]);
    memory.kill(w.view);
    memory.finish(w.view);
    expect(memory.record()[0]?.progress).toMatchObject({ depth: 1, experience: 5, cells: 1, gold: 7, items: 2, kills: 1, recovery: 0 });
  });

  it("counts healing, mana recovery and damage to a visible creature as useful work", () => {
    const { w, memory } = rig();
    w.setPlayer({ hp: 10, sp: 0, maxSp: 10 });
    w.setMonsters([{ grid: { x: 6, y: 2 }, hp: 10, maxHp: 10 }]);
    memory.begin("rest", w.view);
    w.setPlayer({ hp: 12, sp: 1 });
    w.setMonsters([{ grid: { x: 6, y: 2 }, hp: 7, maxHp: 10 }]);
    memory.finish(w.view);
    expect(memory.record()[0]?.progress).toMatchObject({ recovery: 3, damage: 3 });
    expect(memory.facts(w.view, null).decisionsSinceProgress).toBe(0);
  });

  it("reports repetition counts, elapsed turns and candidates untried since progress", () => {
    const { w, memory, decide } = rig();
    const count = stuckThresholds(null).repeat;
    for (let i = 0; i < count; i++) decide("step_aside");
    expect(memory.facts(w.view, null, ["step_aside", "explore"])).toEqual({
      repeated: [{ cycle: ["step_aside"], repetitions: count, decisions: count }], decisionsSinceProgress: count, turnsSinceProgress: count * 10, turnsWithoutExperience: count * 10, untried: ["explore"], cooling: [],
    });
  });

  it("detects short goal cycles across town visits without credit for revisiting mapped ground", () => {
    const { w, memory } = rig();
    memory.observe(w.view);
    w.setPlayer({ depth: 0 });
    memory.observe(w.view);
    for (let i = 0; i < stuckThresholds(null).repeat; i++) {
      memory.begin("descend", w.view);
      w.setPlayer({ depth: 1 });
      w.advance(10);
      memory.finish(w.view);
      memory.begin("leave_level", w.view);
      w.setPlayer({ depth: 0 });
      w.advance(10);
      memory.finish(w.view);
    }
    expect(memory.facts(w.view, null).repeated).toEqual([{ cycle: ["descend", "leave_level"], repetitions: 5, decisions: 10 }]);
    expect(memory.record().every((entry) => entry.progress.depth === 0 && entry.progress.cells === 0)).toBe(true);
  });

  it("breaks a cycle on progress and does not count consumed items or lost gold as gains", () => {
    const { w, memory, decide } = rig();
    w.setPack(["2 Potions of Cure Light Wounds"]);
    w.setPlayer({ gold: 10 });
    for (let i = 0; i < stuckThresholds(null).repeat; i++) decide("explore");
    memory.begin("explore", w.view);
    w.setPack(["a Potion of Cure Light Wounds"]);
    w.setPlayer({ gold: 9 });
    memory.finish(w.view);
    expect(memory.record().at(-1)?.progress).toMatchObject({ gold: 0, items: 0 });
    memory.begin("explore", w.view);
    w.reveal({ x: 4, y: 1 });
    memory.finish(w.view);
    expect(memory.facts(w.view, null, ["explore", "descend"])).toMatchObject({ repeated: [], decisionsSinceProgress: 0, turnsSinceProgress: 0, untried: ["explore", "descend"] });
  });

  it("keeps observing a running decision when a goal review reads its facts", () => {
    const { w, memory } = rig();
    memory.begin("explore", w.view);
    memory.facts(w.view, null);
    w.reveal({ x: 4, y: 1 });
    memory.finish(w.view);
    expect(memory.record()).toHaveLength(1);
    expect(memory.record()[0]?.progress.cells).toBe(1);
  });

  it("forgets the record on reset or when game time goes backwards", () => {
    const { w, memory, decide } = rig();
    decide("explore");
    w.advance(-10);
    memory.observe(w.view);
    expect(memory.record()).toEqual([]);
    decide("explore");
    memory.reset();
    expect(memory.record()).toEqual([]);
    expect(memory.facts(w.view, null).repeated).toEqual([]);
  });

  it("uses Boldness for repetition tolerance and Ambition for the cooling period", () => {
    const persona = defaultPersona();
    persona.sliders.boldness = 100;
    persona.sliders.ambition = 100;
    expect(stuckThresholds(persona)).toEqual({ repeat: 3, futile: 6, cooldown: 1000 });
    persona.sliders.boldness = 0;
    persona.sliders.ambition = 0;
    expect(stuckThresholds(persona)).toEqual({ repeat: 7, futile: 14, cooldown: 200 });
  });
});

describe("futile decision backstop", () => {
  it.each(["step_aside", "swing_unseen", "explore", "rest"] as const)("cools %s only after the evidence reaches the backstop threshold", (goal) => {
    const { w, memory, decide } = rig();
    const offers = [offer(goal), offer("descend")];
    for (let i = 0; i < stuckThresholds(null).futile - 1; i++) decide(goal);
    expect(memory.withhold(offers, w.view, null)).toEqual(offers);
    decide(goal);
    expect(memory.withhold(offers, w.view, null)).toEqual([offer("descend")]);
    expect(memory.facts(w.view, null).cooling).toContainEqual({ goal, until: w.view.turn() + stuckThresholds(null).cooldown });
    w.advance(stuckThresholds(null).cooldown);
    expect(memory.withhold(offers, w.view, null)).toEqual(offers);
  });

  it("keeps the last option and preserves escapes and routine reflexes", () => {
    const { w, memory, decide } = rig();
    for (const goal of ["step_aside", "retreat", "rest"] as const) {
      memory.reset();
      for (let i = 0; i < stuckThresholds(null).futile; i++) decide(goal);
      expect(memory.withhold([offer(goal)], w.view, null)).toEqual([offer(goal)]);
      const protectedOffers: Offer[] = [offer("retreat"), { ...offer(goal), routine: true }];
      expect(memory.withhold(protectedOffers, w.view, null)).toEqual(protectedOffers);
    }
  });

  it("keeps the safety floor's remaining choice when every alternative is over its ceiling", () => {
    const { w, memory, decide } = rig();
    const persona = defaultPersona();
    for (let i = 0; i < stuckThresholds(persona).futile; i++) decide("step_aside");
    const offers = [offer("step_aside"), { ...offer("descend"), risk: 1 }];
    expect(memory.withhold(offers, w.view, persona)).toEqual(offers);
    const allRisky = [{ ...offer("step_aside"), risk: 0.9 }, { ...offer("descend"), risk: 1 }];
    expect(memory.withhold(allRisky, w.view, persona)).toEqual(allRisky);
  });

  it("cools every futile member of a short cycle while preserving an alternative", () => {
    const { w, memory, decide } = rig();
    for (let i = 0; i < stuckThresholds(null).futile; i++) {
      decide("step_aside");
      decide("swing_unseen");
    }
    expect(memory.withhold([offer("step_aside"), offer("swing_unseen"), offer("descend")], w.view, null)).toEqual([offer("descend")]);
    memory.begin("descend", w.view);
    w.setPlayer({ exp: 101 });
    memory.finish(w.view);
    expect(memory.facts(w.view, null).cooling).toEqual([]);
    expect(memory.withhold([offer("step_aside"), offer("descend")], w.view, null)).toHaveLength(2);
  });
});

describe("quiet refresh pacing", () => {
  it("requires three minutes on each visit even after a kill and thousands of game turns", () => {
    const w = world({ map: ROOM });
    let time = 0;
    const memory = createDecisionMemory(() => time);
    memory.observe(w.view);
    w.advance(5000);
    memory.kill(w.view);
    time = 179999;
    expect(memory.canRefresh(w.view, null)).toBe(false);
    time = 180000;
    expect(memory.canRefresh(w.view, null)).toBe(true);
    memory.begin("leave_level", w.view);
    w.setPlayer({ depth: 0 });
    memory.observe(w.view);
    time += 1000;
    w.setPlayer({ depth: 1 });
    memory.observe(w.view);
    memory.kill(w.view);
    w.advance(5000);
    time += 179999;
    expect(memory.canRefresh(w.view, null)).toBe(false);
    time += 1;
    expect(memory.canRefresh(w.view, null)).toBe(true);
    w.advance(-10000);
    expect(memory.canRefresh(w.view, null)).toBe(false);
  });
});
