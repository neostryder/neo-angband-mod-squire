import { describe, expect, it } from "vitest";
import { JEV } from "../brain/backend.js";
import { createTally } from "../brain/tally.js";
import type { LoggedDecision } from "../memory/log.js";
import { defaultPersona } from "../persona/persona.js";
import { createRunLog } from "./events.js";
import { buildRunSummary, summaryForTelemetry, type RunReport } from "./summary.js";

function report(outcome: RunReport["outcome"]): RunReport {
  return {
    outcome, cause: outcome === "death" ? "Killed by a troll" : "Won the game", key: null,
    name: "Mira", race: "Elf", cls: "Mage", level: 12, maxLevel: 12, maxDepth: 15, depth: 15,
    gold: 500, turn: 100, score: 1000, scored: true, endedAt: 1000,
    history: [{ kind: "unique", text: "Bullroarer the Hobbit", turn: 30, depth: 5, level: 6 }],
    messages: [], belongings: [], sheet: null,
    birth: { race: "Elf", cls: "Mage", name: "Mira", stats: [10, 10, 10, 10, 10, 10] },
  };
}

function decision(seq: number, turn: number, best: string, blended: string): LoggedDecision {
  return {
    id: `run/${String(seq)}`, runId: "run", seq, at: turn, turn, trigger: "ready", backend: "Jev",
    question: "fight?", choice: blended, confidence: 0.8, probs: null, state: { spell: "Magic Missile", weapon: "Dagger" },
    options: ["fight", "flee"], plan: blended, latencyMs: 10, inputTokens: 20, outputTokens: 5,
    estimatedTokens: false, outcome: null,
    persona: { best, inCharacter: blended, blended, strength: 60, removed: false },
  };
}

function input(outcome: RunReport["outcome"]) {
  const runLog = createRunLog();
  runLog.record({ kind: "kill", turn: 20, depth: 3, text: "an orc", race: "Orc" });
  runLog.record({ kind: "descend", turn: 40, depth: 8, text: "Took the stairs" });
  runLog.record({ kind: "near-death", turn: 90, depth: 15, text: "Fell to 2 HP", value: 2 });
  const tally = createTally({ perSessionUsd: 0, perDayUsd: 0 });
  tally.record(JEV, { inputTokens: 100, outputTokens: 20, estimated: false }, 1000);
  const persona = defaultPersona("Mira");
  persona.sliders.boldness = 80;
  persona.backstory = "private life story";
  return {
    report: report(outcome), runLog, tally, persona,
    decisions: [decision(0, 20, "fight", "fight"), decision(1, 80, "flee", "fight"), decision(2, 95, "flee", "flee")],
    lessonsLearned: ["Heal before the next blow."], lessonsInherited: ["Keep a way out."],
    lineageNames: ["Arin"], calibration: { Jev: { brier: 0.2, backstoryHint: "secret", traitScore: 2 },
      backstoryStore: { secret: "private" } }, chronicleHighlights: ["Cut down Bullroarer."],
  };
}

describe("run summary", () => {
  it("maps a death, including the blamed decision, costs and divergence", () => {
    const source = input("death");
    const model = buildRunSummary({ ...source, blamedDecisionId: "run/0" });
    expect(model.headline).toMatchObject({ deepestFeet: 750, outcome: "death", cause: "Killed by a troll" });
    expect(model.deathDecisions.map((entry) => entry.id)).toEqual(["run/0", "run/1", "run/2"]);
    expect(model.divergence).toEqual({ count: 1, rate: 1 / 3 });
    expect(model.personaRadar.find((trait) => trait.id === "boldness")?.value).toBe(80);
    expect(model.personaRadar.some((trait) => trait.id === "chronicle")).toBe(false);
    expect(model.spellsByUse).toEqual([{ name: "Magic Missile", count: 3 }]);
    expect(model.uniquesKilled).toEqual(["Bullroarer the Hobbit"]);
    expect(model.tokens).toMatchObject({ requests: 1, inputTokens: 100, outputTokens: 20 });
    expect(summaryForTelemetry(model).outcome).toEqual({ ended: true, won: false, depth_max: 15,
      turns: 100, cause_of_death: "Killed by a troll" });
  });

  it("maps a victory and sends no traits or backstory in telemetry", () => {
    const { chronicleHighlights: _highlights, ...source } = input("victory");
    const model = buildRunSummary(source);
    expect(model.deathDecisions).toEqual([]);
    expect(model.chronicleHighlights[0]).toContain("Fell to 2 HP");
    const telemetry = summaryForTelemetry(model);
    expect(telemetry.outcome).toMatchObject({ ended: true, won: true, cause_of_death: null });
    expect(telemetry.persona).toEqual({ name: "Mira", race: "Elf", class: "Mage" });
    expect(telemetry.top_kills).toEqual([{ name: "Orc", count: 1 }]);
    expect(telemetry.tokens).toEqual({ input: 100, output: 20, calls: 1 });
    expect(JSON.stringify(telemetry)).not.toMatch(/backstory|trait|private life story|boldness/i);
  });

  it("includes apprenticeship facts only when the notebook has decisions", () => {
    const source = input("victory");
    const model = buildRunSummary({ ...source, apprentice: {
      agreed: 30, total: 40, commands: [{ kind: "heal", turn: 10, hpShare: 0.4 }],
      exams: [{ matched: 14, scored: 18 }], examArmed: false, ghostHint: null, ghostGoal: null,
      entries: [{ turn: 10, squire: "fight", knight: "heal", agreed: false,
        line: "Noted: you chose to heal.", demonstration: false, confidence: 0.9,
        signature: { depthBand: 1, classId: "Mage", levelBand: 1, families: ["orc"], hpBand: 2, resources: [] } }],
    } });
    expect(model.apprenticeship).toMatchObject({ rank: "Squire", agreementShare: 0.75,
      surprises: ["Noted: you chose to heal."], latestExam: { matched: 14, scored: 18 } });
    expect(model.apprenticeship?.knightRadar.find((trait) => trait.id === "healat")?.value).toBe(40);
    expect(buildRunSummary(source).apprenticeship).toBeUndefined();
  });
});
