/**
 * The goal keeper. It chooses the long-term goal, ranks the aims as the
 * mid-term goal, and picks a near-term goal the character can do right now.
 *
 * A review happens on arrival at a new level, after a town trip, at a
 * character level-up, and every 2,000 game turns otherwise. A met aim, a
 * stocked aim whose item has sold out, and one whose shop memory has grown too
 * old to count on, review again at once. Code builds the
 * candidates; one Choice ranks the aims, and the fixed order stands in when
 * that request is not sent or does not come back. A review never stops
 * Squire: the tactical brain owns backing off and stopping.
 */

import type { AgentView } from "../host-adapter.js";
import type { AskResult, Backend } from "../brain/backend.js";
import type { Answer, ChoiceAnswer, SystemOneRequest } from "../brain/systemone.js";
import { chaosChoice, chaosNote, chaosTold, type ChaosMethod, type ChaosRecord, type ChaosSource } from "../brain/chaos.js";
import type { Tally } from "../brain/tally.js";
import type { RunEvent } from "../report/events.js";
import { candidateAims, FIXED_ORDER, inFixedOrder, wieldsMagicWeapon, type Aim, type AimKind } from "./aims.js";
import { stillInherited, withAvenge, withInherited, type InheritedAim } from "./heirs.js";
import type { Feeling } from "../learning/grudges.js";
import { createLevelPacing } from "./pacing.js";
import { createStoreMemory, LASTING_MEMORY, wareName, type StoreMemory } from "../town/memory.js";
import { UNKNOWN_HOME, type HomeStock } from "../town/home.js";
import type { Persona } from "../persona/persona.js";
import type { Terrain } from "../terrain.js";
import { leadPursuits, longDue, longGoalRequest, longProgress, pursuitFacts, pursuitsFor, type FamilyFacts, type LongStamp, type Pursuit, type PursuitKind } from "./pursuits.js";
import { judgmentsFor, purchaseOrder, townChance, type Judgments, type PurchaseKind } from "./judgment.js";
import { NEAR_ORDER, nearCandidates, nearEnded, nearGoalRequest, nearProgress, pickNear, type LeaveDanger, type NearFacts, type NearKind } from "./near.js";
import { goalSentence, outcomeSentence, type GoalEnd, type GoalLevel, type GoalOutcome } from "./outcomes.js";
import {
  blockFor, checkpointEvent, CHECKPOINT_ACTIONS, guardAims, meaningfulAction, nextCheck, NOTHING_USED, openAims, resumeEvent, REVISE_LEVEL_CAP, reviseGoalRequest,
  reviseThreshold, reviseYes, startWatch, usedBy, watchStep, type NextCheck, type ReviseBlock, type ReviseEvent, type ReviseWatch, type Used,
} from "./revise.js";

/** Game turns between reviews when nothing else prompts one. */
export const REVIEW_TURNS = 2000;

export type ReviewTrigger = "arrival" | "town" | "level" | "periodic" | "budget" | "stock" | "met" | "failed" | "lapsed" | "revised";

const TRIGGER_TEXT: Readonly<Record<ReviewTrigger, string>> = {
  arrival: "on reaching a new level",
  town: "after the town trip",
  level: "after gaining a level",
  periodic: "after 2,000 game turns",
  budget: "when the level's game-turn budget runs out",
  stock: "after looking in a shop",
  met: "because the aim was satisfied",
  failed: "after a stocked item sold out",
  lapsed: "after the character stopped trusting what it remembered of a shop",
  revised: "to replace the goal it gave up",
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

const NONE_OF_THESE = "None of the listed options suits this moment.";

/** The one request that ranks the candidates: a Choice over the aims. */
export function midGoalRequest(view: AgentView, aims: readonly Aim[], pursuits: readonly Pursuit[] = []): SystemOneRequest {
  const player = view.player();
  const criteria: Record<string, string | null> = {};
  for (const aim of aims) {
    criteria[aim.kind] = aim.stock === undefined
      ? aim.detail
      : `${aim.detail} I last saw this item ${String(Math.max(0, view.turn() - aim.stock.turn))} game turns ago. I should check the shop before counting on it.`;
  }
  criteria["none_of_these"] = NONE_OF_THESE;
  return {
    state: {
      rules: "An aim is something worth working toward over the next few dungeon levels. Dying early ends every aim, so a safe gain outranks a risky one. Rank the aims the way this character would, given the goals it holds.",
      character: `Level ${String(player.level)} ${player.race} ${player.cls}, on dungeon level ${String(player.depth)} (deepest reached ${String(player.maxDepth)}), ${String(player.hp)} of ${String(player.maxHp)} hit points, ${String(player.gold)} gold.`,
      ...(pursuits.length === 0 ? {} : pursuitFacts(pursuits)),
    },
    questions: {
      mid_goal: {
        type: "choice",
        instructions: "Which aim should this character work toward over the next few dungeon levels?",
        criteria,
      },
    },
  };
}

/** An aim's probability, discounted by how dim its shop memory is. */
function aimScore(aim: Aim, probs: Readonly<Record<string, number>>): number {
  return (probs[aim.kind] ?? 0) * (aim.stock?.confidence ?? 1);
}

/** Highest probability first. A dim shop memory discounts the probability, and equal scores keep the fixed order. */
export function rankByScore(aims: readonly Aim[], answers: Readonly<Record<string, Answer>>): Aim[] {
  const answer = answers["mid_goal"];
  const probs = answer?.type === "choice" ? answer.probabilities : {};
  return [...aims].sort((a, b) => aimScore(b, probs) - aimScore(a, probs) || FIXED_ORDER.indexOf(a.kind) - FIXED_ORDER.indexOf(b.kind));
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
  /** A seed fixed for the character's life, for its small per-character jitter on goal weights. */
  seed?(): string;
  readonly storeMemory?: readonly StoreMemory[];
  saveStoreMemory?(memory: readonly StoreMemory[]): void;
  /** The home's remembered stock, read live because a town trip updates it. */
  homeStock?(): HomeStock;
  saveHomeStock?(stock: HomeStock): void;
  rng?(): number;
  /** A goal that ended, for the run report. */
  record?(event: RunEvent): void;
  /** The panel shows the long-term goal only when this is on. The model sees it either way. */
  revealLongGoal?(): boolean;
  /** A Choice the model answered, for the training rows. */
  onAsked?(request: SystemOneRequest, answers: Readonly<Record<string, Answer>>): void;
  /** Whether Law to Chaos may draw the goals the model ranked. On unless it answers false, which keeps the top one. */
  chaos?(): boolean;
  /** How Law to Chaos draws: smooth sampling unless this names the bounded roll. */
  chaosMethod?(): ChaosMethod;
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
  /** The home's remembered stock, read live as a town trip updates it. */
  homeStock(): HomeStock;
  /** Persist the home's remembered stock. */
  saveHomeStock(stock: HomeStock): void;
  /** The current aims, best first. Empty until the first review. */
  ranked(): readonly Aim[];
  /** The long goals the persona holds now, most wanted first, with the chosen goal in the lead. */
  pursuits(): readonly Pursuit[];
  /** Why the persona chose to head home before the supply margin forced it, or null. */
  townCall(): string | null;
  /** The buying order the persona chose for this town visit, or null for the fixed order. */
  purchaseOrder(): readonly PurchaseKind[] | null;
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
  /** The long-term goal, for the model. Null until the first look. */
  longLine(): string | null;
  /** The mid-term goal, for the model. Null until the first review. */
  midLine(): string | null;
  /** The near-term goal, for the model and the panel. Null when none is feasible. */
  nearLine(): string | null;
  /** The kind of the near-term goal now held, or null. */
  nearKind(): NearKind | null;
  /** The last three goals that ended, newest first. */
  outcomeLines(): readonly string[];
  /** The panel line for the long-term goal. Off unless the player turned the switch on. */
  showLongGoal(): boolean;
  /** A command Squire gave. Ones that moved, fought, used or bought something count toward the periodic check. */
  acted(command: { readonly code: string; readonly args?: Readonly<Record<string, unknown>> }): void;
  /** The player played and then handed the game back to Squire. */
  resumed(): void;
  /** When the next check of the mid-term goal comes. Null until the first look. */
  nextCheck(): NextCheck | null;
}

/** Gold must grow by half again before another trip for an aim is offered. */
const TRIP_GOLD_GROWTH = 1.5;

interface Hold {
  readonly id: string;
  readonly label: string;
  readonly detail: string;
  readonly trigger: string;
  readonly turn: number;
  readonly depth: number;
  /** For a leave goal, what made the level one to leave. */
  readonly danger?: LeaveDanger;
  /** For an aim with a shop item, the item and the shop as remembered when the aim was taken. */
  readonly stock?: NonNullable<Aim["stock"]>;
  readonly shelf?: StoreMemory;
}

function choiceOf(answer: Answer | null): string | null {
  if (answer?.type !== "choice" || answer.choice === "none_of_these") return null;
  return answer.choice;
}

function longLog(trigger: string, label: string, by: string): string {
  return `Squire looked over its long-term goals ${trigger}: ${label}.${by}`;
}

function nearLog(trigger: string, label: string, by: string): string {
  return `Squire looked over what it can do right now ${trigger}: ${label}.${by}`;
}

/** What a check of the mid-term goal did, and what prompted it. */
function reviseLog(outcome: "drop" | "keep" | "stubborn", reason: string, label: string, why = ""): string {
  if (outcome === "drop") return `Squire gave up ${label} after ${reason}, and will pick a new mid-term goal.`;
  if (outcome === "stubborn") return `Squire kept ${label} after ${reason}. A less stubborn character would have dropped it.`;
  return `Squire stuck with ${label} after ${reason}${why === "" ? "" : `, because ${why}`}.`;
}

function midProgress(aim: Aim, view: AgentView): string | null {
  const player = view.player();
  if ((aim.kind === "depth" || aim.kind === "win" || aim.kind === "preparation") && aim.depth !== null) {
    return `dungeon level ${String(player.depth)} of ${String(aim.depth)}`;
  }
  if (aim.how === "save" && aim.price !== null) return `${String(player.gold)} of ${String(aim.price)} gold`;
  return null;
}

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
  /* The persona's own call to go home before the margin forces it, and its buying order for this town visit. */
  let townCall: string | null = null;
  let buying: readonly PurchaseKind[] | null = null;
  let terrain: Terrain | null = null;
  let lastView: AgentView | null = null;
  let longStamp: LongStamp | null = null;
  let longKind: PursuitKind | null = null;
  let longHold: Hold | null = null;
  /* Set while a long-term question is out, so no second one is sent before it answers. */
  let longAsking = false;
  let midHold: Hold | null = null;
  let nearHold: Hold | null = null;
  let failedKind: AimKind | null = null;
  let failedReason = "";
  const outcomeHistory: string[] = [];
  /* State for the revise-goal check: the watch from the last look, the action count since the last check, what was used up since the last look, and a pending hand-back. */
  let watch: ReviseWatch | null = null;
  let actions = 0;
  let used: Used = NOTHING_USED;
  let resumePending = false;
  /* Set while a revise question is out, so no second one is sent before it answers. */
  let reviseAsking = false;
  /* Goals the check dropped on each dungeon level this run, by level number, and the goals dropped recently enough to stay out of reach. */
  const revisions = new Map<number, number>();
  let blocks: ReviseBlock[] = [];
  /* Why the mid-term goal was just dropped, so the next look chooses again. */
  let dropped: string | null = null;

  /** Where a goal draw comes from, or null when there is no persona or chaos is switched off. */
  function chaosSource(): ChaosSource | null {
    const persona = deps.persona?.() ?? null;
    if (persona === null || deps.chaos?.() === false) return null;
    return { lawchaos: persona.sliders.lawchaos, method: deps.chaosMethod?.() ?? "sampling", rng: deps.rng ?? Math.random };
  }

  function chaosLog(level: string, record: ChaosRecord | null | undefined, label: (kind: string) => string): void {
    if (record === null || record === undefined || !chaosTold(record)) return;
    deps.log(record.pick === record.top
      ? `Law to Chaos kept ${label(record.top)} as the ${level} goal (${chaosNote(record)}).`
      : `Law to Chaos picked ${label(record.pick)} over ${label(record.top)} as the ${level} goal (${chaosNote(record)}).`);
  }

  /**
   * The aim to lead, drawn from the open aims by their scores, with the ranking's
   * top open aim as the top option. Null when there is nothing to draw from.
   */
  function drawAim(ranking: readonly Aim[], open: readonly Aim[], answer: ChoiceAnswer): ReturnType<typeof chaosChoice> {
    const kinds = new Set(open.map((aim) => aim.kind));
    const order = ranking.filter((aim) => kinds.has(aim.kind));
    const top = order[0];
    if (top === undefined) return null;
    const probabilities = Object.fromEntries(order.map((aim) => [aim.kind, aimScore(aim, answer.probabilities)]));
    return chaosChoice({ type: "choice", choice: top.kind, confidence: answer.confidence, probabilities }, order.map((aim) => aim.kind), chaosSource());
  }

  function guarded<T extends { readonly kind: string }>(list: readonly T[]): T[] {
    return guardAims(list, blocks, lastView?.turn() ?? 0);
  }

  function basePursuits(): Pursuit[] {
    return pursuitsFor(deps.persona?.() ?? null, deepest, deps.feelings?.() ?? [], deps.family?.() ?? null, deps.seed?.() ?? null);
  }

  function pursuitsNow(): Pursuit[] {
    return leadPursuits(basePursuits(), longKind);
  }

  function clear(): void {
    memory = null;
    pacing = createLevelPacing();
    aims = [];
    last = null;
    tripGold = null;
    deepest = 0;
    townCall = null;
    buying = null;
    generation += 1;
    answers = null;
    stockReview = false;
    terrain = null;
    lastView = null;
    longStamp = null;
    longKind = null;
    longHold = null;
    longAsking = false;
    midHold = null;
    nearHold = null;
    failedKind = null;
    failedReason = "";
    outcomeHistory.length = 0;
    watch = null;
    actions = 0;
    used = NOTHING_USED;
    resumePending = false;
    reviseAsking = false;
    revisions.clear();
    blocks = [];
    dropped = null;
  }

  function reset(): void {
    clear();
    inherited = [];
    shops.reset();
  }

  function push(level: GoalLevel, hold: Hold, end: GoalEnd, reason: string, turn: number, depth: number, reward: string | null): void {
    const outcome: GoalOutcome = {
      level, goal: hold.label, end, reason, held: Math.max(0, turn - hold.turn), startDepth: hold.depth, endDepth: depth, reward,
    };
    const text = outcomeSentence(outcome);
    outcomeHistory.push(text);
    deps.record?.({ kind: "goal", turn, depth, text });
  }

  function takeLong(pursuit: Pursuit, trigger: string, turn: number, depth: number): void {
    if (longHold !== null && longHold.id !== pursuit.kind) {
      push("long", longHold, "abandoned", trigger, turn, depth, null);
      longHold = null;
    }
    longKind = pursuit.kind;
    if (longHold !== null) {
      longHold = { ...longHold, label: pursuit.label, detail: pursuit.detail, trigger };
      return;
    }
    longHold = { id: pursuit.kind, label: pursuit.label, detail: pursuit.detail, trigger, turn, depth };
  }

  function factsFor(view: AgentView, startDepth: number, danger?: LeaveDanger): NearFacts {
    const home = deps.homeStock?.();
    return {
      terrain, persona: deps.persona?.() ?? null, aims, memories: shops.all(), startDepth,
      ...(home === undefined ? {} : { home }),
      ...(danger === undefined ? {} : { danger }),
    };
  }

  /** The aim held as the mid-term goal, with its shop item and shop as remembered now. */
  function midHoldFor(aim: Aim, trigger: string, turn: number, depth: number): Hold {
    const shelf = aim.stock === undefined ? undefined : shops.all().find((memory) => memory.feat === aim.stock?.feat);
    return {
      id: aim.kind, label: aim.label, detail: aim.detail, trigger, turn, depth,
      ...(aim.stock === undefined || shelf === undefined ? {} : { stock: aim.stock, shelf }),
    };
  }

  /**
   * Why a held aim with a shop item left the candidates without being
   * satisfied, or null when it was satisfied. The aim is built again with the
   * shop as remembered when it was taken: when it comes back, only the shop
   * memory dropped it.
   */
  function shopLapse(hold: Hold, view: AgentView): { readonly end: "failed" | "abandoned"; readonly reason: string } | null {
    const { stock, shelf } = hold;
    if (stock === undefined || shelf === undefined) return null;
    const memories = shops.all();
    const restored = [...memories.filter((memory) => memory.feat !== shelf.feat), { ...shelf, turn: view.turn(), lifetime: LASTING_MEMORY }];
    if (!candidateAims(view, restored, deps.persona?.() ?? null).some((aim) => aim.kind === hold.id)) return null;
    const now = memories.find((memory) => memory.feat === shelf.feat);
    const listed = now !== undefined && now.stock.some((item) => wareName(item.name) === wareName(stock.name));
    if (!listed) return { end: "failed", reason: `the shop sold out of ${stock.name}` };
    return { end: "abandoned", reason: `the memory of ${stock.name} in the shop grew too old to count on` };
  }

  function buildCandidates(view: AgentView): Aim[] {
    const own = candidateAims(view, shops.all(), deps.persona?.() ?? null);
    inherited = stillInherited(inherited, own, view.player().maxDepth, wieldsMagicWeapon(view));
    return withAvenge(withInherited(own, inherited), deps.feelings?.() ?? []);
  }

  async function ask(request: SystemOneRequest): Promise<{ readonly answer: Answer | null; readonly why: string; readonly backend: string }> {
    const backend = deps.backend();
    if (backend === null) return { answer: null, why: "no model server is set up", backend: "" };
    if (deps.tally.overCap(backend, deps.now()) !== null) return { answer: null, why: "the spend limit is reached", backend: backend.label };
    let result: AskResult;
    try {
      result = await deps.send(request);
    } catch {
      return { answer: null, why: "the request failed", backend: backend.label };
    }
    if (!result.ok) return { answer: null, why: `${backend.label} answered with ${result.failure.kind}`, backend: backend.label };
    deps.tally.record(backend, result.usage, deps.now());
    const key = Object.keys(request.questions)[0] ?? "";
    const answer = result.answers[key] ?? null;
    if (answer !== null) deps.onAsked?.(request, result.answers);
    return { answer, why: "", backend: backend.label };
  }

  /** Read the town answers in code: draw the trip home once, and set the buying order for this visit. */
  function judge(depth: number, judgments: Judgments): void {
    const persona = deps.persona?.() ?? null;
    const pursuits = pursuitsNow();
    const rng = deps.rng ?? Math.random;
    if (judgments.town !== null) {
      const chance = townChance(persona, pursuits, judgments.town.short);
      const go = rng() < chance;
      if (go) townCall = "a restock it chose before supplies ran low";
      deps.log(go ? "Squire turned back for town early to restock, though the pack was not yet low." : "Squire thought about a trip to town and stayed below; the pack can last a while yet.");
    }
    if (judgments.purchases.length > 1 && depth === 0) {
      buying = purchaseOrder(judgments.purchases, persona, pursuits, rng);
    }
  }

  async function keep(args: {
    readonly view: AgentView;
    readonly mine: number;
    readonly turn: number;
    readonly depth: number;
    readonly candidates: readonly Aim[];
    readonly midTrigger: ReviewTrigger | null;
    readonly judgments: Judgments;
    readonly pursuits: readonly Pursuit[];
    readonly longDue: { readonly trigger: string; readonly stamp: LongStamp } | null;
    readonly nearReason: string | null;
    readonly nearList: ReturnType<typeof nearCandidates>;
    readonly previousMid: string | null;
  }): Promise<void> {
    const ranks = args.midTrigger !== null || (args.nearReason !== null && args.nearList.length > 0);
    /* A keep that only asks the long-term goal does not supersede a ranking still in flight. */
    const seq = ranks ? ++latest : latest;
    if (args.midTrigger !== null) aims = guardAims(inFixedOrder(args.candidates), blocks, args.turn);
    if (args.longDue !== null) {
      let longSent: Awaited<ReturnType<typeof ask>>;
      try {
        longSent = await ask(longGoalRequest(args.view, args.pursuits));
      } finally {
        if (args.mine === generation) longAsking = false;
      }
      if (args.mine === generation) {
        longStamp = args.longDue.stamp;
        const drawn = longSent.why === "" ? chaosChoice(longSent.answer, args.pursuits.map((pursuit) => pursuit.kind), chaosSource()) : null;
        const picked = args.pursuits.find((pursuit) => pursuit.kind === (drawn?.pick ?? choiceOf(longSent.answer))) ?? args.pursuits[0];
        if (picked !== undefined) {
          takeLong(picked, args.longDue.trigger, args.turn, args.depth);
          const by = longSent.why === "" && choiceOf(longSent.answer) !== null
            ? ` ${longSent.backend} ranked them.`
            : ` It kept the heaviest one, because ${longSent.why === "" ? "none of the options was chosen" : longSent.why}.`;
          deps.log(longLog(args.longDue.trigger, picked.label, by));
          chaosLog("long-term", drawn?.record, (kind) => args.pursuits.find((pursuit) => pursuit.kind === kind)?.label ?? kind);
        }
      }
    }
    if (!ranks || args.mine !== generation) return;
    /* A goal a check dropped is not offered again for a while, unless nothing else is left. */
    const open = openAims(args.candidates, blocks, args.turn);
    const askAims = open.filter((aim) => aim.kind !== "win").length >= 2;
    const midSent = args.midTrigger !== null && askAims ? await ask(midGoalRequest(args.view, open, pursuitsNow())) : null;
    const midAnswer = midSent?.answer?.type === "choice" ? midSent.answer : null;
    const midModel = midSent !== null && midSent.why === "" && midAnswer !== null && midAnswer.choice !== "none_of_these";
    const scored = args.midTrigger === null ? args.candidates
      : guardAims(midModel && midAnswer !== null ? rankByScore(args.candidates, { mid_goal: midAnswer }) : inFixedOrder(args.candidates), blocks, args.turn);
    /* Law to Chaos may lead with another aim the model ranked; the rest keep their order. */
    const midDrawn = args.midTrigger !== null && midModel && midAnswer !== null ? drawAim(scored, open, midAnswer) : null;
    const lead = midDrawn === null || midDrawn.record === null ? undefined : scored.find((aim) => aim.kind === midDrawn.pick);
    const rankedPreview = lead === undefined ? scored : [lead, ...scored.filter((aim) => aim !== lead)];
    let nearReason = args.nearReason;
    const topKind = rankedPreview[0]?.kind ?? null;
    if (nearReason === null && args.midTrigger !== null && args.previousMid !== null && topKind !== null && topKind !== args.previousMid) {
      nearReason = "because the mid-term goal changed";
    }
    const midLabel = (args.midTrigger !== null ? rankedPreview[0]?.label : midHold?.label) ?? null;
    const nearSent = nearReason !== null && args.nearList.length > 0 ? await ask(nearGoalRequest(args.view, args.nearList, midLabel)) : null;
    if (args.mine !== generation || seq !== latest) return;
    if (args.midTrigger !== null && args.view.player().depth === args.depth) judge(args.depth, args.judgments);
    if (args.midTrigger !== null) {
      const source = midModel ? "model" : "fixed";
      const by = midSent === null || !askAims ? "" : midModel
        ? ` ${midSent.backend} ranked them.`
        : ` It kept the usual order, because ${midSent.why === "" ? "none of the options was chosen" : midSent.why}.`;
      answers = midModel && midAnswer !== null ? { mid_goal: midAnswer } : null;
      aims = rankedPreview;
      last = { trigger: args.midTrigger, turn: args.turn, source };
      const names = rankedPreview.map((aim) => aim.label).join(", ");
      deps.log(`Squire looked over its aims ${TRIGGER_TEXT[args.midTrigger]}: ${names === "" ? "none apply" : names}.${by}`);
      chaosLog("mid-term", midDrawn?.record, (kind) => scored.find((aim) => aim.kind === kind)?.label ?? kind);
      const top = rankedPreview[0];
      if (top !== undefined) {
        if (midHold !== null && midHold.id === top.kind) midHold = midHoldFor(top, TRIGGER_TEXT[args.midTrigger], midHold.turn, midHold.depth);
        else {
          if (midHold !== null) push("mid", midHold, "abandoned", TRIGGER_TEXT[args.midTrigger], args.turn, args.depth, null);
          midHold = midHoldFor(top, TRIGGER_TEXT[args.midTrigger], args.turn, args.depth);
        }
      }
    }
    if (nearSent !== null && nearReason !== null) {
      const drawn = nearSent.why === "" ? chaosChoice(nearSent.answer, args.nearList.map((item) => item.kind), chaosSource()) : null;
      const picked = args.nearList.find((item) => item.kind === drawn?.pick) ?? pickNear(args.nearList, nearSent.answer !== null ? { near_goal: nearSent.answer } : {});
      if (picked !== null) {
        const model = nearSent.why === "" && (drawn !== null || choiceOf(nearSent.answer) === picked.kind);
        const by = model
          ? ` ${nearSent.backend} ranked them.`
          : ` It kept the first one, because ${nearSent.why === "" ? "none of the options was chosen" : nearSent.why}.`;
        if (nearHold !== null && nearHold.id !== picked.kind) push("near", nearHold, "abandoned", nearReason, args.turn, args.depth, null);
        const danger = picked.danger === undefined ? {} : { danger: picked.danger };
        if (nearHold === null || nearHold.id !== picked.kind) nearHold = { id: picked.kind, label: picked.label, detail: picked.detail, trigger: nearReason, turn: args.turn, depth: args.depth, ...danger };
        else nearHold = { id: nearHold.id, label: picked.label, detail: picked.detail, trigger: nearReason, turn: nearHold.turn, depth: nearHold.depth, ...danger };
        deps.log(nearLog(nearReason, picked.label, by));
        chaosLog("near-term", drawn?.record, (kind) => args.nearList.find((item) => item.kind === kind)?.label ?? kind);
      }
    }
  }

  function midSentence(): string | null {
    if (midHold === null) return null;
    const aim = aims.find((item) => item.kind === midHold?.id);
    return goalSentence(aim?.label ?? midHold.label, aim !== undefined && lastView !== null ? midProgress(aim, lastView) : null, midHold.trigger);
  }

  function capped(depth: number): boolean {
    return (revisions.get(depth) ?? 0) >= REVISE_LEVEL_CAP;
  }

  /**
   * Ask the model whether to drop the mid-term goal, one question at a time.
   * A yes at or above the persona's threshold drops the goal, blocks it for
   * 2,000 game turns and makes the next look pick a new one. No answer changes
   * nothing. The action count goes back to zero only when the question is sent.
   */
  function reviseCheck(event: ReviseEvent, view: AgentView, candidates: readonly Aim[]): void {
    const held = midHold;
    if (held === null || reviseAsking || capped(view.player().depth)) return;
    if (!candidates.some((aim) => aim.kind !== held.id)) return;
    actions = 0;
    const others = openAims(candidates.filter((aim) => aim.kind !== held.id), blocks, view.turn());
    const mine = generation;
    const persona = deps.persona?.() ?? null;
    const request = reviseGoalRequest(view, midSentence() ?? held.label, event.reason, others.map((aim) => aim.label), pursuitsNow());
    reviseAsking = true;
    const run = (async () => {
      let sent: Awaited<ReturnType<typeof ask>>;
      try {
        sent = await ask(request);
      } finally {
        if (mine === generation) reviseAsking = false;
      }
      if (mine !== generation) return;
      const threshold = reviseThreshold(persona);
      const yes = reviseYes(sent.answer, threshold);
      if (yes === null) {
        deps.log(reviseLog("keep", event.reason, held.label, sent.why === "" ? "no answer came back" : sent.why));
        return;
      }
      if (!yes) {
        const leaned = sent.answer?.type === "noul" && sent.answer.p >= 0.5;
        deps.log(reviseLog(leaned ? "stubborn" : "keep", event.reason, held.label));
        return;
      }
      /* The goal asked about must still be the one held, and the level must still allow a drop. */
      const now = lastView ?? view;
      const depth = now.player().depth;
      if (midHold === null || midHold.id !== held.id || capped(depth)) return;
      const turn = now.turn();
      push("mid", midHold, "abandoned", event.reason, turn, depth, null);
      blocks = [...blocks.filter((block) => turn < block.until), blockFor(held.id, turn)];
      revisions.set(depth, (revisions.get(depth) ?? 0) + 1);
      midHold = null;
      dropped = event.reason;
      deps.log(reviseLog("drop", event.reason, held.label));
    })().catch((error: unknown) => {
      deps.log(`Squire could not check its mid-term goal: ${String(error)}`);
    });
    inFlight = Promise.all([inFlight, run]).then(() => undefined);
  }

  return {
    remember(view, terrainNow) {
      terrain = terrainNow;
      const seen = shops.observe(view, terrainNow, deps.persona?.() ?? null);
      if (!seen.changed) return;
      for (const aim of aims) {
        const stock = aim.stock;
        if (!seen.entered || stock === undefined || stock.feat !== seen.memory?.feat || seen.memory.stock.some((item) => wareName(item.name) === wareName(stock.name))) continue;
        const owned = [...view.inventory(), ...view.equipment().filter((item) => item !== null)].some((item) => wareName((item as { name?: string }).name ?? "") === wareName(stock.name));
        if (!owned) {
          deps.log(`I put coins aside for ${stock.name}. Now the shopkeeper has none. I should have come back sooner.`);
          if (midHold?.id === aim.kind) {
            failedKind = aim.kind;
            failedReason = `the shop sold out of ${stock.name}`;
          }
        }
      }
      const own = candidateAims(view, shops.all(), deps.persona?.() ?? null);
      const candidates = withAvenge(withInherited(own, inherited), deps.feelings?.() ?? []);
      aims = guarded(answers === null ? inFixedOrder(candidates) : rankByScore(candidates, answers));
      /* A reply based on an older shelf cannot restore a sold item. */
      latest += 1;
      stockReview = true;
    },
    shops: shops.all,
    homeStock: () => deps.homeStock?.() ?? UNKNOWN_HOME,
    saveHomeStock: (stock) => deps.saveHomeStock?.(stock),
    observe(view) {
      const player = view.player();
      if (player.dead) return;
      const turn = view.turn();
      if (memory !== null && turn < memory.reviewTurn) reset();
      lastView = view;
      if (aims.some((aim) => aim.stock !== undefined)) {
        const fresh = candidateAims(view, shops.all(), deps.persona?.() ?? null);
        const updated = aims.flatMap((aim) => aim.stock === undefined ? [aim] : fresh.filter((entry) => entry.kind === aim.kind));
        aims = guarded(answers === null ? inFixedOrder(updated) : rankByScore(updated, answers));
      }
      deepest = Math.max(deepest, player.maxDepth);
      if (player.depth === 0) townCall = null;
      else buying = null;
      const heldNear = nearHold;
      let nearEndText: string | null = null;
      if (heldNear !== null && (NEAR_ORDER as readonly string[]).includes(heldNear.id)) {
        const ended = nearEnded(heldNear.id as NearKind, view, factsFor(view, heldNear.depth, heldNear.danger));
        if (ended !== null) {
          push("near", heldNear, ended.end, ended.reason, turn, player.depth, null);
          nearHold = null;
          nearEndText = ended.end === "failed" ? "because the near-term goal failed" : ended.end === "abandoned" ? "because the near-term goal was abandoned" : "because the near-term goal was met";
        }
      }
      const budget = pacing.observe(view);
      const firstLook = memory === null;
      const scheduled = reviewDue(memory, { depth: player.depth, level: player.level, turn });
      const candidates = buildCandidates(view);
      let midTrigger: ReviewTrigger | null = scheduled ?? (stockReview ? "stock" : budget.review ? "budget" : null);
      const previousMid = midHold?.id ?? null;
      const heldMid = midHold;
      if (heldMid !== null && failedKind === heldMid.id) {
        push("mid", heldMid, "failed", failedReason === "" ? "the shop sold out" : failedReason, turn, player.depth, null);
        midHold = null;
        midTrigger = "failed";
      } else if (heldMid !== null && !candidates.some((aim) => aim.kind === heldMid.id)) {
        const lapse = shopLapse(heldMid, view);
        if (lapse === null) push("mid", heldMid, "met", "the aim was satisfied", turn, player.depth, heldMid.detail);
        else push("mid", heldMid, lapse.end, lapse.reason, turn, player.depth, null);
        midHold = null;
        midTrigger = lapse === null ? "met" : lapse.end === "failed" ? "failed" : "lapsed";
      }
      failedKind = null;
      failedReason = "";
      /* Look for revise triggers. A checkpoint stays due while it can't be asked: a question is out, no goal is held, or this level has had its two drops. */
      const step = watch === null ? null : watchStep(watch, view, used);
      used = NOTHING_USED;
      watch = step === null ? startWatch(view) : step.watch;
      const events: ReviseEvent[] = [...(step?.fired ?? [])];
      if (resumePending && step !== null) events.push(resumeEvent());
      resumePending = false;
      if (actions >= CHECKPOINT_ACTIONS) events.push(checkpointEvent());
      const event = events[0];
      if (event !== undefined) reviseCheck(event, view, candidates);
      const revised = dropped !== null;
      dropped = null;
      if (revised && midTrigger === null) midTrigger = "revised";
      const pursuits = basePursuits();
      const reached = Math.max(deepest, player.maxDepth);
      const heldLong = longHold;
      let longEnded: string | null = null;
      if (heldLong !== null && !longAsking && !pursuits.some((pursuit) => pursuit.kind === heldLong.id)) {
        const familyDeepest = deps.family?.()?.deepest ?? null;
        const met = heldLong.id === "record" && familyDeepest !== null && reached >= familyDeepest;
        push("long", heldLong, met ? "met" : "abandoned", met
          ? `the character reached dungeon level ${String(reached)}, past the family's deepest of ${String(familyDeepest)}`
          : "the goal stopped fitting this character", turn, player.depth, null);
        longHold = null;
        longKind = null;
        longEnded = met ? "after the long-term goal was met" : "after the old long-term goal stopped fitting";
      }
      const milestone = longAsking ? null : longDue(longStamp, player.level, reached);
      const due = longEnded === null ? milestone : { trigger: longEnded, stamp: milestone?.stamp ?? longStamp ?? { levels: [], depths: [] } };
      if (due !== null && pursuits.length < 2) {
        longStamp = due.stamp;
        const only = pursuits[0];
        if (only !== undefined) {
          takeLong(only, due.trigger, turn, player.depth);
          if (!firstLook) deps.log(longLog(due.trigger, only.label, " It kept the heaviest one, because only one long-term goal applies."));
        }
      }
      memory = { depth: player.depth, level: player.level, reviewTurn: midTrigger === null ? (memory?.reviewTurn ?? turn) : turn };
      if (midTrigger !== null) stockReview = false;
      if (scheduled === "town") tripGold = player.gold;
      const arrival = firstLook || scheduled === "arrival" || scheduled === "town";
      const nearList = nearCandidates(view, factsFor(view, player.depth));
      const reason = nearEndText ?? (arrival ? "on reaching a new level" : revised ? "because the mid-term goal was given up" : null);
      const longAsk = due !== null && pursuits.length >= 2;
      if (midTrigger === null && !longAsk && (reason === null || nearList.length === 0)) return;
      const judgments = judgmentsFor(view, deps.persona?.() ?? null, candidates, townCall === null, pursuitsNow());
      if (longAsk) longAsking = true;
      const kept = keep({
        view, mine: generation, turn, depth: player.depth, candidates, midTrigger, judgments, pursuits,
        longDue: longAsk && due !== null ? due : null,
        nearReason: nearList.length === 0 ? null : reason,
        nearList, previousMid,
      }).catch((error: unknown) => {
        deps.log(`Squire couldn't look over its aims: ${String(error)}`);
      });
      inFlight = Promise.all([inFlight, kept]).then(() => undefined);
    },
    ranked: () => aims,
    pursuits: pursuitsNow,
    townCall: () => townCall,
    purchaseOrder: () => buying,
    last: () => last,
    tripAllowed: (gold) => tripGold === null || gold >= tripGold * TRIP_GOLD_GROWTH,
    inherit(list) {
      inherited = list;
    },
    reset,
    settled: () => inFlight,
    longLine() {
      if (longHold === null) return null;
      const pursuit = pursuitsNow().find((item) => item.kind === longHold?.id);
      const family = deps.family?.() ?? null;
      return goalSentence(longHold.label, pursuit === undefined ? null : longProgress(pursuit.kind, deepest, family?.deepest ?? null), longHold.trigger);
    },
    midLine: midSentence,
    nearLine() {
      if (nearHold === null || lastView === null) return null;
      const kind = (NEAR_ORDER as readonly string[]).includes(nearHold.id) ? nearHold.id as NearKind : null;
      return goalSentence(nearHold.label, kind === null ? null : nearProgress(kind, lastView, terrain), nearHold.trigger);
    },
    nearKind() {
      if (nearHold === null) return null;
      return (NEAR_ORDER as readonly string[]).includes(nearHold.id) ? nearHold.id as NearKind : null;
    },
    outcomeLines: () => outcomeHistory.slice(-3).reverse(),
    showLongGoal: () => deps.revealLongGoal?.() === true,
    acted(command) {
      if (meaningfulAction(command)) actions += 1;
      if (lastView !== null) used = usedBy(lastView, command, used);
    },
    resumed() {
      resumePending = true;
    },
    nextCheck: () => lastView === null ? null : nextCheck(actions, Math.max(deepest, lastView.player().maxDepth), revisions.get(lastView.player().depth) ?? 0),
  };
}
