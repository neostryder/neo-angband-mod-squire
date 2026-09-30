import { describe, expect, it } from "vitest";
import type { AgentView } from "@rpgm-tools/neo-angband-core";
import { createJournal, emptyJournal, type Journal } from "./journal.js";
import type { LoggedDecision } from "./memory/log.js";
import { world, type World } from "./harness.js";

const MAP = [
  "#########",
  "#@......#",
  "#.......#",
  "#########",
];

function journal(): Journal {
  return createJournal(emptyJournal(), { persona: () => null, setPersona: () => {}, send: null, backend: "Jev", save: () => {} });
}

function decision(choice: string, turn: number): LoggedDecision {
  return {
    id: `d${String(turn)}`, runId: "r", seq: turn, at: 0, turn, trigger: "test", backend: "Jev", question: "goal", choice,
    confidence: null, probs: null, state: {}, options: [], plan: choice, latencyMs: 0, inputTokens: 0, outputTokens: 0, estimatedTokens: true, outcome: null,
  };
}

/** The harness has no message log; a test that needs one lays it over the view. */
function withMessages(view: AgentView, messages: readonly string[]): AgentView {
  return { ...view, messages: () => [...messages] };
}

function mage(): World {
  return world({ map: MAP, player: { level: 1, cls: "Mage", hp: 12, maxHp: 12 } });
}

describe("causal lessons", () => {
  it("learns from a large hit it can pin on one creature, with the numbers and what to do", () => {
    const w = mage();
    const j = journal();
    w.setMonsters([{ grid: { x: 4, y: 1 }, race: "battle-scarred veteran", level: 0 }]);
    j.observe(w.view);
    j.decided(decision("fight", 1), w.view);
    w.setMonsters([{ grid: { x: 2, y: 1 }, race: "battle-scarred veteran", level: 0 }]);
    w.setPlayer({ hp: 4 });
    j.observe(w.view);
    expect(j.lessons().map((l) => l.line)).toEqual([
      "A battle-scarred veteran hit a level 1 mage for 8 while it closed to melee, leaving 4 of 12 HP; prefer range or avoid it below 16 HP.",
    ]);
  });

  it("learns nothing from a hit it cannot pin on one creature", () => {
    const w = mage();
    const j = journal();
    const two = [{ grid: { x: 2, y: 1 }, race: "cave spider" }, { grid: { x: 1, y: 2 }, race: "cave spider" }];
    w.setMonsters(two);
    j.observe(w.view);
    w.setPlayer({ hp: 5 });
    j.observe(w.view);
    expect(j.lessons()).toEqual([]);
  });

  it("learns nothing from a small hit", () => {
    const w = mage();
    const j = journal();
    w.setMonsters([{ grid: { x: 2, y: 1 }, race: "soldier ant" }]);
    j.observe(w.view);
    w.setPlayer({ hp: 10 });
    j.observe(w.view);
    expect(j.lessons()).toEqual([]);
  });

  it("names the escape that failed rather than the hit", () => {
    const w = mage();
    const j = journal();
    w.setMonsters([{ grid: { x: 2, y: 1 }, race: "cave spider" }]);
    j.observe(w.view);
    j.decided(decision("phase", 1), w.view);
    w.setPlayer({ hp: 6 });
    j.observe(w.view);
    expect(j.lessons().map((l) => l.outcome)).toEqual(["failed-escape"]);
    expect(j.lessons()[0]?.line).toContain("A short teleport did not get a level 1 mage clear of a cave spider");
  });

  it("learns from a disabling status and from a creature that breeds", () => {
    const w = mage();
    const j = journal();
    w.setMonsters([{ grid: { x: 2, y: 1 }, race: "floating eye" }]);
    j.observe(w.view);
    w.setPlayer({ status: { paralyzed: 5 } });
    j.observe(w.view);
    expect(j.lessons().map((l) => l.line)).toEqual(["A floating eye paralyzed a level 1 mage; fight it only with free action, or not at all."]);

    const b = mage();
    const k = journal();
    const worm = (x: number) => ({ grid: { x, y: 2 }, race: "green worm mass", raceFlags: ["MULTIPLY"] });
    b.setMonsters([worm(5), worm(6)]);
    k.observe(b.view);
    b.setMonsters([worm(5), worm(6), worm(7)]);
    k.observe(b.view);
    b.setMonsters([worm(5), worm(6), worm(7), worm(4)]);
    k.observe(b.view);
    /* One lesson per kind of breeder, kept up to date rather than repeated. */
    expect(k.lessons().map((l) => l.line)).toEqual(["A green worm mass breeds (4 in sight); kill each one at once or take the stairs before it fills the level."]);
  });

  it("learns what a creature can do, and what resists an attack, from the messages", () => {
    const w = mage();
    const j = journal();
    w.setMonsters([{ grid: { x: 6, y: 2 }, race: "kobold archer" }, { grid: { x: 7, y: 1 }, race: "white jelly" }]);
    j.observe(w.view);
    j.decided(decision("cast_attack", 1), w.view);
    const messages = ["The kobold archer fires an arrow.", "The white jelly resists a lot."];
    j.observe(withMessages(w.view, messages));
    j.observe(withMessages(w.view, messages));
    expect(j.lessons().map((l) => l.line).sort()).toEqual([
      "A kobold archer shoots missiles; close in or break its line of sight rather than trade shots.",
      "A white jelly resisted the attack spell; use a different attack on it.",
    ]);
  });

  it("does not name rest as the cause of a near-death", () => {
    const w = mage();
    const j = journal();
    w.setMonsters([{ grid: { x: 2, y: 1 }, race: "Grip, Farmer Maggot's Dog", raceFlags: ["UNIQUE"] }]);
    j.observe(w.view);
    j.decided(decision("rest", 1), w.view);
    w.setPlayer({ hp: 2 });
    j.observe(w.view);
    const lines = j.lessons().map((l) => l.line);
    expect(lines).toEqual(["Grip, Farmer Maggot's Dog brought a level 1 mage down to 2 of 12 HP at 50 ft; next time leave or escape sooner against it."]);
  });

  it("learns no lesson from a unique kill", () => {
    const w = mage();
    const j = journal();
    j.observe(w.view);
    j.kill("Grip, Farmer Maggot's Dog", true, w.view);
    expect(j.lessons()).toEqual([]);
  });
});
