/**
 * When Squire reviews its aims, and how it ranks them.
 *
 * A review happens on arrival at a new level, after a town trip, at a
 * character level-up, and every 2,000 game turns otherwise. Code builds the
 * candidate aims (aims.ts); one Score request to the same server the tactical
 * planner uses ranks them, and a fixed order stands in when that request is not
 * sent or does not come back. A review never stops Squire: the tactical brain
 * owns backing off and stopping, and a review that fails only ranks by code.
 */

import type { AgentView } from "@rpgm-tools/neo-angband-core";
import type { AskResult, Backend } from "../brain/backend.js";
import type { Answer, ScoreQuestion, SystemOneRequest } from "../brain/systemone.js";
import type { Tally } from "../brain/tally.js";
import { candidateAims, FIXED_ORDER, inFixedOrder, wieldsMagicWeapon, type Aim } from "./aims.js";
import { stillInherited, withAvenge, withInherited, type InheritedAim } from "./heirs.js";
import type { Feeling } from "../learning/grudges.js";
import { createLevelPacing } from "./pacing.js";
import { createStoreMemory, wareName, type StoreMemory } from "../town/memory.js";
import type { Persona } from "../persona/persona.js";
import type { Terrain } from "../terrain.js";
import { pursuitFacts, pursuitsFor, type FamilyFacts, type Pursuit } from "./pursuits.js";

/** Game turns between reviews when nothing else prompts one. */
export const REVIEW_TURNS = 2000;

export type ReviewTrigger = "arrival" | "town" | "level" | "periodic" | "budget" | "stock";

const TRIGGER_TEXT: Readonly<Record<ReviewTrigger, string>> = {
  arrival: "on reaching a new level",
  town: "after the town trip",
  level: "after gaining a level",
  periodic: "after 2,000 game turns",
  budget: "when the level's game-turn budget runs out",
  stock: "after looking in a shop",
};

/** What the last look at the game showed, and when the last review ran. */
export interface ReviewMemory {
  readonly depth: number;
  readonly level: number;
  readonly reviewTurn: number;
}

export interface ReviewMoment {
  readonly depth: number;
  readonly level: number;
  readonly turn: number;
}

/** The reason to review now, or null. With no memory the first look is an arrival. */
export function reviewDue(memory: ReviewMemory | null, now: ReviewMoment): ReviewTrigger | null {
  if (memory === null) return "arrival";
  if (memory.depth === 0 && now.depth > 0) return "town";
  if (now.level > memory.level) return "level";
  if (now.depth !== memory.depth) return "arrival";
  if (now.turn - memory.reviewTurn >= REVIEW_TURNS) return "periodic";
  return null;
}

const WORTH: readonly string[] = [
  "not worth pursuing now",
  "worth pursuing later",
  "worth pursuing soon",
  "worth pursuing first",
];

/** The one request that ranks the candidates: a Score question for each aim. */
export function scoreRequest(view: AgentView, aims: readonly Aim[], pursuits: readonly Pursuit[] = []): SystemOneRequest {
  const player = view.player();
  const questions: Record<string, ScoreQuestion> = {};
  const described: Record<string, string> = {};
  for (const aim of aims) {
    questions[aim.kind] = {
      type: "score",
      instructions: `How worth pursuing right now is this aim: ${aim.label}? Judge it against the character's other aims and its chance of surviving.`,
      criteria: WORTH,
    };
    described[aim.kind] = aim.stock === undefined ? aim.detail : `${aim.detail} I last saw this item ${String(Math.max(0, view.turn() - aim.stock.turn))} game turns ago. I should check the shop before counting on it.`;
  }
  return {
    state: {
      rules: "An aim is something worth working toward over the next few dungeon levels. Dying early ends every aim, so a safe gain outranks a risky one. Rank the aims the way this character would, given the goals it holds.",
      character: `Level ${String(player.level)} ${player.race} ${player.cls}, on dungeon level ${String(player.depth)} (deepest reached ${String(player.maxDepth)}), ${String(player.hp)} of ${String(player.maxHp)} hit points, ${String(player.gold)} gold.`,
      aims: described,
      ...(pursuits.length === 0 ? {} : pursuitFacts(pursuits)),
    },
    questions,
  };
}

/** Highest score first; equal scores keep the fixed order. */
export function rankByScore(aims: readonly Aim[], answers: Readonly<Record<string, Answer>>): Aim[] {
  const scoreOf = (aim: Aim): number => {
    const answer = answers[aim.kind];
    return (answer?.type === "score" ? answer.score : 0) * (aim.stock?.confidence ?? 1);
  };
  return [...aims].sort((a, b) => scoreOf(b) - scoreOf(a) || FIXED_ORDER.indexOf(a.kind) - FIXED_ORDER.indexOf(b.kind));
}

export interface StrategyDeps {
  /** The server the tactical planner uses, or null when none is set up. */
  backend(): Backend | null;
  send(request: SystemOneRequest): Promise<AskResult>;
  readonly tally: Tally;
  now(): number;
  log(message: string): void;
  /** The heir's hatred and fear toward its ancestors' killers. Without it no avenge aim is offered. */
  feelings?(): readonly Feeling[];
  persona?(): Persona | null;
  /** What the family line knows that shapes an heir's goals. */
  family?(): FamilyFacts | null;
  readonly storeMemory?: readonly StoreMemory[];
  saveStoreMemory?(memory: readonly StoreMemory[]): void;
  rng?(): number;
}

export interface ReviewSummary {
  readonly trigger: ReviewTrigger;
  readonly turn: number;
  readonly source: "model" | "fixed";
}

export interface Strategy {
  /** Look at the game and start a review when one is due. Cheap when none is. */
  observe(view: AgentView): void;
  remember(view: AgentView, terrain: Terrain): void;
  shops(): readonly StoreMemory[];
  /** The current aims, best first. Empty until the first review. */
  ranked(): readonly Aim[];
  /** The long goals the persona holds now, most wanted first. */
  pursuits(): readonly Pursuit[];
  last(): ReviewSummary | null;
  /**
   * Whether a town trip for an affordable aim may be offered. After a trip the
   * same gold would only send Squire home again, so it takes more gold first.
   */
  tripAllowed(gold: number): boolean;
  /** Aims an heir inherits, folded into its first review and then spent. */
  inherit(aims: readonly InheritedAim[]): void;
  /** Forget everything, for a new character. */
  reset(): void;
  /** Resolves when no review is in flight. */
  settled(): Promise<void>;
}

/** Gold must grow by half again before another trip for an aim is offered. */
const TRIP_GOLD_GROWTH = 1.5;

export function createStrategy(deps: StrategyDeps): Strategy {
  let memory: ReviewMemory | null = null;
  let pacing = createLevelPacing();
  let aims: readonly Aim[] = [];
  let last: ReviewSummary | null = null;
  let tripGold: number | null = null;
  let generation = 0;
  let inherited: readonly InheritedAim[] = [];
  let latest = 0;
  let inFlight: Promise<void> = Promise.resolve();
  const shops = createStoreMemory(deps.storeMemory, deps.saveStoreMemory, deps.rng);
  let stockReview = false;
  let answers: Readonly<Record<string, Answer>> | null = null;
  let deepest = 0;

  function pursuitsNow(): Pursuit[] {
    return pursuitsFor(deps.persona?.() ?? null, deepest, deps.feelings?.() ?? [], deps.family?.() ?? null);
  }

  function clear(): void {
    memory = null;
    pacing = createLevelPacing();
    aims = [];
    last = null;
    tripGold = null;
    deepest = 0;
    generation += 1;
    answers = null;
    stockReview = false;
  }

  function reset(): void {
    clear();
    inherited = [];
    shops.reset();
  }

  async function rank(view: AgentView, candidates: readonly Aim[]): Promise<{ readonly ranked: Aim[]; readonly source: "model" | "fixed"; readonly by: string; readonly answers?: Readonly<Record<string, Answer>> }> {
    const fixed = inFixedOrder(candidates);
    /* The win is always a candidate, so it alone does not justify a model call. */
    if (candidates.filter((aim) => aim.kind !== "win").length < 2) return { ranked: fixed, source: "fixed", by: "" };
    const backend = deps.backend();
    if (backend === null) return { ranked: fixed, source: "fixed", by: " It kept the usual order, because no model server is set up." };
    const capped = deps.tally.overCap(backend, deps.now());
    if (capped !== null) return { ranked: fixed, source: "fixed", by: " It kept the usual order, because the spend limit is reached." };
    let result: AskResult;
    try {
      result = await deps.send(scoreRequest(view, candidates, pursuitsNow()));
    } catch {
      return { ranked: fixed, source: "fixed", by: " It kept the usual order, because the request failed." };
    }
    if (!result.ok) return { ranked: fixed, source: "fixed", by: ` It kept the usual order, because ${backend.label} answered with ${result.failure.kind}.` };
    deps.tally.record(backend, result.usage, deps.now());
    return { ranked: rankByScore(candidates, result.answers), source: "model", by: ` ${backend.label} ranked them.`, answers: result.answers };
  }

  async function review(view: AgentView, trigger: ReviewTrigger, turn: number, mine: number): Promise<void> {
    const seq = ++latest;
    const own = candidateAims(view, shops.all(), deps.persona?.() ?? null);
    inherited = stillInherited(inherited, own, view.player().maxDepth, wieldsMagicWeapon(view));
    const candidates = withAvenge(withInherited(own, inherited), deps.feelings?.() ?? []);
    aims = inFixedOrder(candidates);
    const done = await rank(view, candidates);
    /* A slow answer for an older review must not overwrite the aims of a newer one. */
    if (mine !== generation || seq !== latest) return;
    answers = done.answers ?? null;
    aims = done.ranked;
    last = { trigger, turn, source: done.source };
    const names = done.ranked.map((aim) => aim.label).join(", ");
    deps.log(`Squire looked over its aims ${TRIGGER_TEXT[trigger]}: ${names === "" ? "none apply" : names}.${done.by}`);
  }

  return {
    remember(view, terrain) {
      const seen = shops.observe(view, terrain, deps.persona?.() ?? null);
      if (!seen.changed) return;
      for (const aim of aims) {
        const stock = aim.stock;
        if (!seen.entered || stock === undefined || stock.feat !== seen.memory?.feat || seen.memory.stock.some((item) => wareName(item.name) === wareName(stock.name))) continue;
        const owned = [...view.inventory(), ...view.equipment().filter((item) => item !== null)].some((item) => wareName((item as { name?: string }).name ?? "") === wareName(stock.name));
        if (!owned) deps.log(`I put coins aside for ${stock.name}. Now the shopkeeper has none. I should have come back sooner.`);
      }
      const own = candidateAims(view, shops.all(), deps.persona?.() ?? null);
      const candidates = withAvenge(withInherited(own, inherited), deps.feelings?.() ?? []);
      aims = answers === null ? inFixedOrder(candidates) : rankByScore(candidates, answers);
      /* A reply based on an older shelf cannot restore a sold item. */
      latest += 1;
      stockReview = true;
    },
    shops: shops.all,
    observe(view) {
      const player = view.player();
      if (player.dead) return;
      const turn = view.turn();
      if (memory !== null && turn < memory.reviewTurn) reset();
      if (aims.some((aim) => aim.stock !== undefined)) {
        const fresh = candidateAims(view, shops.all(), deps.persona?.() ?? null);
        const updated = aims.flatMap((aim) => aim.stock === undefined ? [aim] : fresh.filter((entry) => entry.kind === aim.kind));
        aims = answers === null ? inFixedOrder(updated) : rankByScore(updated, answers);
      }
      deepest = Math.max(deepest, player.maxDepth);
      const budget = pacing.observe(view);
      const trigger = reviewDue(memory, { depth: player.depth, level: player.level, turn }) ?? (stockReview ? "stock" : budget.review ? "budget" : null);
      memory = { depth: player.depth, level: player.level, reviewTurn: trigger === null ? (memory?.reviewTurn ?? turn) : turn };
      if (trigger === null) return;
      stockReview = false;
      if (trigger === "town") tripGold = player.gold;
      inFlight = review(view, trigger, turn, generation).catch((error: unknown) => {
        deps.log(`Squire couldn't look over its aims: ${String(error)}`);
      });
    },
    ranked: () => aims,
    pursuits: pursuitsNow,
    last: () => last,
    tripAllowed: (gold) => tripGold === null || gold >= tripGold * TRIP_GOLD_GROWTH,
    inherit(list) {
      inherited = list;
    },
    reset,
    settled: () => inFlight,
  };
}
