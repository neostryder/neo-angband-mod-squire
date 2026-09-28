import { describe, expect, it } from "vitest";
import { applyPlatt, applyTemperature, bestMoveKey, brier, fitPlatt, fitTemperature, refit, update } from "./calibration.js";

describe("calibration", () => {
  it("keeps identity below twenty samples and scores empty inputs", () => {
    expect(fitPlatt([])).toEqual({ a: 1, b: 0 });
    expect(fitTemperature([])).toBe(1);
    expect(applyPlatt(0.7, fitPlatt([]))).toBe(0.7);
    expect(applyTemperature({}, 2)).toEqual({});
    expect(brier([])).toBe(0);
    expect(brier([{ p: 0.5, y: 1 }])).toBe(0.25);
  });

  it("fits outcomes and keeps only recent samples per best-move key", () => {
    const samples = Array.from({ length: 30 }, () => ({ p: 0.8, y: 0 as const }));
    expect(applyPlatt(0.8, fitPlatt(samples))).toBeLessThan(0.8);
    const choices = Array.from({ length: 30 }, () => ({ probs: { a: 0.9, b: 0.1 }, chosen: "a", good: false }));
    expect(fitTemperature(choices)).toBeGreaterThan(1);
    expect(Object.values(applyTemperature({ a: 9, b: 1 }, 2)).reduce((a, b) => a + b, 0)).toBeCloseTo(1);
    const key = bestMoveKey("jev", "best_move");
    let book = {};
    for (let i = 0; i < 2005; i += 1) book = update(book, key, { p: 0.4, y: 1 });
    const fitted = refit(book);
    expect(fitted[key]?.samples).toHaveLength(2000);
    expect(fitted[key]?.kind).toBe("noul");
    const choiceBook = refit(update({}, key, { probs: { a: 0.8, b: 0.2 }, chosen: "a", good: true }));
    expect(choiceBook[key]?.kind).toBe("choice");
  });
});
