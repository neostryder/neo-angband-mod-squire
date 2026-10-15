import { describe, expect, it } from "vitest";
import type { Offer } from "./goals.js";
import { NEED_CAP, REGRET_MIN, REGRET_SLOPE, priceGoal } from "./regret.js";
import type { Answer } from "./systemone.js";

const offer = (goal: Offer["goal"], risk: number, extra: Partial<Offer> = {}): Offer => ({ goal, criteria: `${goal}.`, risk, ...extra });
const choice = (pick: string, confidence: number, probabilities: Record<string, number> = { [pick]: 0.6, other: 0.3 }): Answer => ({ type: "choice", choice: pick, confidence, probabilities });

describe("goal gate price", () => {
  const offers = [offer("fight", 0.4), offer("shoot", 0.1), offer("cast_attack", 0.2), offer("phase", 0.05), offer("explore", 0.02)];

  it("prices a pick against the safest option of its own class", () => {
    const price = priceGoal(choice("fight", 0.6), offers, "fight", 0.3);
    expect(price).not.toBeNull();
    expect(price!.safest).toBe("shoot");
    expect(price!.regret).toBeCloseTo(0.3, 3);
    expect(price!.need).toBeCloseTo(Math.min(NEED_CAP, 0.3 + REGRET_SLOPE * 0.3), 3);
    expect(price!.unsure).toBe(true);
    expect(price!.acted).toBe(false);
  });

  it("is sure when the answer clears the price", () => {
    const price = priceGoal(choice("fight", 0.95), offers, "fight", 0);
    expect(price!.need).toBeCloseTo(0.95, 3);
    expect(price!.unsure).toBe(false);
  });

  it("caps what any pick is asked for", () => {
    const high = [offer("fight", 0.9), offer("shoot", 0)];
    expect(priceGoal(choice("fight", 0.5), high, "fight", 0.7)!.need).toBe(NEED_CAP);
  });

  it("does not price a pick that costs about what the safest option does", () => {
    const close = [offer("fight", 0.1 + REGRET_MIN - 0.01), offer("shoot", 0.1)];
    expect(priceGoal(choice("fight", 0.1), close, "fight", 0)).toBeNull();
  });

  it("does not price the safest option of its class or a sole option", () => {
    expect(priceGoal(choice("shoot", 0.1), offers, "shoot", 0)).toBeNull();
    expect(priceGoal(choice("explore", 0.1), [offer("explore", 0.3)], "explore", 0)).toBeNull();
  });

  it("ignores an option with gaps, which could not be taken now", () => {
    const gapped = [offer("fight", 0.4), offer("shoot", 0.05, { gaps: ["no ammunition"] })];
    expect(priceGoal(choice("fight", 0.1), gapped, "fight", 0)).toBeNull();
  });

  it("does not price a pick the model did not make, or an answer that is not a choice", () => {
    expect(priceGoal(choice("shoot", 0.1), offers, "fight", 0)).toBeNull();
    expect(priceGoal({ type: "noul", p: 0.5, confidence: 0.5 } as Answer, offers, "fight", 0)).toBeNull();
    expect(priceGoal(undefined, offers, "fight", 0)).toBeNull();
  });

  it("records the margin between the top two probabilities", () => {
    const price = priceGoal(choice("fight", 0.5, { fight: 0.5, shoot: 0.3, phase: 0.2 }), offers, "fight", 0);
    expect(price!.margin).toBeCloseTo(0.2, 3);
  });
});
