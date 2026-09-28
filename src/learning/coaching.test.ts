import { describe, expect, it } from "vitest";
import type { LoggedDecision } from "../memory/log.js";
import { agreement, coachingExample, workedExamples } from "./coaching.js";

const record: LoggedDecision = {
  id: "r/1", runId: "r", seq: 1, at: 0, turn: 10, trigger: "danger", backend: "jev",
  question: "best_move", choice: "fight", confidence: 0.8, probs: { fight: 0.8, phase: 0.2 },
  state: { summary: "a troll closes in", dangerousNear: true }, options: ["fight", "phase"],
  plan: "fight", latencyMs: 1, inputTokens: 2, outputTokens: 2, estimatedTokens: false, outcome: null,
};

describe("coaching", () => {
  it("captures player corrections and weights demonstrations", () => {
    const example = coachingExample(record, "phase", "watch", "low health");
    expect(example).toMatchObject({ playerPick: "phase", squirePick: "fight", weight: 2, reason: "low health" });
    expect(example.situation).toBe(record.state);
    expect(coachingExample(record, "fight", "takeover").weight).toBe(1);
    expect(coachingExample(record, "fight", "why").reason).toBeUndefined();
  });

  it("measures overall and per-family agreement and gives worked corrections", () => {
    const wrong = coachingExample(record, "phase", "watch", "low health");
    const right = coachingExample(record, "fight", "takeover");
    expect(agreement([])).toBe(0);
    expect(agreement([wrong, right])).toBeCloseTo(1 / 3);
    expect(agreement([wrong], "other")).toBe(0);
    expect(workedExamples([wrong, right], "fight", "phase", 1)).toEqual(["For a troll closes in, prefer phase over fight: low health"]);
    expect(workedExamples([], "fight", "phase", 2)).toEqual([]);
  });
});
