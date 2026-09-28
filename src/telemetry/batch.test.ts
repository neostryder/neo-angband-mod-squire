import { expect, it } from "vitest";
import type { LoggedDecision } from "../memory/log.js";
import { buildBatches, previewBatch, type BatchInput } from "./batch.js";

const summary = {
  persona: { name: "Beren", race: "Human", class: "Warrior" },
  outcome: { ended: true, won: false, depth_max: 3, turns: 100, cause_of_death: null },
  top_kills: [], tokens: { input: 10, output: 1, calls: 1 },
  calibration: { brier: 0.2, QuIrK_note: "remove", nested: { loreText: "remove", kept: 1 } },
};

function decision(seq: number, choice = "north"): LoggedDecision {
  return {
    id: `run-1/${seq}`, runId: "run-1", seq, at: 1, turn: seq, trigger: "start",
    backend: "Jev", question: "move", choice, confidence: 0.8,
    probs: { north: 0.8, persona_note: 0.2 }, state: {}, options: ["north"],
    plan: "walk north", latencyMs: 1, inputTokens: 1, outputTokens: 1,
    estimatedTokens: false, outcome: null,
  };
}

function input(decisions: LoggedDecision[]): BatchInput {
  return {
    installId: "3f2b8c1e-4d5a-4b6c-9d7e-0a1b2c3d4e5f", runId: "run-1", seq: 2,
    sentAt: "2026-09-27T20:00:00Z", modVersion: "0.2.0", gameVersion: "0.22.0",
    summary, decisions, extra: { PersonaData: "remove", nested: { lore: "remove", safe: 1 } },
  };
}

it("strips refused keys throughout decisions, extra and calibration", () => {
  const batch = buildBatches(input([decision(1)]), "full")[0]!;
  expect(JSON.stringify(batch)).not.toMatch(/persona_note|PersonaData|QuIrK_note|loreText|"lore"/);
  expect(batch.decisions?.[0]?.kind).toBe("walk");
  expect(batch.summary.outcome.ended).toBe(true);
  expect(JSON.parse(previewBatch(input([decision(1)]), "full"))).toEqual(batch);
});

it("splits at the UTF-8 byte limit and ends only the last batch", () => {
  const records = Array.from({ length: 5000 }, (_, i) => ({
    ...decision(i, "é".repeat(32)),
    probs: Object.fromEntries(Array.from({ length: 24 }, (_, n) => [`option_${String(n).padStart(2, "0")}`, 0.01])),
  }));
  const batches = buildBatches(input(records), "decisions");
  expect(batches.length).toBeGreaterThan(1);
  expect(batches.flatMap((batch) => batch.decisions ?? [])).toHaveLength(records.length);
  for (const [i, batch] of batches.entries()) {
    expect(Buffer.byteLength(JSON.stringify(batch), "utf8")).toBeLessThanOrEqual(1024 * 1024);
    expect(batch.summary.outcome.ended).toBe(i === batches.length - 1);
    expect(batch.seq).toBe(i + 2);
  }
});

it("sends no batches with consent off", () => {
  expect(buildBatches(input([]), "off")).toEqual([]);
});
