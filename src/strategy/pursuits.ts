/**
 * The long goals a character holds, and how much each matters to it. The win
 * (Sauron on dungeon level 99, then Morgoth on 100) is held by every persona;
 * Ambition sets most of its weight, and the other sliders and quirks add the
 * goals a player would name from the persona: riches, fine gear, the sights of
 * the dungeon, uniques, a family grudge, an ancestor's record, depth for its
 * own sake and keeping the line alive. Code works out the goals and weights;
 * the model sees them as facts and the planner turns them into small weight
 * changes on the options that serve them, never past the safety ceiling.
 */

import type { AgentView } from "@rpgm-tools/neo-angband-core";
import type { Feeling } from "../learning/grudges.js";
import type { Persona } from "../persona/persona.js";

export type PursuitKind = "win" | "riches" | "treasure" | "sights" | "uniques" | "grudge" | "record" | "depth" | "lineage";

export interface Pursuit {
  readonly kind: PursuitKind;
  /** A short lowercase name, for the panel and the model. */
  readonly label: string;
  /** 0 to 1: how much this goal matters to the character. */
  readonly weight: number;
  readonly detail: string;
}

/** What the family line knows that shapes an heir's goals. */
export interface FamilyFacts {
  /** The deepest dungeon level an ancestor reached, if any did. */
  readonly deepest: number | null;
  readonly heir: boolean;
}

/** A goal below this weight is not one the character holds; the win is always held. */
export const PURSUIT_FLOOR = 0.4;
/** The win's weight at Ambition 0 with no Pride: every persona keeps some. */
export const WIN_FLOOR = 0.15;

/** The milestones on the road to the win, each a step a watching player would name. */
export const WIN_STEPS: readonly number[] = [5, 10, 15, 20, 30, 40, 50, 60, 70, 80, 90, 99, 100];
export const SAURON_DEPTH = 99;
export const MORGOTH_DEPTH = 100;

function unit(value: number): number {
  return Math.max(0, Math.min(1, value / 100));
}

function rounded(value: number): number {
  return Math.round(Math.max(0, Math.min(1, value)) * 100) / 100;
}

/** How much winning matters: mostly Ambition, a little Pride. */
export function winWeight(persona: Persona | null): number {
  if (persona === null) return rounded(WIN_FLOOR + 0.75 * 0.5 + 0.1 * 0.5);
  return rounded(WIN_FLOOR + 0.75 * unit(persona.sliders.ambition) + 0.1 * unit(persona.sliders.pride));
}

/** How urgent the win is, as the word the model reads. */
export function winUrgency(weight: number): string {
  return weight >= 0.8 ? "driven" : weight >= 0.55 ? "high" : weight >= 0.35 ? "moderate" : "low";
}

/** The next step on the road to the win, from the deepest level reached. */
export function winStep(maxDepth: number): { readonly depth: number; readonly text: string } {
  const depth = WIN_STEPS.find((step) => step > maxDepth) ?? MORGOTH_DEPTH;
  if (depth === SAURON_DEPTH) return { depth, text: "kill Sauron, the Sorcerer, on dungeon level 99" };
  if (depth === MORGOTH_DEPTH) return { depth, text: "kill Morgoth, Lord of Darkness, on dungeon level 100" };
  return { depth, text: `reach dungeon level ${String(depth)} (${String(depth * 50)} ft)` };
}

/**
 * How far past the code's depth target this persona is willing to set it:
 * 0.75 of the target at Ambition 0, 1.0 at 50, 1.35 at 100. Readiness still
 * gates every staircase, so a faster pace never skips a safety floor.
 */
export function paceFactor(persona: Persona | null): number {
  const ambition = persona === null ? 0.5 : unit(persona.sliders.ambition);
  return ambition <= 0.5 ? 0.75 + ambition * 0.5 : 1 + (ambition - 0.5) * 0.7;
}

/** The goals the persona holds, most wanted first. */
export function pursuitsFor(persona: Persona | null, maxDepth: number, feelings: readonly Feeling[] = [], family: FamilyFacts | null = null): Pursuit[] {
  const step = winStep(maxDepth);
  const win: Pursuit = {
    kind: "win", label: "win the game", weight: winWeight(persona),
    detail: `Defeat Sauron on dungeon level 99 and then Morgoth on dungeon level 100. The next step is to ${step.text}.`,
  };
  if (persona === null) return [win];
  const s = persona.sliders;
  const out: Pursuit[] = [win];
  const add = (kind: PursuitKind, label: string, weight: number, detail: string) => {
    if (weight >= PURSUIT_FLOOR) out.push({ kind, label, weight: rounded(weight), detail });
  };
  add("riches", "get rich", 0.8 * unit(s.greed) + 0.2 * unit(s.savings), "Pick up gold and sellable loot, and detour for it when the detour is safe.");
  add("treasure", "collect artifacts and fine gear", 0.4 * unit(s.greed) + 0.3 * unit(s.curiosity) + 0.3 * unit(s.hoarding) + (persona.quirks.compulsive.on ? 0.15 : 0),
    "Look over every item on the floor and keep the best gear and any artifact.");
  add("sights", "see the dungeon", (0.45 * unit(s.curiosity) + 0.45 * unit(s.levelfeel) + 0.1 * unit(s.patience)) * (1 - 0.3 * unit(s.ambition)),
    "Explore each level and learn its feeling before taking the stairs.");
  add("uniques", "hunt uniques", 0.6 * unit(s.pride) + 0.4 * unit(s.glory), "Fight uniques that can be beaten within the risk the character accepts.");
  const hated = persona.toggles.grudges ? feelings.filter((f) => f.unique && f.kind === "hatred").sort((a, b) => b.count - a.count)[0] : undefined;
  if (hated !== undefined) add("grudge", `settle the grudge with ${hated.name}`, 0.45 + 0.3 * unit(s.stubbornness) + 0.15 * unit(s.boldness), `${hated.name} killed some of the family. Kill it when the fight can be won.`);
  if (family !== null && family.heir && family.deepest !== null && family.deepest > maxDepth) {
    add("record", "beat the family's deepest level", 0.3 + 0.4 * unit(s.pride) + 0.3 * unit(s.ambition), `Go below dungeon level ${String(family.deepest)}, the deepest any ancestor reached.`);
  }
  add("depth", "go deep for its own sake", 0.6 * unit(s.boldness) + 0.4 * unit(s.impulsiveness), "Take the stairs down whenever the character is ready for the next level.");
  add("lineage", "keep the family line going", Math.max(0, (s.selfpreservation - 30) / 70) * 0.8 + (family?.heir === true ? 0.1 : 0), "Leave a fight early and walk out of the dungeon alive. A dead character has no heir to teach.");
  return out.sort((a, b) => b.weight - a.weight || (a.kind === "win" ? -1 : b.kind === "win" ? 1 : 0));
}

/** The weight of one goal, or 0 when the character does not hold it. */
export function pursuitWeight(pursuits: readonly Pursuit[], kind: PursuitKind): number {
  return pursuits.find((p) => p.kind === kind)?.weight ?? 0;
}

/** The goals as facts for a model request, one fact per key. */
export function pursuitFacts(pursuits: readonly Pursuit[]): Record<string, string> {
  const win = pursuits.find((p) => p.kind === "win");
  if (pursuits.length === 0) return {};
  return {
    goals: `Goals, most wanted first: ${pursuits.map((p) => `${p.label} (${p.weight >= 0.7 ? "strongly" : p.weight >= 0.5 ? "clearly" : "somewhat"} wanted)`).join(", ")}.`,
    ...(win === undefined ? {} : { win_urgency: `Winning the game matters ${winUrgency(win.weight) === "driven" ? "above everything" : winUrgency(win.weight) === "high" ? "a great deal" : winUrgency(win.weight) === "moderate" ? "somewhat" : "little"} to this character. ${win.detail}` }),
  };
}

const ATTACKS: ReadonlySet<string> = new Set(["fight", "shoot", "throw_oil", "cast_attack", "aim_wand"]);
const ESCAPES: ReadonlySet<string> = new Set(["phase", "teleport", "retreat", "leave_level", "heal", "cast_heal"]);

/** The most one goal can raise an option's weight, as a fraction, at goal weight 1. */
export const PURSUIT_NUDGE = 0.6;

/**
 * Raise the weight of options that serve a goal the character holds. Like the
 * aim nudge, this runs before the safety floor and skips options past the
 * ceiling, so a goal never brings back an option the floor would remove.
 * Descending is not nudged while the stairs would be an escape; that weight
 * belongs to survival, not to ambition.
 */
export function nudgePursuits(
  dist: Readonly<Record<string, number>>,
  offers: readonly { readonly goal: string; readonly risk: number }[],
  pursuits: readonly Pursuit[],
  view: AgentView,
  ceiling: number,
  escaping: boolean,
): Record<string, number> {
  const out = { ...dist };
  if (pursuits.length === 0) return out;
  const w = (kind: PursuitKind) => pursuitWeight(pursuits, kind);
  const player = view.player();
  const uniqueInSight = view.monsters().some((m) => m.visible && m.raceFlags.includes("UNIQUE"));
  const grudge = pursuits.find((p) => p.kind === "grudge");
  const grudgeInSight = grudge !== undefined && view.monsters().some((m) => m.visible && grudge.label.endsWith(m.race));
  const awake = view.monsters().some((m) => m.visible && !m.asleep);
  for (const offer of offers) {
    if (offer.risk > ceiling) continue;
    const current = out[offer.goal];
    if (current === undefined) continue;
    let lift = 0;
    switch (offer.goal) {
      case "descend":
        if (!escaping) lift = 0.6 * w("win") + 0.4 * w("depth") + 0.4 * w("record") - 0.5 * w("sights") - 0.3 * w("lineage");
        break;
      case "recall_dungeon": lift = 0.5 * w("win") + 0.3 * w("record"); break;
      case "explore": lift = 0.6 * w("sights") + 0.2 * w("treasure") + 0.2 * w("riches"); break;
      case "fetch":
      case "pick_up": lift = 0.7 * w("riches") + 0.5 * w("treasure"); break;
      case "study": lift = 0.2 * w("sights"); break;
      default:
        if (ATTACKS.has(offer.goal)) lift = (uniqueInSight ? 0.7 * w("uniques") : 0) + (grudgeInSight ? 0.8 * w("grudge") : 0);
        else if (ESCAPES.has(offer.goal) && awake && player.hp < player.maxHp) lift = 0.5 * w("lineage");
    }
    out[offer.goal] = current * Math.max(0.4, 1 + PURSUIT_NUDGE * lift);
  }
  return out;
}
