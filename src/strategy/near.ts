/**
 * Near-term goals the character can act on right now. Code builds the
 * candidates from the view; one Choice picks among them. A missing answer
 * keeps the first candidate in the fixed order. Nothing here changes a
 * tactical weight.
 */

import type { AgentView } from "@rpgm-tools/neo-angband-core";
import type { Answer, SystemOneRequest } from "../brain/systemone.js";
import { canRead } from "../brain/pack.js";
import { badLevelFeeling } from "../brain/level-feel.js";
import { fastUniqueAtLowLevel, threatIndex } from "../brain/threat-model.js";
import { frontiers } from "../map.js";
import type { Persona } from "../persona/persona.js";
import type { Terrain } from "../terrain.js";
import { emptyFlourishes } from "../learning/family-ways.js";
import { recallItem, shownName } from "../town/needs.js";
import { neededEntrances } from "../town/plan.js";
import type { HomeStock } from "../town/home.js";
import type { StoreMemory } from "../town/memory.js";
import { createJourney } from "./journey.js";
import { descentGaps, supplyMargin } from "./readiness.js";
import type { Aim } from "./aims.js";

export const NEAR_ORDER = ["explore", "rest", "down", "leave", "recall", "shop", "try", "position"] as const;
export type NearKind = (typeof NEAR_ORDER)[number];

/** What made a level one to leave, kept from the moment the goal was chosen because the feeling line is gone by the next step. */
export type LeaveDanger = "feeling" | "unique";

export interface NearCandidate {
  readonly kind: NearKind;
  readonly label: string;
  readonly detail: string;
  readonly danger?: LeaveDanger;
}

const TEXT: Readonly<Record<NearKind, { readonly label: string; readonly detail: string }>> = {
  explore: { label: "explore this level", detail: "Walk the unexplored frontier of this level." },
  rest: { label: "rest to full", detail: "Rest until hit points and spell points are full. Nothing is awake in view." },
  down: { label: "go down", detail: "Take the stairs down. The journey offers it, and nothing hard is missing for the next level." },
  leave: { label: "leave this level", detail: "Leave this level. It reads as dangerous, or a dangerous unique is in view." },
  recall: { label: "recall to town", detail: "Read Word of Recall. Supplies are short and a scroll is in the pack." },
  shop: { label: "shop or sell", detail: "Visit a shop the plan already wants." },
  try: { label: "try an unknown item", detail: "Try an unknown item in the pack. Nothing is awake in view." },
  position: { label: "take a defensible position", detail: "Take a defensible position. A creature in view is stronger than the character." },
};

const NONE_OF_THESE = "None of the listed options suits this moment.";

export interface NearEnd {
  readonly end: "met" | "failed" | "abandoned";
  readonly reason: string;
}

export interface NearFacts {
  readonly terrain: Terrain | null;
  readonly persona: Persona | null;
  readonly aims: readonly Aim[];
  readonly memories: readonly StoreMemory[];
  readonly home?: HomeStock;
  /** Dungeon level where this near-term goal was chosen. */
  readonly startDepth: number;
  /** Why the level read as one to leave, when the goal is leave. */
  readonly danger?: LeaveDanger;
}

const DANGER_NOW: Readonly<Record<LeaveDanger, string>> = {
  feeling: "Leave this level, which feels dangerous.",
  unique: "Leave this level while a dangerous unique is in view.",
};

const DANGER_LEFT: Readonly<Record<LeaveDanger, string>> = {
  feeling: "the character got off a level that felt dangerous",
  unique: "the character got away from the dangerous unique it saw",
};

function awake(view: AgentView): boolean {
  return view.monsters().some((monster) => monster.visible && !monster.asleep);
}

function hurt(view: AgentView): boolean {
  const player = view.player();
  return player.hp < player.maxHp || (player.maxSp > 0 && player.sp < player.maxSp);
}

function full(view: AgentView): boolean {
  const player = view.player();
  return player.hp >= player.maxHp && (player.maxSp === 0 || player.sp >= player.maxSp);
}

function unknownInPack(view: AgentView): boolean {
  return view.inventory().some((item) => /\{\?\?\}/.test(shownName(item) ?? ""));
}

/** Visible creatures only. An unseen monster is not a fact the character has. */
function stronger(view: AgentView): boolean {
  const player = view.player();
  return view.monsters().some((monster) => monster.visible && threatIndex(monster, player.level, player.hp, new Set(), player.depth === 0) >= 2);
}

/** The races of the dangerous uniques the character can see. An unseen monster is not a fact the character has. */
export function dangerousUniquesInView(view: AgentView): string[] {
  const player = view.player();
  return view.monsters().filter((monster) => monster.visible && monster.raceFlags.includes("UNIQUE") && (
    threatIndex(monster, player.level, player.hp, new Set(), player.depth === 0) >= 2 || fastUniqueAtLowLevel(monster, player)
  )).map((monster) => monster.race);
}

function dangerousUnique(view: AgentView): boolean {
  return dangerousUniquesInView(view).length > 0;
}

function journeyKeeps(view: AgentView, terrain: Terrain, persona: Persona | null, goal: "explore" | "descend"): boolean {
  const journey = createJourney(terrain);
  const kept = journey.apply([
    { goal: "explore", criteria: "Explore this level.", risk: 0.1 },
    { goal: "descend", criteria: "Take the stairs down.", risk: 0.1 },
  ], view, persona, new Set(), false);
  return kept.some((offer) => offer.goal === goal);
}

function shopsWanted(view: AgentView, facts: NearFacts): boolean {
  if (facts.terrain === null || view.player().depth !== 0) return false;
  const entrances = facts.home === undefined
    ? neededEntrances(view, facts.terrain, facts.persona, new Set(), facts.aims, emptyFlourishes(), facts.memories)
    : neededEntrances(view, facts.terrain, facts.persona, new Set(), facts.aims, emptyFlourishes(), facts.memories, facts.home);
  return entrances.length > 0;
}

function downOpen(view: AgentView, facts: NearFacts): boolean {
  if (facts.terrain === null) return true;
  if (descentGaps(view, view.player().depth + 1).hard.length > 0) return false;
  return journeyKeeps(view, facts.terrain, facts.persona, "descend");
}

function candidate(kind: NearKind): NearCandidate {
  return { kind, label: TEXT[kind].label, detail: TEXT[kind].detail };
}

/**
 * Turns left on an active Word of Recall, or null on a game too old to
 * report it. Reading the last scroll empties the pack while the recall is
 * still counting down.
 */
function recallTurns(view: AgentView): number | null {
  const reported = (view.player() as { recall?: unknown }).recall;
  return typeof reported === "number" ? reported : null;
}

/** The feasible near-term goals, in the fixed order. */
export function nearCandidates(view: AgentView, facts: NearFacts): NearCandidate[] {
  const player = view.player();
  const out: NearCandidate[] = [];
  if (facts.terrain !== null && frontiers(view, facts.terrain).length > 0 && journeyKeeps(view, facts.terrain, facts.persona, "explore")) out.push(candidate("explore"));
  if (hurt(view) && !awake(view)) out.push(candidate("rest"));
  if (facts.terrain !== null && descentGaps(view, player.depth + 1).hard.length === 0 && journeyKeeps(view, facts.terrain, facts.persona, "descend")) out.push(candidate("down"));
  const danger: LeaveDanger | null = badLevelFeeling(view.messages()) !== null ? "feeling" : dangerousUnique(view) ? "unique" : null;
  if (danger !== null) out.push({ ...candidate("leave"), detail: DANGER_NOW[danger], danger });
  if (player.depth > 0 && recallItem(view) !== null && supplyMargin(view) !== null && canRead(view)) out.push(candidate("recall"));
  if (shopsWanted(view, facts)) out.push(candidate("shop"));
  if (unknownInPack(view) && !awake(view)) out.push(candidate("try"));
  if (stronger(view)) out.push(candidate("position"));
  return out;
}

/**
 * Whether a recall goal can no longer happen on this level. An active recall
 * is still on its way. Without the countdown a missing scroll may be one
 * already read, so only a reported idle recall fails for want of a scroll.
 */
function recallStuck(view: AgentView): NearEnd | null {
  const turns = recallTurns(view);
  if (turns !== null && turns > 0) return null;
  if (recallItem(view) !== null) return canRead(view) ? null : { end: "failed", reason: "the character cannot read the Word of Recall" };
  return turns === null ? null : { end: "failed", reason: "no Word of Recall is in the pack" };
}

/**
 * Whether the near-term goal has ended. A level change is judged before the
 * new level's frontier, so an explore goal does not look finished on a fresh map.
 */
export function nearEnded(kind: NearKind, view: AgentView, facts: NearFacts): NearEnd | null {
  const depth = view.player().depth;
  const left = depth !== facts.startDepth;
  switch (kind) {
    case "explore":
      if (left) return { end: "abandoned", reason: "the character left the level" };
      if (facts.terrain === null) return null;
      if (frontiers(view, facts.terrain).length === 0) return { end: "met", reason: "the level has no unexplored frontier" };
      if (!journeyKeeps(view, facts.terrain, facts.persona, "explore")) return { end: "met", reason: "the explore offer is gone" };
      return null;
    case "rest":
      if (full(view)) return { end: "met", reason: "hit points and spell points are full" };
      if (left) return { end: "abandoned", reason: "the character left the level" };
      if (awake(view)) return { end: "failed", reason: "a creature is awake in view" };
      return null;
    case "down":
      if (depth > facts.startDepth) return { end: "met", reason: "dungeon level increased" };
      if (depth < facts.startDepth) return { end: "failed", reason: "dungeon level decreased" };
      if (!downOpen(view, facts)) return { end: "failed", reason: "the way down is no longer open" };
      return null;
    case "leave":
      if (left) return { end: "met", reason: facts.danger === undefined ? "the character left the level" : DANGER_LEFT[facts.danger] };
      return null;
    case "recall":
      if (depth === 0) return { end: "met", reason: "the character is in town" };
      if (supplyMargin(view) === null) return { end: "met", reason: "supplies are no longer short" };
      if (left) return { end: "abandoned", reason: "the character left the level" };
      return recallStuck(view);
    case "shop":
      if (left && facts.startDepth === 0) return { end: "abandoned", reason: "left town" };
      if (facts.terrain !== null && !shopsWanted(view, facts)) return { end: "met", reason: "no shop trip is wanted" };
      return null;
    case "try":
      if (!unknownInPack(view)) return { end: "met", reason: "no unknown item is in the pack" };
      if (left) return { end: "abandoned", reason: "the character left the level" };
      if (awake(view)) return { end: "failed", reason: "a creature is awake in view" };
      return null;
    case "position":
      if (!stronger(view)) return { end: "met", reason: "no creature in view is stronger than the character" };
      if (left) return { end: "abandoned", reason: "the character left the level" };
      return null;
  }
}

/** A number the near-term goal can show, or null when the code has none. */
export function nearProgress(kind: NearKind, view: AgentView, terrain: Terrain | null): string | null {
  const player = view.player();
  if (kind === "rest") {
    const hp = `${String(player.hp)} of ${String(player.maxHp)} hit points`;
    return player.maxSp > 0 ? `${hp}, ${String(player.sp)} of ${String(player.maxSp)} spell points` : hp;
  }
  if (kind === "explore" && terrain !== null) {
    const n = frontiers(view, terrain).length;
    return n === 1 ? "1 unexplored frontier" : `${String(n)} unexplored frontiers`;
  }
  return null;
}

/** One Choice over the near-term goals that are feasible now. */
export function nearGoalRequest(view: AgentView, candidates: readonly NearCandidate[], midLabel: string | null): SystemOneRequest {
  const player = view.player();
  const criteria: Record<string, string | null> = {};
  for (const item of candidates) criteria[item.kind] = `${item.label}. ${item.detail}`;
  criteria["none_of_these"] = NONE_OF_THESE;
  return {
    state: {
      rules: "A near-term goal is something the character can do right now. Pick one that can be finished on this visit.",
      character: `Level ${String(player.level)} ${player.race} ${player.cls}, on dungeon level ${String(player.depth)} (deepest reached ${String(player.maxDepth)}), ${String(player.hp)} of ${String(player.maxHp)} hit points, ${String(player.gold)} gold.`,
      ...(midLabel === null ? {} : { mid_goal: midLabel }),
    },
    questions: {
      near_goal: {
        type: "choice",
        instructions: "Which of these should the character do next?",
        criteria,
      },
    },
  };
}

/** The choice when it is one of the candidates; otherwise the first in the fixed order. */
export function pickNear(candidates: readonly NearCandidate[], answers: Readonly<Record<string, Answer>>): NearCandidate | null {
  if (candidates.length === 0) return null;
  const answer = answers["near_goal"];
  if (answer?.type === "choice" && answer.choice !== "none_of_these") {
    const found = candidates.find((item) => item.kind === answer.choice);
    if (found !== undefined) return found;
  }
  return [...candidates].sort((a, b) => NEAR_ORDER.indexOf(a.kind) - NEAR_ORDER.indexOf(b.kind))[0] ?? null;
}
