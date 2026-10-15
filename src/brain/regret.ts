/**
 * The goal gate: how sure the model has to be before Squire follows a pick,
 * priced by what a wrong pick would cost.
 *
 * A pick costs more than the safest offer of its kind by the difference in
 * their chance of death soon (`Offer.risk`). When that difference is small,
 * following a doubtful answer loses nothing and the gate stays out of the way.
 * When it is large, the answer has to be surer: the confidence needed is the
 * backend's own floor plus a charge for each point of extra risk. An answer
 * under that is not followed, and the safest offer of the same class is taken.
 *
 * The gate runs in one of three modes. `shadow` prices every pick and logs
 * what it would have done without changing the pick, so the logged outcomes can
 * show whether the prices are right before anything acts on them.
 */

import { classOf } from "./tactics.js";
import type { Goal, Offer } from "./goals.js";
import type { Answer } from "./systemone.js";

export const GOAL_GATE_MODES = ["off", "shadow", "acting"] as const;
export type GoalGateMode = (typeof GOAL_GATE_MODES)[number];

/** Under this much extra risk over the safest offer of its class, a pick is not priced. */
export const REGRET_MIN = 0.05;
/** Confidence charged for each point of extra risk: 0.1 more risk asks 0.4 more confidence. */
export const REGRET_SLOPE = 4;
/** The most confidence any pick is asked for, so a costly pick is never impossible. */
export const NEED_CAP = 0.95;

/** One priced pick, kept for the decision log. */
export interface RegretRecord {
  readonly pick: Goal;
  /** The safest offer of the pick's class. */
  readonly safest: Goal;
  /** How much more likely the pick is to lead to death soon than the safest offer. */
  readonly regret: number;
  /** The confidence the pick was asked for. */
  readonly need: number;
  /** What the model's answer gave. */
  readonly confidence: number;
  /** The model's top probability minus its second, recorded beside the confidence for later calibration. */
  readonly margin: number;
  /** The answer was under what the pick was asked for. */
  readonly unsure: boolean;
  /** The safest offer was taken instead of the pick. */
  readonly acted: boolean;
}

function marginOf(probabilities: Readonly<Record<string, number>>): number {
  const sorted = Object.values(probabilities).sort((a, b) => b - a);
  return (sorted[0] ?? 0) - (sorted[1] ?? 0);
}

/** The offer of the pick's class that leaves the character least at risk, or undefined when none beats the pick. */
function safestAlternative(offers: readonly Offer[], pick: Offer): Offer | undefined {
  const kind = classOf(pick.goal);
  return offers
    .filter((o) => o.goal !== pick.goal && classOf(o.goal) === kind && o.gaps === undefined && o.risk < pick.risk)
    .sort((a, b) => a.risk - b.risk || Number((b.survival ?? 0) > 0) - Number((a.survival ?? 0) > 0) || (a.cost ?? 0) - (b.cost ?? 0))[0];
}

/**
 * Price one pick. Null when the answer is not a choice, when the pick is not the
 * model's own top choice (a persona or a quirk moved it, so the confidence is
 * about another option), or when no safer offer of its class costs less than
 * `REGRET_MIN`. `floor` is the confidence the backend's answers are not
 * followed under at all.
 */
export function priceGoal(answer: Answer | undefined, offers: readonly Offer[], pick: Goal, floor: number): RegretRecord | null {
  if (answer?.type !== "choice" || answer.choice !== pick) return null;
  const offer = offers.find((o) => o.goal === pick);
  if (offer === undefined) return null;
  const safest = safestAlternative(offers, offer);
  if (safest === undefined) return null;
  const regret = offer.risk - safest.risk;
  if (regret < REGRET_MIN) return null;
  const need = Math.min(NEED_CAP, Math.max(floor, 0) + REGRET_SLOPE * regret);
  return {
    pick,
    safest: safest.goal,
    regret: Math.round(regret * 1000) / 1000,
    need: Math.round(need * 1000) / 1000,
    confidence: answer.confidence,
    margin: Math.round(marginOf(answer.probabilities) * 1000) / 1000,
    unsure: answer.confidence < need,
    acted: false,
  };
}
