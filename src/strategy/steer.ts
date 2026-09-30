/**
 * How the aims steer the tactical planner: which offers serve an aim, the text
 * that says so, the town trip for an affordable aim, and the small weight nudge
 * in the persona blend. Kept out of goals.ts, which only calls into this.
 */

import type { AgentView } from "@rpgm-tools/neo-angband-core";
import { canRead } from "../brain/pack.js";
import { gearCandidates, TV } from "../gear/compare.js";
import { recallItem, shownName } from "../town/needs.js";
import { affordable, type Aim, type AimKind } from "./aims.js";

/** What the planner needs from the strategy layer. */
export interface Steering {
  /** The ranked aims, best first. */
  readonly aims: readonly Aim[];
  /** Whether a town trip for an affordable aim may be offered at this gold. */
  readonly tripAllowed: (gold: number) => boolean;
}

/** The aim an offer serves, kept on the offer for the nudge. */
export interface AimTag {
  readonly kind: AimKind;
  readonly rank: number;
}

/** The most an ambition of 100 can raise one option's weight, as a fraction. */
export const MAX_NUDGE = 0.2;

interface Steerable {
  readonly goal: string;
  readonly criteria: string;
  readonly risk: number;
  readonly aim?: AimTag;
}

const ARMOUR: readonly number[] = [TV.BOOTS, TV.GLOVES, TV.HELM, TV.CROWN, TV.SHIELD, TV.CLOAK, TV.SOFT_ARMOR, TV.HARD_ARMOR, TV.DRAG_ARMOR];
const WEAPONS: readonly number[] = [TV.HAFTED, TV.POLEARM, TV.SWORD];

/** The aim kind a wear offer's item serves, if any. */
function wornKind(view: AgentView, criteria: string): AimKind | null {
  const candidate = gearCandidates(view).find((c) => c.criteria === criteria);
  const item = candidate === undefined ? undefined : view.inventory().find((i) => i.handle === candidate.handle);
  if (item === undefined) return null;
  const name = shownName(item) ?? "";
  if (/Free Action/i.test(name)) return "free-action";
  if (/See Invisible|Seeing/i.test(name)) return "see-invisible";
  if (item.tval === TV.LIGHT && /Lantern/i.test(name)) return "lantern";
  if (WEAPONS.includes(item.tval)) return "weapon";
  if (ARMOUR.includes(item.tval)) return "armour";
  return null;
}

/** The first aim, best ranked, that the offer serves. */
function servedBy(offer: Steerable, view: AgentView, aims: readonly Aim[], gold: number): { aim: Aim; rank: number } | null {
  const depth = view.player().depth;
  const wear = offer.goal === "wear" ? wornKind(view, offer.criteria) : null;
  for (const [rank, aim] of aims.entries()) {
    let serves = false;
    switch (offer.goal) {
      case "recall_town": serves = affordable(aim, gold); break;
      case "pick_up":
      case "fetch": serves = aim.how === "save" && !affordable(aim, gold); break;
      case "wear": serves = wear === aim.kind; break;
      case "descend": serves = aim.kind === "depth" && aim.depth !== null && aim.depth > depth; break;
      case "explore": serves = depth > 0 && ((aim.kind === "depth" && aim.depth !== null && aim.depth <= depth) || aim.how === "hunt"); break;
    }
    if (serves) return { aim, rank };
  }
  return null;
}

export interface SteerContext {
  readonly recallActive: boolean;
  /** The risk of reading a recall scroll now. */
  readonly tripRisk: number;
}

/**
 * Add the town trip for an affordable aim, tag the offers that serve an aim
 * and add the aim to their criteria text. Offers that serve no aim are
 * returned untouched.
 */
export function steerOffers<T extends Steerable>(
  offers: readonly T[],
  view: AgentView,
  steering: Steering,
  context: SteerContext,
  make: (goal: "recall_town", criteria: string, risk: number) => T,
): T[] {
  if (steering.aims.length === 0) return [...offers];
  const player = view.player();
  const out = [...offers];
  const wanted = steering.aims.find((aim) => affordable(aim, player.gold));
  if (
    wanted !== undefined && player.depth > 0 && !context.recallActive && !out.some((o) => o.goal === "recall_town")
    && steering.tripAllowed(player.gold) && canRead(view) && recallItem(view) !== null
  ) {
    out.push(make("recall_town", `Read Word of Recall to return to town with ${String(player.gold)} gold, enough to buy the aim: ${wanted.label}.`, context.tripRisk));
  }
  return out.map((offer) => {
    const served = servedBy(offer, view, steering.aims, player.gold);
    if (served === null) return offer;
    const text = `${offer.criteria.replace(/\.$/, "")}, which serves the aim: ${served.aim.label}.`;
    return { ...offer, criteria: text, aim: { kind: served.aim.kind, rank: served.rank } };
  });
}

/**
 * Raise the weight of options that serve a ranked aim, by at most MAX_NUDGE
 * scaled by ambition (0 to 100) and by rank. This runs before the safety floor,
 * and an option whose risk is past the ceiling is left alone, so a nudge never
 * brings back an option the floor would remove.
 */
export function nudgeAims(
  dist: Readonly<Record<string, number>>,
  offers: readonly Steerable[],
  ambition: number,
  ceiling: number,
): Record<string, number> {
  const out = { ...dist };
  const scale = Math.max(0, Math.min(100, ambition)) / 100;
  for (const offer of offers) {
    if (offer.aim === undefined || offer.risk > ceiling) continue;
    const weight = offer.goal === "pick_up" ? 1 : Math.max(0.2, 1 - 0.25 * offer.aim.rank);
    const current = out[offer.goal];
    if (current !== undefined) out[offer.goal] = current * (1 + MAX_NUDGE * scale * weight);
  }
  return out;
}
