/**
 * The tactical planner: code lists what the character can sensibly do right
 * now, the model picks one, and Squire's errand code and item commands carry it
 * out.
 *
 * Code works out the facts (how hurt the character is, what is awake in sight
 * and how dangerous it is, what the pack holds, which spells can be cast) and
 * offers only the options that apply. Each option carries a plain description
 * for the model, a rough death risk for the safety floor, and a builder for its
 * plan.
 *
 * Every plan runs under a watcher. A creature coming into view, hit points
 * crossing the retreat line, a status effect or a new level drops the plan, and
 * the model is asked again about the new situation.
 */

import type { AgentActions, AgentCommand, AgentView, MonsterView } from "@rpgm-tools/neo-angband-core";
import type { SquireContext } from "../context.js";
import type { Mission } from "../mission.js";
import { isStop } from "../mission.js";
import type { SquireCfg } from "../settings.js";
import type { Terrain } from "../terrain.js";
import { createWatcher, type Watcher } from "../disturb.js";
import { steps } from "../grid.js";
import { frontiers, hasFloorObject, isRoutable, knownDownStairs, knownStairs, standingOnHarm } from "../map.js";
import { flowFrom } from "../flow.js";
import { newProgress, type Progress } from "../progress.js";
import { awakeInSight, inSight, pickTarget } from "../threat.js";
import { retreatFrom, travelTo } from "../travel.js";
import { engineTravel } from "../travel-engine.js";
import { volleyAvailable, volleySteps, type RangedGoal } from "./volley.js";
import { AUTOFIGHT_REACH, autofight } from "../missions/autofight.js";
import { autoexplore } from "../missions/autoexplore.js";
import { campaign } from "../missions/campaign.js";
import type { Answer, ChoiceQuestion } from "./systemone.js";
import type { Choice, Plan, Planner, Question, Reflex } from "./brain.js";
import { canRead, detectionSource, hungry, readPack, studyable, type Pack } from "./pack.js";
import { gearCandidates } from "../gear/compare.js";
import type { Persona } from "../persona/persona.js";
import { applySafetyFloor, blend, jitteredStrength, pick as pickTop, riskCeiling } from "../persona/blend.js";
import { fleesFromNew, forget, mustPickUp, shiftThreat } from "../persona/quirks.js";
import { inCharacterInstructions, personaState } from "../persona/state.js";
import { lowOnSupplies, recallItem, RECALL_FROM_DEPTH, supplyNeeds } from "../town/needs.js";
import { neededEntrances, recallPlan, townTripPlan } from "../town/plan.js";
import { assessThreat, bestBallAim, clearShot, inspecting, pickAttackSpell, spellInfoOf, threatIndex, THREAT_BANDS, BAND_RISK, type ThreatBand } from "./threat-model.js";
export { threatIndex, roundEstimate, THREAT_BANDS } from "./threat-model.js";
export type { ThreatBand } from "./threat-model.js";
import type { Orders } from "../orders/book.js";
import { nudgeAims, steerOffers, type AimTag, type Steering } from "../strategy/steer.js";
import { holdDescent } from "../strategy/hold.js";
import type { Aim } from "../strategy/aims.js";
import { activationUse, breatherInSight, buffUse, deviceHealUse, resistUse, type CombatUse } from "./combat-kit.js";
import { rubbleDirection, trapDirection } from "./hazards.js";
import { floorTarget, junkInPack, packFull } from "./items.js";
import { arrivalFeeling, badLevelFeeling } from "./level-feel.js";

/** Every option this planner can offer. */
export type Goal =
  | "fight"
  | "shoot"
  | "throw_oil"
  | "aim_wand"
  | "cast_attack"
  | "heal"
  | "cast_heal"
  | "phase"
  | "teleport"
  | "retreat"
  | "rest"
  | "eat"
  | "pick_up"
  | "fetch"
  | "drop_junk"
  | "buff"
  | "resist"
  | "device"
  | "activate"
  | "disarm"
  | "tunnel"
  | "explore"
  | "descend"
  | "leave_level"
  | "study"
  | "wear"
  | "detect"
  | "recall_town"
  | "shop"
  | "recall_dungeon"
  | "wait";

const NONE_OF_THESE = "None of the listed options suits this moment.";

/** How many steps the fixed errand order runs when the model picks none of the options. */
const FALLBACK_STEPS = 8;

/** How many steps a retreat plan takes before the model is asked again. */
const RETREAT_STEPS = 4;

/** Farthest a creature may be for Squire to throw, fire or aim at it. */
const MISSILE_RANGE = 10;

/** A word for the character's hit points, which the model reads more reliably than a ratio. */
export function healthBand(hp: number, maxHp: number): string {
  if (maxHp <= 0) return "unknown";
  const share = hp / maxHp;
  if (share >= 0.9) return "full";
  if (share >= 0.6) return "lightly hurt";
  if (share >= 0.35) return "badly hurt";
  return "near death";
}

export function threatBand(monsterLevel: number, characterLevel: number): ThreatBand {
  return THREAT_BANDS[threatIndex({ level: monsterLevel, raceFlags: [] }, characterLevel)] ?? "deadly";
}

/** Gold below which a trip to town cannot buy enough healing to be worth a recall scroll. */
const RECALL_MIN_GOLD = 50;

/** Health share under which escapes are offered even against easy creatures. */
const ESCAPE_BELOW_HP = 0.7;

/** One blow of this share of maximum hit points, or twice it in all since the plan began, sends the decision back to the model. */
const DAMAGE_SHARE_REDECIDE = 0.1;
/** Cut timers above these are a bad cut and a nasty cut; a bad cut or worse does not close by itself. */
const BAD_CUT = 25;
const NASTY_CUT = 50;
/** Decisions an awake creature must stay on one grid to count as one that does not move. */
const STATIONARY_DECISIONS = 3;
/** Breeders of one kind in sight that make leaving the level worth offering. */
export const SWARM_LEAVE = 6;
/** The same, for a kind of breeder that has already killed or nearly killed one of the line. */
export const SWARM_LEAVE_DREADED = 3;
/** Commands in a row that pass no game time before an errand is given up as refused. */
const REFUSED_COMMANDS = 3;
/** Game turns (five player turns at normal speed) for which Squire repeats the model's last answer if nothing has changed. */
const SAME_SITUATION_TURNS = 50;
/** The most risk a lone option can carry for Squire to take it without asking, when there is no persona to set a ceiling. */
const FORCED_RISK = 0.3;
/** Upkeep Squire does on its own when nothing awake is in sight, first to last. */
const ROUTINE: readonly Goal[] = ["wear", "detect", "study", "rest", "wait"];
/** Goals that read a scroll or book or cast a spell. The game refuses these while the character is blind, confused or in the dark. */
const READS: ReadonlySet<Goal> = new Set<Goal>(["cast_attack", "cast_heal", "study", "detect", "recall_town", "recall_dungeon"]);
/** How long a refused goal stays out if nothing else changes, in game turns. After that it gets another try, in case the cause has passed. */
const REFUSAL_HOLD_TURNS = 200;
/** Plans for one goal that may start on the same game turn before the goal is left out until time passes. */
export const SAME_TURN_PLANS = 3;

/**
 * Rules of the game the model needs for this decision, in a few plain lines.
 * Only lasting strategy belongs here: recall, gear, study and detection are
 * offered by code that already knows when they apply.
 */
const HANDBOOK: readonly string[] = Object.freeze([
  "Killing creatures earns experience, and experience makes the character stronger.",
  "Going deeper too early is a common way to die, but waking a sleeping creature just to clear a level is not worth the risk; once a level has nothing safe left to do, the stairs are the way on.",
  "Resting with an awake creature in sight gets interrupted. When the character could die before its next useful action, getting away matters more than dealing damage.",
  "Healing potions are worth drinking before hit points get too low to survive one more round. Phase Door jumps a short random distance, Teleportation moves far across the same level, and Teleport Level leaves the level.",
  "Missiles, thrown oil, wands and attack spells hurt a creature before it can reach the character.",
  "A mage under level 10 dies fast in melee; Magic Missile or a flask of oil thrown from a few steps away kills most early creatures before they arrive.",
  "Worm masses, lice and giant white mice split in two every few turns, so a room of them grows faster than a level 5 character can kill it; taking the nearest stairs leaves every one of them behind.",
  "While the character is afraid, the game refuses every melee blow without using a turn, but arrows, spells and wands still hit.",
]);

/** One option offered to the model. */
export interface Offer {
  readonly goal: Goal;
  /** What the option does, as the model reads it. */
  readonly criteria: string;
  /** Rough chance, 0 to 1, that this choice leads to death soon. */
  readonly risk: number;
  /** Upkeep that is safe to do without asking the model. */
  readonly routine?: true;
  /** The ranked aim this offer serves, if any. */
  readonly aim?: AimTag;
}

/** How the persona bent one decision, kept for the decision log. */
export interface PersonaTrace {
  readonly best: Readonly<Record<string, number>>;
  readonly inCharacter: Readonly<Record<string, number>> | null;
  readonly blended: Readonly<Record<string, number>>;
  readonly strength: number;
  /** Options the safety floor took away. */
  readonly removed: readonly string[];
  /** What the best-move answer alone would have picked. */
  readonly advice: string;
  readonly pick: string;
  /** Set when a quirk decided instead of the model. */
  readonly quirk?: string;
}

/** The facts one decision is made from. */
export interface GoalDigest {
  readonly depth: number;
  readonly offers: readonly Offer[];
  /** Awake creatures that were not in sight at the previous decision. */
  readonly newCreatures: number;
  /** A short form of the situation, to recognise it at the next decision. */
  readonly situation?: string;
  /** Why Squire decided without the model, when it did. */
  readonly reflex?: string;
  /** Options a widened offer would add, for a re-ask when the model passes on every option in danger. */
  readonly missing?: readonly Goal[];
  /** Set on the re-ask itself, so a second pass on every option is not asked about again. */
  readonly widened?: true;
  /** Filled in by `choose`. */
  trace?: PersonaTrace;
}

export interface GoalPlannerOptions {
  readonly cfg: SquireCfg;
  /** The ranked aims and town-trip gate. Without it no aim steers anything. */
  readonly strategy?: () => Steering;
  /** The player's orders and standing instructions. Without it none weigh on a decision. */
  readonly orders?: Orders;
  readonly terrain: Terrain;
  readonly log: (message: string) => void;
  /**
   * The character's persona, or a getter for it so drift during a run reaches
   * the next decision. Without one, Squire asks only for the best move.
   */
  readonly persona?: Persona | null | (() => Persona | null);
  /** Lesson lines relevant to this moment, from the character and its ancestors. */
  readonly lessons?: (view: AgentView) => readonly string[];
  /** Kinds of creature that killed or nearly killed one of this character's line. */
  readonly dreaded?: () => ReadonlySet<string>;
  /** Rescale the best-move answer from past outcomes. Never applied to the in-character answer. */
  readonly calibrate?: (probs: Readonly<Record<string, number>>) => Record<string, number>;
  /** Random draws for persona volatility and quirks. */
  readonly rng?: () => number;
  /** Most tokens of persona backstory one decision may carry, from the backend's budget. */
  readonly backstoryTokens?: number;
  /** Whether to skip the model for forced, routine and unchanged moments. On unless set to false. */
  readonly reflex?: boolean;
}

/** A plan that owns a watcher, so `trigger` can ask it. */
interface WatchedPlan extends Plan {
  readonly watcher: Watcher;
}

interface Situation {
  readonly view: AgentView;
  readonly pack: Pack;
  readonly awake: readonly MonsterView[];
  readonly target: MonsterView | null;
  /** The worst awake threat band in sight, or -1 when nothing awake is in sight. */
  readonly worst: number;
  /** Kinds of creature this character's line has learned to fear. */
  readonly dreaded: ReadonlySet<string>;
  /** Awake creatures that have stayed on one grid across several decisions. */
  readonly stationary: ReadonlySet<number>;
  /** The biggest group of one kind of breeder in sight, or null when there is none. */
  readonly swarm: { readonly race: string; readonly count: number } | null;
  /** Whether that group is big enough to leave the level over. */
  readonly swarming: boolean;
  readonly hpShare: number;
}

/** The biggest group of one kind of breeding creature in sight. */
export function swarmOf(monsters: readonly MonsterView[]): { race: string; count: number } | null {
  const counts = new Map<string, number>();
  for (const m of monsters) {
    if (m.visible && m.raceFlags.includes("MULTIPLY")) counts.set(m.race, (counts.get(m.race) ?? 0) + 1);
  }
  let best: { race: string; count: number } | null = null;
  for (const [race, count] of counts) if (best === null || count > best.count) best = { race, count };
  return best;
}

function situationOf(view: AgentView, dreaded: ReadonlySet<string> = new Set(), stationary: ReadonlySet<number> = new Set()): Situation {
  const player = view.player();
  const monsters = view.monsters();
  const awake = awakeInSight(monsters);
  const target = pickTarget(monsters, player.grid, { wakeSleepers: true, reach: AUTOFIGHT_REACH });
  const worst = awake.reduce((max, m) => Math.max(max, assessThreat(m, player, awake, view, dreaded).band), -1);
  const swarm = swarmOf(monsters);
  return {
    dreaded,
    stationary,
    swarm,
    swarming: swarm !== null && swarm.count >= (dreaded.has(swarm.race) ? SWARM_LEAVE_DREADED : SWARM_LEAVE),
    view,
    pack: readPack(view),
    awake,
    target,
    worst,
    hpShare: player.maxHp > 0 ? player.hp / player.maxHp : 1,
  };
}

function clamp01(n: number): number {
  return Math.max(0, Math.min(1, n));
}

/** The death risk of standing in a fight at the current health. */
/**
 * More awake creatures close by means more attacks for every action the
 * character takes. Each one within five steps past the first adds a fifth, up
 * to nearly double.
 */
export interface CreatureLine {
  readonly race: string;
  readonly band: string;
  readonly capability?: string;
  readonly away: number;
  readonly tags: string;
}

/**
 * Fold creatures of one kind, threat and state into one entry with a count and
 * the nearest distance, so a room of 27 worm masses reads as one line.
 */
export function groupLines(lines: readonly CreatureLine[]): string {
  const groups = new Map<string, CreatureLine[]>();
  for (const line of lines) {
    const key = `${line.race}|${line.capability ?? ""}|${line.band}|${line.tags}`;
    groups.set(key, [...(groups.get(key) ?? []), line]);
  }
  return [...groups.values()].map((group) => {
    const first = group[0]!;
    const nearest = Math.min(...group.map((g) => g.away));
    const tags = first.tags === "" ? "" : `, ${first.tags}`;
    const rating = first.capability === undefined ? first.band : `${first.capability}, ${first.band}`;
    return group.length === 1
      ? `${first.race}: ${rating}, ${String(nearest)} steps away${tags}`
      : `${String(group.length)} ${first.race}: ${rating} each, the nearest ${String(nearest)} steps away${tags}`;
  }).join("; ");
}

function crowd(s: Situation): number {
  const at = s.view.player().grid;
  const near = s.awake.filter((m) => steps(at, m.grid) <= 5).length;
  return Math.min(1.8, 1 + 0.2 * Math.max(0, near - 1));
}

/**
 * Poison and bleeding cost hit points every turn with no creature near, so the
 * model is told the damage is not a new attack.
 */
function statusOf(view: AgentView, readable: boolean): string {
  const p = view.player();
  const s = p.status;
  /* Each effect is named with what it stops or costs, since the model knows
   * nothing of the game beyond what it is told. */
  const lines = [
    s.paralyzed > 0 ? "Paralyzed, so it cannot act until this wears off." : "",
    s.afraid > 0 ? "Afraid, so it cannot attack in melee, though it can still shoot, throw and cast." : "",
    s.confused > 0 ? "Confused, so it cannot read scrolls or cast spells, and a step may go in a random direction." : "",
    s.blind > 0 ? "Blind, so it cannot read scrolls, cast spells or see monsters." : "",
    !readable && s.blind === 0 && s.confused === 0 ? "Too dark here to read scrolls or cast spells." : "",
    s.stun > 0 ? "Stunned, so its attacks miss more often and its spells fail more often." : "",
    s.poisoned > 0 ? "Poisoned, losing a few hit points each turn." : "",
    s.cut > 0 ? "Bleeding, losing hit points each turn until the cut heals or is cured." : "",
    p.speed < 110 ? "Slowed, so monsters get more turns than it does." : "",
    p.speed > 110 ? "Hasted, so it gets more turns than monsters of normal speed." : "",
  ].filter((line) => line !== "");
  return lines.length === 0 ? "No status effects." : lines.join(" ");
}

/**
 * Three or more of one kind in sight is how breeders look: worm masses, lice,
 * giant white mice. Killing them one by one can go on forever while more
 * arrive, and leaving the level ends it.
 */
function swarmNote(seen: readonly { readonly race: string }[]): { swarm?: string } {
  const counts = new Map<string, number>();
  for (const m of seen) counts.set(m.race, (counts.get(m.race) ?? 0) + 1);
  const many = [...counts].filter(([, n]) => n >= 3).map(([race, n]) => `${String(n)} ${race}`);
  return many.length === 0 ? {} : { swarm: `${many.join(" and ")} in sight. More of one kind can keep coming, so fighting them all may not end; leaving the level does.` };
}

/** The death risk of a fight: the worst awake creature in sight, not only the one being hit. */
function fightRisk(s: Situation): number {
  const target = s.target === null ? 0 : assessThreat(s.target, s.view.player(), s.awake, s.view, s.dreaded).band;
  const band = Math.max(target, s.worst);
  /* A fight with a swarm does not end: each kill makes room for more. */
  return clamp01((BAND_RISK[band] ?? 0.75) * (0.6 + (1 - s.hpShare) * 1.4) * crowd(s) * (s.swarming ? 1.5 : 1));
}

/**
 * The death risk of doing something other than fighting while threats stay
 * near. A dangerous creature is a risk at full health too: hit points change how
 * big the risk is, not whether there is one. A distant creature matters less.
 */
function exposure(s: Situation): number {
  if (s.worst < 0) return 0.01;
  const at = s.view.player().grid;
  const nearest = s.awake.reduce((min, m) => Math.min(min, steps(at, m.grid)), Infinity);
  const proximity = nearest <= 2 ? 1 : nearest <= 5 ? 0.8 : 0.55;
  return clamp01((BAND_RISK[s.worst] ?? 0.75) * (0.6 + (1 - s.hpShare) * 1.2) * proximity * crowd(s));
}

function within(s: Situation, range: number): boolean {
  return s.target !== null && steps(s.view.player().grid, s.target.grid) <= range;
}

/**
 * Whether any unexplored ground can be walked to over remembered ground, as the
 * exploring errand would. Frontiers behind lava or walls are not worth offering:
 * in town that made Squire pick explore again and again for nothing.
 */
/** Whether a grid can be walked next to over remembered ground. */
function canReach(view: AgentView, terrain: Terrain, grid: { readonly x: number; readonly y: number }): boolean {
  const field = flowFrom({ goals: [grid], canEnter: (g) => (g.x === grid.x && g.y === grid.y) || isRoutable(view, terrain, g) });
  return Number.isFinite(field.distance(view.player().grid));
}

/** Whether a remembered down staircase can be walked to, as the descend plan would. */
function reachableStairs(view: AgentView, terrain: Terrain): boolean {
  const stairs = knownDownStairs(view, terrain);
  if (stairs.length === 0) return false;
  const me = view.player().grid;
  if (stairs.some((g) => g.x === me.x && g.y === me.y)) return true;
  const field = flowFrom({ goals: stairs, canEnter: (grid) => isRoutable(view, terrain, grid) });
  return Number.isFinite(field.distance(me));
}

/** Whether any remembered staircase, up or down, can be walked to. */
function reachableAnyStairs(view: AgentView, terrain: Terrain): boolean {
  const stairs = knownStairs(view, terrain);
  if (stairs.length === 0) return false;
  const me = view.player().grid;
  if (stairs.some((g) => g.x === me.x && g.y === me.y)) return true;
  const field = flowFrom({ goals: stairs, canEnter: (grid) => isRoutable(view, terrain, grid) });
  return Number.isFinite(field.distance(me));
}

/**
 * Which stairs a retreat may take. In town the only staircase leads down into
 * the dungeon, which is no escape, so a retreat there only steps away. Below,
 * any staircase will do when the danger is pressing; otherwise only a down
 * staircase, because backing up the stairs from the first level at good health
 * is a trip to town and back that never gets deeper.
 */
function retreatStairs(s: Situation, terrain: Terrain, widen: boolean): "any" | "down" | "none" {
  const player = s.view.player();
  if (player.depth === 0) return "none";
  const pressing = widen || s.worst >= 2 || s.hpShare < ESCAPE_BELOW_HP || player.status.afraid > 0;
  if (pressing) return reachableAnyStairs(s.view, terrain) ? "any" : "none";
  return reachableStairs(s.view, terrain) ? "down" : "none";
}

function reachableFrontier(view: AgentView, terrain: Terrain): boolean {
  const goals = frontiers(view, terrain);
  if (goals.length === 0) return false;
  const me = view.player().grid;
  if (goals.some((g) => g.x === me.x && g.y === me.y)) return true;
  const field = flowFrom({ goals, canEnter: (grid) => isRoutable(view, terrain, grid) });
  return Number.isFinite(field.distance(view.player().grid));
}

/** The options that apply right now, each with its description and risk. */
/** Game turns to wait for a recall to fire before trusting it failed: the delay is 15 to 34 player turns of 10 game turns each. */
export const RECALL_WAIT_TURNS = 400;

export interface RecallRead {
  readonly turn: number;
  readonly depth: number;
}

/**
 * Whether a Word of Recall is under way. Newer games report the turns left on
 * the player view; on older ones Squire goes by its own last reading, which
 * stops counting once the depth changes or the wait has run out.
 */
export function recallPending(player: object, read: RecallRead | null, turn: number): boolean {
  const reported = (player as { recall?: unknown }).recall;
  if (typeof reported === "number") return reported > 0;
  const depth = (player as { depth?: unknown }).depth;
  return read !== null && read.depth === depth && turn - read.turn >= 0 && turn - read.turn <= RECALL_WAIT_TURNS;
}

export function offersFor(s: Situation, cfg: SquireCfg, terrain: Terrain, persona: Persona | null = null, visited: ReadonlySet<number> = new Set(), triedStudies: ReadonlySet<string> = new Set(), newLevel = false, recallActive = false, widen = false, saving = false, rememberedFeeling: string | null = null, aims: readonly Aim[] = []): Offer[] {
  const view = s.view;
  const player = view.player();
  const at = player.grid;
  const hurt = player.hp < player.maxHp;
  const out: Offer[] = [];
  const add = (goal: Goal, criteria: string, risk: number, routine = false) => out.push({ goal, criteria, risk: clamp01(risk), ...(routine ? { routine: true as const } : {}) });
  /* A level is left once, however many reasons there are to leave it. */
  const addLeave = (criteria: string, risk: number) => { if (!out.some((o) => o.goal === "leave_level")) add("leave_level", criteria, risk); };

  const needs = supplyNeeds(view, s.pack, persona);
  /* A recall scroll cannot be read while blind or confused. */
  const recall = canRead(view) ? recallItem(view) : null;
  const townRisk = s.awake.some((m) => steps(at, m.grid) <= 3) ? Math.max(0.02, BAND_RISK[s.worst] ?? 0.75) : 0.02;
  /* A trip home pays only when the shops can fix it: near the surface, or with
   * no gold, a recall scroll is spent for nothing and the next trip down finds
   * the same shortage. Starving with no food is the exception, since food is cheap. */
  const starving = needs.some((n) => n.kind === "food" && n.have === 0 && n.hungry === true);
  /* With no healing and no escape left at all, even a shallow trip home pays. */
  const defenceless = s.pack.heal.length === 0 && s.pack.phase.length === 0 && s.pack.teleport.length === 0 && s.pack.escapeSpell.length === 0;
  const tripPays = starving || (player.gold >= RECALL_MIN_GOLD && (player.depth >= RECALL_FROM_DEPTH || defenceless));
  if (recallActive) {
    add("wait", "Wait a turn for the Word of Recall already read to take effect.", exposure(s) * 0.8, s.awake.length === 0);
  }
  /* A second reading cancels a recall already under way, so none is offered while one is pending. */
  if (!recallActive && player.depth > 0 && recall !== null && lowOnSupplies(needs) && tripPays) {
    const low = needs.filter((n) => n.kind !== "recall" && n.have < (n.kind === "healing" ? 2 : n.kind === "phase" ? 1 : n.hungry ? 1 : 0));
    add("recall_town", `Read Word of Recall to return to town and restock. The character is low on ${low.map((n) => n.name).join(", ")}.`, townRisk);
  }
  if (player.depth === 0) {
    const shops = neededEntrances(view, terrain, persona, visited, aims);
    if (shops.length > 0) {
      const missing = needs.filter((n) => n.have < n.want).map((n) => n.name);
      add("shop", `Visit the shops for ${missing.join(", ") || "surplus gear sales"}.`, townRisk);
    } else if (!recallActive && recall !== null && player.maxDepth > 1) {
      add("recall_dungeon", `Read Word of Recall to return to the deepest level reached, ${String(player.maxDepth * 50)} ft.`, townRisk);
    }
  }

  if (s.target !== null) {
    /* Walking up to a creature that stays where it is, a mold or a mushroom
     * patch, only trades blows with something that would never have followed. */
    const adjacent = steps(at, s.target.grid) <= 1;
    const walkUp = !adjacent && !s.stationary.has(s.target.id) && canReach(view, terrain, s.target.grid);
    /* The game refuses every blow from an afraid character without spending a turn. */
    if ((adjacent || walkUp) && player.status.afraid === 0) {
      const away = steps(at, s.target.grid);
      add("fight", adjacent
        ? `Fight the ${s.target.race} in melee until it dies or something changes.`
        : `Walk ${String(away)} steps to the ${s.target.race}${s.target.asleep ? ", waking it," : ""} and fight it in melee; it can strike first while the character closes in.`, fightRisk(s));
    }
    const ranged = within(s, MISSILE_RANGE);
    const clear = clearShot(view, s.target);
    /* A ranged attack keeps the character where it stands, so it is never safer
     * than standing there: rating it lower once had Squire cast at an adjacent
     * deadly creature when the model and the persona both said to retreat. */
    const standing = exposure(s);
    if (ranged && clear && s.pack.launcher && s.pack.ammo[0] !== undefined) {
      add("shoot", `Fire at the ${s.target.race} with the equipped launcher (carrying ${s.pack.ammo[0].name}).`, Math.max(fightRisk(s) * 0.7, standing));
    }
    if (ranged && clear && s.pack.oil[0] !== undefined) {
      add("throw_oil", `Throw a flask of oil at the ${s.target.race}; it burns for good damage early in the game (carrying ${s.pack.oil[0].name}).`, Math.max(fightRisk(s) * 0.7, standing));
    }
    if (ranged && clear && s.pack.attackWand[0] !== undefined) {
      add("aim_wand", `Aim ${s.pack.attackWand[0].name} at the ${s.target.race}.`, Math.max(fightRisk(s) * 0.65, standing));
    }
    const spell = pickAttackSpell(s.pack.attackSpell, spellInfoOf(view));
    if (ranged && spell !== undefined && (clear || /(?:ball|orb|cloud|storm)/i.test(spell.name) && bestBallAim(view, s.awake, s.target) !== null)) {
      add("cast_attack", `Cast ${spell.name} at the ${s.target.race}: it costs ${String(spell.mana)} of the ${String(player.sp)} mana left (${String(spell.fail)}% chance to fail).`, Math.max(fightRisk(s) * 0.65, standing));
    }
  }
  /* A bad cut does not close by itself, and a character bleeding out dies of it
   * with no creature near. A healing potion closes it, so drinking one is
   * offered whenever the cut is bad, and a worse one puts everything that
   * spends turns on something else on hold. */
  const cutBad = player.status.cut > BAD_CUT && s.pack.heal[0] !== undefined;
  const bleeding = player.status.cut > NASTY_CUT && s.pack.heal[0] !== undefined;
  if ((hurt || cutBad) && s.pack.heal[0] !== undefined) {
    add("heal", `Drink ${s.pack.heal[0].name} to restore hit points.${cutBad ? " It also closes the bleeding wound." : ""}`, exposure(s) * (cutBad ? 0.2 : 0.5));
  }
  const healSpell = s.pack.healSpell[0];
  if (hurt && healSpell !== undefined) {
    add("cast_heal", `Cast ${healSpell.name} to restore hit points (${String(healSpell.fail)}% chance to fail).`, exposure(s) * 0.6);
  }
  /* Leaving goes down when it can, since going up from the first level is a trip to town and back. */
  const leaveBy = reachableStairs(view, terrain) ? "Walk to a known down staircase and take it" : "Walk to the nearest staircase, up or down, and take it";
  /* Breeders are easy one at a time, so the escapes below would not be offered
   * for them; leaving is offered for their numbers instead. */
  if (widen && !(s.swarming && s.swarm !== null) && s.awake.length > 0 && player.depth > 0 && reachableAnyStairs(view, terrain)) {
    addLeave(`${leaveBy} to leave every creature on this level behind.`, exposure(s) * 0.4);
  }
  if (s.swarming && s.swarm !== null && player.depth > 0 && reachableAnyStairs(view, terrain)) {
    addLeave(`${leaveBy}. ${String(s.swarm.count)} ${s.swarm.race} are in sight and breed faster than they die; a new level leaves them behind.`, exposure(s) * 0.3);
  }
  /* A caster out of mana cannot kill a breeder at range, and meleeing one only
   * makes more of them. Leaving the level is the way out. */
  const outOfMana = player.maxSp > 0 && player.sp === 0;
  if (outOfMana && s.swarm !== null && player.depth > 0 && reachableAnyStairs(view, terrain)) {
    addLeave(`The character is out of mana and ${s.swarm.race} breeds; walk to the stairs and leave rather than melee it.`, exposure(s) * 0.3);
  }
  /* The game's own level feeling says when a floor is dangerous or picked
   * clean; either way there is nothing worth staying for. */
  const feeling = rememberedFeeling ?? badLevelFeeling(view.messages());
  if (feeling !== null && player.depth > 0 && reachableAnyStairs(view, terrain)) {
    addLeave(`Leave the level: the game says "${feeling}"`, exposure(s) * 0.3);
  }
  /* A floor walked out with no way down found has nothing left to stay for, and a new level by any staircase has its own way down. */
  if (player.depth > 0 && s.awake.length === 0 && !reachableFrontier(view, terrain) && !reachableStairs(view, terrain) && reachableAnyStairs(view, terrain)) {
    addLeave("Take the nearest staircase to a new level: nothing unexplored can be reached here and no way down is known.", exposure(s) + 0.02);
  }
  /* Backing off from an easy creature at good health only costs turns, and
   * offering it made a timid persona walk away from every mouse. */
  /* An afraid character cannot fight back, so getting away is worth offering even from an easy creature. */
  /* A widened offer, made after the model passed on every option in danger, adds the escapes even against easy creatures. */
  if (s.awake.length > 0 && (widen || s.worst >= 1 || s.hpShare < ESCAPE_BELOW_HP || player.status.afraid > 0)) {
    if (s.pack.phase[0] !== undefined || s.pack.escapeSpell[0] !== undefined) {
      const how = s.pack.phase[0]?.name ?? s.pack.escapeSpell[0]?.name ?? "";
      add("phase", `Use ${how}: a short random teleport that breaks contact for a moment.`, exposure(s) * 0.4);
    }
    if (s.pack.teleport[0] !== undefined) {
      const teleport = s.pack.teleport[0];
      /* Teleport Level leaves the floor, up or down, which is a bigger step than moving across it. */
      const leaves = /Teleport Level/i.test(teleport.name);
      add("teleport", leaves
        ? `Use ${teleport.name} to leave this level entirely, going one level up or down.`
        : `Use ${teleport.name} to escape far from every creature in sight.`, exposure(s) * (leaves ? 0.3 : 0.2));
    }
    const flight = retreatStairs(s, terrain, widen);
    add("retreat", flight === "any"
      ? "Head for the nearest known staircase and take it, leaving the awake creatures behind."
      : flight === "down"
        ? "Head for a known down staircase and take it, leaving the awake creatures behind."
        : "Step up to four steps away from the awake creatures in sight; one standing next to the character may still strike as it leaves.", exposure(s) * 0.8);
  }
  if (!bleeding && s.awake.length === 0 && (hurt || player.sp < player.maxSp)) {
    /* Resting passes the turns a pending recall needs as well as waiting does, and heals besides. */
    add("rest", "Rest until hit points and mana recover.", 0.01, recallActive);
  }
  if (hungry(view) && s.pack.food[0] !== undefined) {
    add("eat", `Eat ${s.pack.food[0].name}; the character is hungry.`, exposure(s));
  }
  const gear = gearCandidates(view).find((g) => !g.unknown || (persona?.sliders.curiosity ?? 0) >= 50);
  /* Walking in the dark shows nothing, so while a light sits unused in the pack
   * lighting it comes before exploring or the stairs. */
  const unlit = gear !== undefined && gear.criteria.includes("has no light");
  if (!bleeding && gear !== undefined && (unlit || !s.awake.some((m) => steps(at, m.grid) <= 3))) {
    /* Changing gear spends a turn, which is as risky as any other turn not spent fighting. */
    add("wear", gear.criteria, Math.max(gear.unknown ? 0.05 : 0.02, exposure(s)), !gear.unknown && s.awake.length === 0);
  }
  if (!bleeding && newLevel && player.depth > 0 && s.awake.length === 0) {
    const source = detectionSource(view);
    if (source !== null) add("detect", `${source.kind === "cast" ? "Cast" : source.kind === "zap" ? "Zap" : "Read"} ${source.name} to survey this new level.`, 0.02, true);
  }
  const study = studyable(view, triedStudies);
  /* Only a creature close enough to strike this turn makes a turn of study unsafe. */
  /* A new spell costs one turn and is always worth having, so with nothing awake
   * in sight it comes before walking on, the way lighting a torch does. */
  const learnFirst = study !== null && s.awake.length === 0;
  if (!bleeding && study !== null && !s.awake.some((m) => steps(at, m.grid) <= 2)) {
    add("study", `Learn the spell ${study.spell} from a carried book. It takes one turn.`, exposure(s), s.awake.length === 0);
  }
  /* Terrain that hurts or blocks: a visible trap next to the character is
   * disarmed, and rock on the way to the stairs or an unexplored edge is dug
   * through. */
  if (!bleeding) {
    if (trapDirection(view) !== null) add("disarm", "Disarm the visible trap next to the character before stepping onto it.", exposure(s) * 0.5);
    if (rubbleDirection(view, terrain) !== null) add("tunnel", "Tunnel through the rubble that blocks the way to the rest of the level.", exposure(s) * 0.5);
  }
  /* A hard fight is worth a turn spent preparing for it: a buff or an
   * activation. An easy one is not. A curing device is worth using whenever the
   * character is hurt. */
  const hardFight = s.target !== null && (s.worst >= 2 || fightRisk(s) >= 0.4);
  if (!bleeding && hardFight) {
    const buff = buffUse(view);
    if (buff !== null) add("buff", `Use ${buff.name} before the fight: it makes the character stronger for a while.`, exposure(s) * 0.6);
    const activation = activationUse(view);
    if (activation !== null) add("activate", `Activate ${activation.name} before the fight.`, exposure(s) * 0.6);
  }
  if (!bleeding && hurt) {
    const device = deviceHealUse(view);
    if (device !== null) add("device", `Use ${device.name} to restore hit points.`, exposure(s) * 0.5);
  }
  /* A creature whose recall says it breathes is worth a resist potion first. */
  const breather = breatherInSight(view, s.awake);
  if (!bleeding && breather !== null) {
    const resist = resistUse(view);
    if (resist !== null) add("resist", `Use ${resist.name} before the ${breather.race} breathes${breather.element === null ? "" : ` ${breather.element}`}.`, exposure(s) * 0.6);
  }
  /* Floor loot. While saving for an aim only gold and sellable loot count, and
   * a full pack is emptied of junk rather than left to stall on a pickup. */
  const full = packFull(view);
  if (!bleeding && !full) {
    const loot = floorTarget(view, terrain, saving);
    if (loot !== null) {
      const why = loot.gold ? " It is gold, which buys the aim." : loot.sellable ? " It looks worth selling." : "";
      add("fetch", `Walk ${String(loot.away)} step${loot.away === 1 ? "" : "s"} to the ${loot.name} on the floor and pick it up.${why}`, exposure(s) + 0.02);
    }
  }
  if (!bleeding && full) {
    const junk = junkInPack(view);
    if (junk !== null) add("drop_junk", `The pack is full; drop ${junk.name} to make room.`, exposure(s));
  }
  if (hasFloorObject(view, at) && !full) add("pick_up", "Pick up the object on the floor under the character.", exposure(s));
  if (!unlit && !learnFirst && !bleeding && reachableFrontier(view, terrain)) {
    add("explore", "Walk toward the nearest unexplored ground on this level.", exposure(s) + 0.02);
  }
  if (!unlit && !learnFirst && !bleeding && reachableStairs(view, terrain) && cfg.descend &&
    /* In town, the stairs are the way down whenever recall cannot be: no scroll,
     * or no depth yet to return to. Shopping comes first while there is gold. */
    (player.depth > 0 || ((recall === null || player.maxDepth <= 1) && (player.gold <= 0 || neededEntrances(view, terrain, persona, visited, aims).length === 0)))) {
    add("descend", "Walk to a known down staircase and take it to the next, more dangerous level.", exposure(s) + (1 - s.hpShare) * 0.3);
  }
  return out;
}

export function createGoalPlanner(options: GoalPlannerOptions): Planner<GoalDigest> {
  const { cfg, terrain, log } = options;
  const personaOption = options.persona;
  const personaOf = typeof personaOption === "function" ? personaOption : () => personaOption ?? null;
  const rng = options.rng ?? Math.random;
  const backstoryTokens = options.backstoryTokens ?? 600;
  /* Awake creatures seen at the last decision, so a craven persona can tell what is new. */
  let lastAwake = new Set<number>();
  const visitedShops = new Set<number>();
  /* Studies already tried, as "level:spell", so a study the game refused is not repeated. */
  const triedStudies = new Set<string>();
  let decisionDepth: number | null = null;
  /* When and where Squire last read Word of Recall, for games whose view does not report a pending recall. */
  let recallRead: RecallRead | null = null;
  /* Goals whose last plan ended without a command, keyed to the game turn it
   * ended on. Offering one again before time moves would repeat the same empty
   * plan, so it is left out until the turn changes. */
  const stalled = new Map<Goal, number>();
  /* Plans started for each goal on the game turn in `sameTurnAt`. A plan whose
   * commands are refused or pass no time leaves the turn where it was, so the
   * same choice would otherwise come back on every decision for good. */
  const sameTurn = new Map<Goal, number>();
  let sameTurnAt: number | null = null;
  /* Whether the last question offered the escapes held back at first, which the retreat build needs to pick its stairs as the offer did. */
  let offeredWiden = false;

  /* The game refused these goals where the character stood. Fear, blindness,
   * confusion, darkness and low mana are already filtered out of the offers, so
   * whatever blocked the goal is something the view doesn't show, and it will
   * block it again until something here changes. */
  const refused = new Map<Goal, { readonly where: string; readonly turn: number }>();

  /* The model's last answer and the situation it answered. */
  let lastAnswer: { readonly situation: string; readonly turn: number; readonly pick: Goal } | null = null;

  /* The game turn on which the errand-order fallback last ended having done nothing. */
  let fallbackStalled: number | null = null;
  /** Set when the model passed on every option in danger: the next offer adds the escapes it held back. */
  let widenNext = false;

  /* How the last plan ended, told to the model at the next decision: it keeps
   * no memory between calls, so without this it cannot know that fear just
   * stopped a walk or that the game refused a command. */
  let lastOutcome: string | null = null;
  let outcomeVersion = 0;
  /* A bad level feeling is announced once, on arrival, so it is remembered for
   * as long as the character stays on that level. */
  let badFeeling: string | null = null;
  let feelingDepth = -1;
  function noteFeeling(view: AgentView): void {
    const depth = view.player().depth;
    const messages = view.messages();
    /* The game announces a feeling on arrival at every new level, so a fresh one also means a fresh floor at the same depth. */
    if (depth !== feelingDepth || arrivalFeeling(messages)) {
      feelingDepth = depth;
      badFeeling = null;
    }
    const seen = badLevelFeeling(messages);
    if (seen !== null) badFeeling = seen;
  }
  function noteOutcome(text: string): void {
    lastOutcome = text;
    outcomeVersion += 1;
  }

  function noteStalls(goal: Goal | null, plan: Plan, turn: number): Plan {
    if (goal !== null) {
      if (sameTurnAt !== turn) {
        sameTurnAt = turn;
        sameTurn.clear();
      }
      sameTurn.set(goal, (sameTurn.get(goal) ?? 0) + 1);
    }
    let issued = 0;
    let startTurn: number | null = null;
    let credited = false;
    const version = outcomeVersion;
    /* An instruction counts as carried out only once a command it chose has taken game time. */
    const settle = (v: AgentView): void => {
      if (credited || goal === null || issued === 0 || startTurn === null || v.turn() === startTurn) return;
      credited = true;
      options.orders?.carried(goal, v);
    };
    const step: Plan["step"] = (v, act) => {
      startTurn ??= v.turn();
      settle(v);
      const command = plan.step(v, act);
      if (command !== null) issued += 1;
      /* A plan that ends with no game time passed changed nothing: either it
       * issued no command, or the game refused every one it issued (a spell
       * while confused, a blocked step). Asking again this turn would repeat it. */
      else if (issued === 0 || v.turn() === startTurn) {
        if (goal === null) fallbackStalled = v.turn();
        else stalled.set(goal, v.turn());
        if (goal !== null && issued > 0) {
          refused.set(goal, { where: whereNow(v), turn: v.turn() });
          const why = refusalOf(goal, v);
          noteOutcome(`${plan.label}: the game refused it${why === null ? "" : ` ${why}`}, and no game time passed.`);
        } else {
          noteOutcome(`${plan.label}: nothing happened and no game time passed.`);
        }
      } else if (outcomeVersion === version) {
        noteOutcome(`${plan.label}: done.`);
      }
      return command;
    };
    return { ...plan, step, settle } as Plan;
  }

  /** The cause of a refusal, when the view shows one. */
  function refusalOf(goal: Goal, v: AgentView): string | null {
    const p = v.player();
    if (goal === "fight" && p.status.afraid > 0) return "while the character is afraid";
    if (READS.has(goal) && !canRead(v)) {
      return p.status.blind > 0 ? "while the character is blind" : p.status.confused > 0 ? "while the character is confused" : "because it is too dark here to read";
    }
    return null;
  }

  /** The character's depth, grid, health, status and the awake creatures around it. */
  function whereNow(v: AgentView): string {
    const p = v.player();
    const awake = awakeInSight(v.monsters()).map((m) => `${String(m.id)}@${String(m.grid.x)},${String(m.grid.y)}`).sort();
    return JSON.stringify([p.depth, p.grid.x, p.grid.y, healthBand(p.hp, p.maxHp), statusOf(v, canRead(v)), awake]);
  }

  /* A fight the model chose may wake a sleeper: the state says which creatures
   * are asleep, so waking one is part of the choice. */
  const fightCfg: SquireCfg = { ...cfg, wakeSleepers: true };

  function context(view: AgentView, act: AgentActions, progress: Progress, with_: SquireCfg = cfg): SquireContext {
    return { view, act, terrain, cfg: with_, progress, log };
  }

  /* Creatures seen on this level. One that steps out of the light and back is
   * not news: at night in town that happens every few turns, and treating it
   * as new ended every plan before it got anywhere. */
  let seenDepth = -1;
  const seenOnLevel = new Set<number>();
  function noteSeen(view: AgentView): void {
    const depth = view.player().depth;
    if (depth !== seenDepth) {
      seenDepth = depth;
      seenOnLevel.clear();
      breedersOnLevel.clear();
    }
    /* The game reuses a dead creature's id for the next one it makes, so an id
     * no longer on the level is forgotten; a summoned creature that takes it is
     * then news. Forgetting only makes Squire stop for more, never less. */
    const live = new Set(view.monsters().map((m) => m.id));
    for (const id of seenOnLevel) if (!live.has(id)) seenOnLevel.delete(id);
    for (const m of view.monsters()) {
      if (!m.visible) continue;
      seenOnLevel.add(m.id);
      if (m.raceFlags.includes("MULTIPLY")) breedersOnLevel.add(m.race);
    }
  }

  /* Kinds of breeder already seen on this level. One more of them coming into
   * view is how breeding looks, not news, even beside the character: a worm
   * mass ended a plan every turn. Damage from one still stops the plan by the
   * hit point rules. */
  const breedersOnLevel = new Set<string>();
  function routineBreeder(m: MonsterView): boolean {
    return m.raceFlags.includes("MULTIPLY") && breedersOnLevel.has(m.race);
  }

  function watch(view: AgentView): Watcher {
    const player = view.player();
    const hurt = player.maxHp > 0 && player.hp <= player.maxHp * cfg.retreatFraction;
    noteSeen(view);
    const watcher = createWatcher(view, {
      /* Already under the line: crossing it again is not news, but every
       * further blow is, so the model is asked again after each one. Poison
       * and bleeding cost a point every turn, which would end every plan at
       * once, so then only the damage-share rule below applies. */
      stopOnAnyDamage: hurt && player.status.poisoned === 0 && player.status.cut === 0,
      stopOnNewCreature: true,
      stopOnLowHealth: !hurt,
      retreatFraction: cfg.retreatFraction,
      /* Above the line, a big blow or a run of smaller ones is news too. */
      stopOnDamageShare: DAMAGE_SHARE_REDECIDE,
      routine: routineBreeder,
    });
    for (const id of seenOnLevel) watcher.acknowledge(id);
    return watcher;
  }

  /** Town errands obey the same interruption rules as dungeon errands. */
  function watched(plan: Plan, view: AgentView): WatchedPlan {
    return { label: plan.label, watcher: watch(view), step: (v, act) => plan.step(v, act) };
  }

  /** Run a mission as a plan. The mission's own stop ends the plan. */
  function missionPlan(label: string, mission: Mission, view: AgentView, with_: SquireCfg = cfg, limit = Infinity): WatchedPlan {
    const progress = newProgress(view.player().depth);
    const player = view.player();
    /* A plan chosen while already under the retreat line would otherwise end
     * before its first step. The outer watcher stops it on the next blow instead. */
    const hurt = player.maxHp > 0 && player.hp <= player.maxHp * with_.retreatFraction;
    /* The plan's own watcher decides what counts as a new creature, using what
     * was seen on this level, so the mission's watcher leaves that to it. */
    const missionCfg = { ...with_, stopOnNewCreature: false, ...(hurt ? { stopOnLowHealth: false } : {}) };
    let begun = false;
    let done = false;
    /* The game can refuse a command without spending time, such as a blow from
     * an afraid character. Nothing then changes for the watcher to notice, so
     * the errand would repeat the refused command forever. */
    let lastTurn: number | null = null;
    let refused = 0;
    return {
      label,
      watcher: watch(view),
      step(v, act) {
        if (done || progress.steps >= limit) return null;
        const turn = v.turn();
        refused = lastTurn !== null && turn === lastTurn ? refused + 1 : 0;
        if (refused >= REFUSED_COMMANDS) {
          done = true;
          log(`${label}: the game refused the last command and no time passed.`);
          noteOutcome(`${label}: the game refused the command and no time passed.`);
          return null;
        }
        const ctx = context(v, act, progress, missionCfg);
        if (!begun) {
          begun = true;
          const declined = mission.begin(ctx);
          if (declined !== null) {
            done = true;
            log(`${label}: ${declined.detail}`);
            noteOutcome(`${label}: ${declined.detail}`);
            return null;
          }
        }
        const decision = mission.step(ctx);
        if (isStop(decision)) {
          done = true;
          log(`${label}: ${decision.stop.detail}`);
          noteOutcome(`${label}: ${decision.stop.detail}`);
          return null;
        }
        lastTurn = turn;
        return decision.command;
      },
    };
  }

  /** A plan of commands worked out one at a time, ending when `next` returns null. */
  function stepsPlan(
    label: string,
    view: AgentView,
    next: (ctx: SquireContext, stepIndex: number) => AgentCommand | null,
  ): WatchedPlan {
    const progress = newProgress(view.player().depth);
    let index = 0;
    let done = false;
    return {
      label,
      watcher: watch(view),
      step(v, act) {
        if (done) return null;
        const command = next(context(v, act, progress), index);
        index += 1;
        if (command === null) done = true;
        return command;
      },
    };
  }

  /** One command, then a new decision. */
  function once(label: string, view: AgentView, command: (ctx: SquireContext) => AgentCommand | null): WatchedPlan {
    return stepsPlan(label, view, (ctx, i) => (i === 0 ? command(ctx) : null));
  }

  /** One command aimed at the current target: set the target, then issue it. */
  function atTarget(label: string, view: AgentView, command: (ctx: SquireContext) => AgentCommand, ball = false): WatchedPlan {
    return once(label, view, (ctx) => {
      const s = situationOf(ctx.view, dreadedNow(), stationaryNow(ctx.view, false));
      if (s.target === null) return null;
      if (ball && inspecting(ctx.view).blastArea !== undefined && inspecting(ctx.view).projectionPath !== undefined) {
        const aim = bestBallAim(ctx.view, s.awake, s.target);
        if (aim === null) return null;
        ctx.act.setTargetLocation(aim.x, aim.y);
      } else if (!ctx.act.setTargetMonster(s.target.id)) return null;
      return command(ctx);
    });
  }

  /**
   * A volley: fire at the one target the model chose until it dies, leaves
   * sight, the line of fire closes, or the ammunition runs out. Only built when
   * the view can report the line of fire, so an older game keeps the single
   * shot.
   */
  function volleyPlan(goal: RangedGoal, label: string, view: AgentView, spellSidx?: number): WatchedPlan {
    const target = situationOf(view, dreadedNow(), stationaryNow(view, false)).target;
    if (target === null) return once("no target", view, () => null);
    const next = volleySteps(goal, target.id, spellSidx);
    return stepsPlan(label, view, (ctx) => next(ctx));
  }

  /** The command that consumes one buff, resist, device or activation. */
  function useCommand(ctx: SquireContext, use: CombatUse): AgentCommand {
    switch (use.how) {
      case "cast": return ctx.act.cast(use.sidx);
      case "quaff": return ctx.act.quaff(use.handle);
      case "read": return ctx.act.read(use.handle);
      case "staff": return ctx.act.useStaff(use.handle);
      case "rod": return ctx.act.zapRod(use.handle);
      case "activate": return ctx.act.activate(use.handle);
    }
  }

  /** Whether the character is saving for a priced aim it cannot yet afford. */
  function savingFor(view: AgentView): boolean {
    const aims = options.strategy?.().aims ?? [];
    const gold = view.player().gold;
    return aims.some((aim) => aim.how === "save" && aim.price !== null && gold < aim.price);
  }

  function build(goal: Goal, view: AgentView): Plan {
    const pack = readPack(view);
    switch (goal) {
      case "recall_town":
      case "recall_dungeon": {
        const item = recallItem(view);
        if (item === null) return once("no recall scroll", view, () => null);
        recallRead = { turn: view.turn(), depth: view.player().depth };
        return watched(recallPlan(item), view);
      }
      case "shop":
        return watched(townTripPlan(terrain, personaOf(), visitedShops, log, options.strategy?.().aims ?? []), view);
      case "fight":
        return missionPlan("fight", autofight(), view, fightCfg);
      case "shoot": {
        if (volleyAvailable(view)) return volleyPlan("shoot", "shoot", view);
        const ammo = pack.ammo[0];
        return atTarget("shoot", view, (ctx) => ctx.act.fire(ammo?.handle ?? 0));
      }
      case "throw_oil": {
        if (volleyAvailable(view)) return volleyPlan("throw_oil", "throw oil", view);
        const oil = pack.oil[0];
        return atTarget("throw oil", view, (ctx) => ctx.act.throw(oil?.handle ?? 0));
      }
      case "aim_wand": {
        const wand = pack.attackWand[0];
        if (volleyAvailable(view)) return volleyPlan("aim_wand", `aim ${wand?.name ?? "a wand"}`, view);
        return atTarget(`aim ${wand?.name ?? "a wand"}`, view, (ctx) => ctx.act.aimWand(wand?.handle ?? 0));
      }
      case "cast_attack": {
        const spell = pickAttackSpell(pack.attackSpell, spellInfoOf(view));
        const label = `cast ${spell?.name ?? "a spell"}`;
        const ball = spell !== undefined && /(?:ball|orb|cloud|storm)/i.test(spell.name);
        /* A ball is aimed afresh every cast to keep the blast off the
         * character, so only bolts volley. */
        if (!ball && spell !== undefined && volleyAvailable(view)) return volleyPlan("cast_attack", label, view, spell.sidx);
        return atTarget(label, view, (ctx) => ctx.act.cast(spell?.sidx ?? 0), ball);
      }
      case "heal": {
        const potion = pack.heal[0];
        return once(`drink ${potion?.name ?? "a potion"}`, view, (ctx) => (potion === undefined ? null : ctx.act.quaff(potion.handle)));
      }
      case "cast_heal": {
        const spell = pack.healSpell[0];
        return once(`cast ${spell?.name ?? "a spell"}`, view, (ctx) => (spell === undefined ? null : ctx.act.cast(spell.sidx)));
      }
      case "phase": {
        const scroll = pack.phase[0];
        const spell = pack.escapeSpell[0];
        return once("phase away", view, (ctx) => {
          if (scroll !== undefined) return ctx.act.read(scroll.handle);
          if (spell !== undefined) return ctx.act.cast(spell.sidx);
          return null;
        });
      }
      case "teleport": {
        const item = pack.teleport[0];
        return once("teleport away", view, (ctx) => {
          if (item === undefined) return null;
          return /Staff/i.test(item.name) ? ctx.act.useStaff(item.handle) : ctx.act.read(item.handle);
        });
      }
      case "retreat": {
        /* Fleeing heads for the way out of the level when one is known and
         * leads somewhere safer, and only backs up a few steps when not. */
        const flight = retreatStairs(situationOf(view, dreadedNow()), terrain, offeredWiden);
        const depth = view.player().depth;
        return stepsPlan("back away", view, (ctx, i) => {
          if (ctx.view.player().depth !== depth) return null;
          const stairs = flight === "down" ? knownDownStairs(ctx.view, terrain) : knownStairs(ctx.view, terrain);
          if (flight !== "none" && stairs.length > 0) {
            const here = ctx.view.player().grid;
            const cell = ctx.view.cell(here.x, here.y);
            if (cell !== null && terrain.isDownStair(cell.feat)) return ctx.act.descend();
            if (cell !== null && flight === "any" && terrain.isUpStair(cell.feat)) return ctx.act.ascend();
            if (i === 0) {
              const engine = engineTravel(ctx, stairs, { run: true });
              if (engine !== null) return engine;
            }
            const travel = travelTo(ctx, stairs);
            return travel.kind === "step" ? travel.command : null;
          }
          if (i >= RETREAT_STEPS) return null;
          const away = retreatFrom(ctx, awakeInSight(ctx.view.monsters()).map((m) => m.grid));
          return away.kind === "step" ? away.command : null;
        });
      }
      case "rest":
        return once("rest", view, (ctx) => ctx.act.rest());
      case "wait":
        return once("wait a turn", view, (ctx) => ctx.act.hold());
      case "study": {
        const study = studyable(view, triedStudies);
        if (study === null) return once("nothing to study", view, () => null);
        triedStudies.add(`${String(view.player().level)}:${String(study.sidx)}`);
        return once("study", view, (ctx) => ctx.act.raw("study", { handle: study.handle, spell: study.sidx }));
      }
      case "wear": {
        const candidate = gearCandidates(view).find((gear) => !gear.unknown || (personaOf()?.sliders.curiosity ?? 0) >= 50);
        return once(`wear ${candidate?.name ?? "gear"}`, view, (ctx) => candidate === undefined ? null : ctx.act.wear(candidate.handle));
      }
      case "detect": {
        const source = detectionSource(view);
        return once(`detect with ${source?.name ?? "a known source"}`, view, (ctx) => {
          if (source === null) return null;
          if (source.kind === "cast") return ctx.act.cast(source.sidx);
          return source.kind === "zap" ? ctx.act.zapRod(source.handle) : ctx.act.read(source.handle);
        });
      }
      case "eat": {
        const food = pack.food[0];
        return once("eat", view, (ctx) => (food === undefined ? null : ctx.act.eat(food.handle)));
      }
      case "pick_up":
        return once("pick up", view, (ctx) => ctx.act.pickup());
      case "fetch":
        return (() => {
          const loot = floorTarget(view, terrain, savingFor(view));
          if (loot === null) return once("nothing to fetch", view, () => null);
          let grabbed = false;
          return stepsPlan("fetch item", view, (ctx) => {
            if (grabbed) return null;
            const here = ctx.view.player().grid;
            if (here.x === loot.at.x && here.y === loot.at.y) {
              grabbed = true;
              return ctx.act.pickup();
            }
            const engine = engineTravel(ctx, [loot.at], { run: true });
            if (engine !== null) return engine;
            const travel = travelTo(ctx, [loot.at]);
            return travel.kind === "step" ? travel.command : null;
          });
        })();
      case "drop_junk": {
        const junk = junkInPack(view);
        return once(`drop ${junk?.name ?? "junk"}`, view, (ctx) => {
          const now = junkInPack(ctx.view);
          return now === null ? null : ctx.act.drop(now.handle);
        });
      }
      case "buff":
        return once("use a combat buff", view, (ctx) => {
          const use = buffUse(ctx.view);
          return use === null ? null : useCommand(ctx, use);
        });
      case "resist":
        return once("drink a resist potion", view, (ctx) => {
          const use = resistUse(ctx.view);
          return use === null ? null : useCommand(ctx, use);
        });
      case "device":
        return once("use a curing device", view, (ctx) => {
          const use = deviceHealUse(ctx.view);
          return use === null ? null : useCommand(ctx, use);
        });
      case "activate":
        return once("activate an item", view, (ctx) => {
          const use = activationUse(ctx.view);
          return use === null ? null : useCommand(ctx, use);
        });
      case "disarm":
        return once("disarm a trap", view, (ctx) => {
          const dir = trapDirection(ctx.view);
          return dir === null ? null : ctx.act.disarm(dir);
        });
      case "tunnel":
        return once("tunnel through rubble", view, (ctx) => {
          const dir = rubbleDirection(ctx.view, terrain);
          return dir === null ? null : ctx.act.tunnel(dir);
        });
      case "explore":
        /* The model saw every awake creature before choosing to explore. */
        return missionPlan("explore", autoexplore({ allowAwake: true }), view);
      case "leave_level": {
        const down = reachableStairs(view, terrain);
        const targets = (v: AgentView) => (down ? knownDownStairs(v, terrain) : knownStairs(v, terrain));
        return stepsPlan(down ? "take the stairs down" : "take the nearest stairs", view, (ctx, i) => {
          const here = ctx.view.player();
          if (here.depth !== view.player().depth) return null;
          const cell = ctx.view.cell(here.grid.x, here.grid.y);
          if (cell !== null && terrain.isDownStair(cell.feat)) return ctx.act.descend();
          if (cell !== null && !down && terrain.isUpStair(cell.feat)) return ctx.act.ascend();
          if (i === 0) {
            const engine = engineTravel(ctx, targets(ctx.view), down ? { stairs: "down" } : { run: true });
            if (engine !== null) return engine;
          }
          const travel = travelTo(ctx, targets(ctx.view));
          return travel.kind === "step" ? travel.command : null;
        });
      }
      case "descend":
        return stepsPlan("take the stairs down", view, (ctx, i) => {
          const at = ctx.view.player().grid;
          const stairs = knownDownStairs(ctx.view, terrain);
          if (stairs.some((s) => s.x === at.x && s.y === at.y)) {
            /* One descend, then the plan is over: the next level is a new decision. */
            return ctx.view.player().depth === view.player().depth ? ctx.act.descend() : null;
          }
          if (i === 0) {
            const engine = engineTravel(ctx, stairs, { stairs: "down" });
            if (engine !== null) return engine;
          }
          const travel = travelTo(ctx, stairs);
          return travel.kind === "step" ? travel.command : null;
        });
    }
  }

  /* Where each awake creature in view was first seen still, to tell a mold
   * from a creature that happens to be standing still for a turn. */
  const stillSince = new Map<number, { readonly x: number; readonly y: number; readonly count: number }>();
  function stationaryNow(view: AgentView, update = true): ReadonlySet<number> {
    const out = new Set<number>();
    if (!update) {
      for (const [id, was] of stillSince) if (was.count >= STATIONARY_DECISIONS) out.add(id);
      return out;
    }
    const live = new Set<number>();
    for (const m of view.monsters()) {
      if (!m.visible || m.asleep) continue;
      live.add(m.id);
      const was = stillSince.get(m.id);
      const count = was !== undefined && was.x === m.grid.x && was.y === m.grid.y ? was.count + 1 : 1;
      stillSince.set(m.id, { x: m.grid.x, y: m.grid.y, count });
      if (count >= STATIONARY_DECISIONS) out.add(m.id);
    }
    for (const id of [...stillSince.keys()]) if (!live.has(id)) stillSince.delete(id);
    return out;
  }

  function dreadedNow(): ReadonlySet<string> {
    return options.dreaded?.() ?? new Set<string>();
  }

  function lessonsFor(view: AgentView): { lessons?: string } {
    const persona = personaOf();
    let lines = options.lessons?.(view) ?? [];
    if (persona !== null) lines = forget(lines, persona, rng);
    return lines.length === 0 ? {} : { lessons: lines.join(" ") };
  }

  /**
   * Pick from the answers. With no persona this is the best-move answer. With
   * one, the best and in-character answers are blended by persona strength, the
   * safety floor removes options riskier than the persona accepts, and a few
   * quirks decide outright.
   */
  function decide(raw: Answer & { type: "choice" }, inCharacter: Answer | undefined, digest: GoalDigest, answers: Readonly<Record<string, Answer>>, view: AgentView): string {
    const persona = personaOf();
    const probs = options.calibrate === undefined ? raw.probabilities : options.calibrate(raw.probabilities);
    const top = Object.entries(probs).sort((a, b) => b[1] - a[1])[0]?.[0] ?? raw.choice;
    const best = { ...raw, probabilities: probs, choice: top };
    if (persona === null) return best.choice;
    const offered = new Set(digest.offers.map((o) => o.goal as string));
    const advice = best.choice;
    const record = (pick: string, extra: Omit<PersonaTrace, "advice" | "pick">): string => {
      digest.trace = { advice, pick, ...extra };
      return pick;
    };
    const blank = { best: best.probabilities, inCharacter: null, blended: best.probabilities, strength: 0, removed: [] };
    if (mustPickUp(persona) && offered.has("pick_up")) return record("pick_up", { ...blank, quirk: "compulsive collector" });
    if (fleesFromNew(persona) && digest.newCreatures > 0) {
      const away = ["teleport", "phase", "retreat"].find((g) => offered.has(g));
      if (away !== undefined) return record(away, { ...blank, quirk: "craven" });
    }
    const inChar = inCharacter?.type === "choice" ? inCharacter.probabilities : null;
    const strength = jitteredStrength(persona, rng);
    const blended = inChar === null ? { ...best.probabilities } : blend(best.probabilities, inChar, strength);
    const risk: Record<string, number> = { none_of_these: 0 };
    for (const offer of digest.offers) risk[offer.goal] = offer.risk;
    const weighted = options.orders === undefined ? blended : options.orders.weigh(blended, answers, view, digest.offers);
    /* An order at high adherence carries its options past the ceiling, as Death wish does for every option. */
    for (const goal of options.orders?.passes(view) ?? []) if ((risk[goal] ?? 0) > riskCeiling(persona)) risk[goal] = riskCeiling(persona);
    /* A level with nothing left to explore has nothing safe and useful left, and the depth target no longer holds the character on it. */
    const spent = !digest.offers.some((o) => o.goal === "explore");
    const nudged = holdDescent(nudgeAims(weighted, digest.offers, persona.sliders.ambition, riskCeiling(persona)), options.strategy?.().aims ?? [], view, badFeeling !== null, spent);
    const floor = applySafetyFloor(nudged, risk, riskCeiling(persona), persona.quirks.deathwish.on);
    const pick = pickTop(floor.dist) ?? advice;
    return record(pick, { best: best.probabilities, inCharacter: inChar, blended: floor.dist, strength, removed: floor.removed });
  }

  /**
   * Moments that don't need the model: upkeep with nothing awake in sight, a
   * single option the persona's risk ceiling allows, and a situation the model
   * answered within the last few turns.
   */
  function reflexFor(offers: readonly Offer[], persona: Persona | null, situation: string, turn: number, passes: ReadonlySet<string>): { readonly goal: Goal; readonly why: string } | null {
    if (options.reflex === false) return null;
    const routine = ROUTINE.map((goal) => offers.find((o) => o.goal === goal && o.routine === true)).find((o) => o !== undefined);
    if (routine !== undefined) return { goal: routine.goal, why: "routine upkeep" };
    const only = offers.length === 1 ? offers[0] : undefined;
    const ceiling = persona === null ? FORCED_RISK : persona.quirks.deathwish.on ? 1 : riskCeiling(persona);
    if (only !== undefined && only.risk <= ceiling) return { goal: only.goal, why: "the only option" };
    const last = lastAnswer;
    const again = last === null ? undefined : offers.find((o) => o.goal === last.pick);
    /* A reused answer still has to clear today's ceiling, which an order may have lifted. */
    const allowed = again !== undefined && (persona === null || again.risk <= ceiling || passes.has(again.goal));
    if (last !== null && allowed && last.situation === situation && turn - last.turn >= 0 && turn - last.turn <= SAME_SITUATION_TURNS) {
      return { goal: last.pick, why: "same situation as the last answer" };
    }
    return null;
  }

  return {
    ask(view) {
      const persona = personaOf();
      const player = view.player();
      if (player.depth > 0) visitedShops.clear();
      if (player.dead) return { handBack: "The character has died." };
      noteSeen(view);
      noteFeeling(view);
      const s = situationOf(view, dreadedNow(), stationaryNow(view));
      const turn = view.turn();
      for (const [goal, at] of stalled) if (at !== turn) stalled.delete(goal);
      const here = whereNow(view);
      for (const [goal, r] of refused) if (r.where !== here || turn - r.turn > REFUSAL_HOLD_TURNS) refused.delete(goal);
      const newLevel = decisionDepth !== player.depth;
      decisionDepth = player.depth;
      const widen = widenNext;
      widenNext = false;
      offeredWiden = widen;
      if (sameTurnAt !== turn) {
        sameTurnAt = turn;
        sameTurn.clear();
      }
      for (const [goal, count] of sameTurn) {
        if (count === SAME_TURN_PLANS) {
          log(`goal: ${goal} is left out until game time passes; it has started ${String(count)} times on this turn`);
          sameTurn.set(goal, count + 1);
        }
      }
      const recalling = recallPending(player, recallRead, turn);
      const saving = savingFor(view);
      const aims = options.strategy?.().aims ?? [];
      const usable = (offer: Offer) => !stalled.has(offer.goal) && !refused.has(offer.goal) && (sameTurn.get(offer.goal) ?? 0) < SAME_TURN_PLANS;
      const base = offersFor(s, cfg, terrain, persona, visitedShops, triedStudies, newLevel, recalling, widen, saving, badFeeling, aims);
      const offered = options.strategy === undefined ? base : steerOffers(base, view, options.strategy(), { recallActive: recalling, tripRisk: Math.max(0.02, exposure(s)) }, (goal, criteria, risk) => ({ goal, criteria, risk }));
      let offers = offered.filter(usable);
      const listed = new Set(offers.map((o) => o.goal));
      const missing = widen ? [] : offersFor(s, cfg, terrain, persona, visitedShops, triedStudies, newLevel, recalling, true, saving, badFeeling, aims)
        .filter((o) => usable(o) && !listed.has(o.goal)).map((o) => o.goal);
      /* Everything tried this turn came to nothing, cornered in a corridor
       * perhaps. Letting a turn pass changes the situation where asking again
       * would not. */
      if (offers.length === 0 && offered.length > 0 && !stalled.has("wait") && (sameTurn.get("wait") ?? 0) < SAME_TURN_PLANS) {
        offers = [{ goal: "wait", criteria: "Wait a turn; nothing else on offer can be done from here right now.", risk: exposure(s) }];
      }
      if (offers.length === 0) {
        log(`goal: nothing to offer (light ${String(player.light)}, blind ${String(player.status.blind)}, confused ${String(player.status.confused)}, stalled: ${[...stalled.keys()].join(", ") || "none"}, refused: ${[...refused.keys()].join(", ") || "none"})`);
        return { handBack: "Squire can see nothing to do here: no creature to fight, nothing unexplored, and no known way down." };
      }

      const aimList = options.strategy?.().aims ?? [];
      const aimNote = aimList.length === 0 ? null : `Aims, best first: ${aimList.map((a) => a.label).join(", ")}.`
      const criteria: Record<string, string | null> = {};
      for (const offer of offers) criteria[offer.goal] = offer.criteria;
      criteria["none_of_these"] = NONE_OF_THESE;
      const goal: ChoiceQuestion = {
        type: "choice",
        instructions:
          "You are playing Angband, a dungeon game where death is permanent. Which option gives this character the best chance to survive and keep making progress?",
        criteria,
      };
      const seen = inSight(view.monsters());
      const awakeNow = new Set(s.awake.map((m) => m.id));
      const newCreatures = [...awakeNow].filter((id) => !lastAwake.has(id)).length;
      lastAwake = awakeNow;
      const unexplored = reachableFrontier(view, terrain);
      const stairs = knownDownStairs(view, terrain).length > 0;
      /* The creatures line is the plain truth, for the best-move question. A
       * persona's optimism or delusion is what the character believes, so it
       * goes under the persona, where the in-character question reads it. */
      const believed: string[] = [];
      const creatureLines = seen.map((m) => {
        const rating = assessThreat(m, player, s.awake, view, s.dreaded);
        const real = rating.band;
        const seenAs = persona === null ? real : shiftThreat(real, THREAT_BANDS.length, persona, rng);
        if (seenAs !== real) believed.push(`the ${m.race} is ${THREAT_BANDS[seenAs] ?? "deadly"}`);
        const tags = [m.asleep ? "asleep" : "", m.afraid ? "afraid" : "", m.raceFlags.includes("UNIQUE") ? "unique" : ""]
          .filter((t) => t !== "")
          .join(", ");
        return { race: m.race, band: THREAT_BANDS[real] ?? "deadly", ...(rating.description === null ? {} : { capability: rating.description }), away: steps(player.grid, m.grid), tags };
      });

      const creatures = seen.length === 0 ? "No creatures in sight." : groupLines(creatureLines);
      const passes = options.orders?.passes(view) ?? new Set<string>();
      /* What the orders and the persona's ceiling say is part of the situation: a new order or a lower ceiling makes the last answer stale. */
      const situation = JSON.stringify([
        player.depth, healthBand(player.hp, player.maxHp), creatures, statusOf(view, canRead(view)), unexplored, stairs,
        hungry(view), offers.map((o) => o.goal).sort(),
        options.orders?.revision(view) ?? "", [...passes].sort(), persona === null ? null : [riskCeiling(persona), persona.quirks.deathwish.on],
      ]);
      const reflex = reflexFor(offers, persona, situation, turn, passes);
      if (reflex !== null) {
        log(`goal: ${reflex.goal}, without asking (${reflex.why})`);
        options.orders?.decided(reflex.goal, view);
        const decided: Reflex<GoalDigest> = {
          reflex: reflex.why,
          plan: noteStalls(reflex.goal, build(reflex.goal, view), turn),
          context: { depth: player.depth, offers, newCreatures, situation, reflex: reflex.why },
          answers: { goal: { type: "choice", choice: reflex.goal, confidence: 1, probabilities: { [reflex.goal]: 1 } } },
        };
        return decided;
      }

      const orderNote = options.orders?.note(view, player.gold, offers) ?? null;
      const question: Question<GoalDigest> = {
        request: {
          state: {
            rules: HANDBOOK.join(" "),
            character: `Level ${String(player.level)} ${player.race} ${player.cls}, on dungeon level ${String(player.depth)} (deepest reached ${String(player.maxDepth)}).`,
            health: `${healthBand(player.hp, player.maxHp)}: ${String(player.hp)} of ${String(player.maxHp)} hit points`,
            ...(player.maxSp > 0 ? { mana: `${String(player.sp)} of ${String(player.maxSp)}` } : {}),
            creatures,
            ground: standingOnHarm(view, terrain, player.grid) ? "The ground here is hurting the character." : "Safe ground.",
            level: `${unexplored ? "Unexplored ground remains." : "The level is explored."} ${stairs ? "A down staircase is known." : "No down staircase is known."}`,
            status: statusOf(view, canRead(view)),
            ...(lastOutcome === null ? {} : { last: lastOutcome }),
            ...(aimNote === null ? {} : { aims: aimNote }),
            ...(orderNote === null ? {} : { orders: orderNote }),
            ...(hungry(view) ? { hunger: "The character is hungry." } : {}),
            ...swarmNote(seen),
            ...lessonsFor(view),
            ...(persona === null ? {} : { persona: { name: persona.name, ...personaState(persona, backstoryTokens), ...(believed.length === 0 ? {} : { believes: `${believed.join("; ")}.` }) } }),
          },
          questions:
            persona === null
              ? { goal }
              : { goal, in_character: { type: "choice", instructions: inCharacterInstructions(persona), criteria }, ...(options.orders?.ask(offers, view) ?? {}) },
        },
        context: { depth: player.depth, offers, newCreatures, situation, missing, ...(widen ? { widened: true as const } : {}) },
      };
      return question;
    },

    choose(answers: Readonly<Record<string, Answer>>, digest: GoalDigest, view: AgentView): Choice {
      const answer = answers["goal"];
      if (answer?.type !== "choice") return { handBack: "The model gave no goal." };
      const pick = decide(answer, answers["in_character"], digest, answers, view);
      if (pick === "none_of_these") {
        /* The errand order fights what is in front of it, which is the wrong
         * fallback for a character in trouble. Then the model's own likeliest
         * listed option stands in. Squire's risk figures are rougher than the
         * model's ranking: taking the lowest of them once cast spells at a
         * creature for hundreds of turns while the model rated retreat at 76%. */
        /* Options the persona's safety floor took away stay away. */
        const removed = new Set(digest.trace?.removed ?? []);
        const allowed = digest.offers.filter((o) => !removed.has(o.goal));
        const likeliest = [...(allowed.length > 0 ? allowed : digest.offers)].sort((a, b) => (answer.probabilities[b.goal] ?? 0) - (answer.probabilities[a.goal] ?? 0))[0];
        const p = view.player();
        const hurt = p.maxHp > 0 && p.hp <= p.maxHp * cfg.retreatFraction;
        const danger = hurt || digest.offers.some((o) => o.risk > 0.3);
        /* Passing on every option in danger most often means the one it wanted
         * was not offered. Ask once more with the held-back escapes listed. */
        const missing = digest.missing ?? [];
        if (danger && digest.widened !== true && missing.length > 0) {
          widenNext = true;
          log(`goal: none fit in danger, asking again with ${missing.join(", ")} added`);
          return { plan: { label: "ask again with more options", step: () => null } };
        }
        if (likeliest !== undefined && danger) {
          log(`goal: none fit in danger, taking the likeliest listed option (${likeliest.goal})`);
          return { plan: noteStalls(likeliest.goal, build(likeliest.goal, view), view.turn()) };
        }
        /* On a cleared floor the errand order has nothing to do either, and
         * repeating it only stops Squire. The model's likeliest offer stands in. */
        if (likeliest !== undefined && fallbackStalled === view.turn()) {
          log(`goal: none fit and the errand order has nothing to do, taking ${likeliest.goal}`);
          return { plan: noteStalls(likeliest.goal, build(likeliest.goal, view), view.turn()) };
        }
        const rated = digest.offers.map((o) => `${o.goal} ${String(Math.round((answer.probabilities[o.goal] ?? 0) * 100))}%`).join(", ");
        log(`goal: none fit (${rated}), following the fixed errand order`);
        return { plan: noteStalls(null, missionPlan("follow the errand order", campaign(), view, cfg, FALLBACK_STEPS), view.turn()) };
      }
      const offer = digest.offers.find((o) => o.goal === pick);
      if (offer === undefined) {
        return { handBack: "The model picked an option Squire did not offer, so the keyboard is yours." };
      }
      options.orders?.decided(offer.goal, view);
      if (digest.situation !== undefined) lastAnswer = { situation: digest.situation, turn: view.turn(), pick: offer.goal };
      const trace = digest.trace;
      if (trace !== undefined && trace.pick !== trace.advice) {
        log(`goal: ${pick}, against advice (${trace.advice})${trace.quirk === undefined ? "" : `: ${trace.quirk}`}`);
      } else {
        log(`goal: ${pick} (${String(Math.round((answer.probabilities[pick] ?? 0) * 100))}%)`);
      }
      return { plan: noteStalls(offer.goal, build(offer.goal, view), view.turn()) };
    },

    trigger(view, plan) {
      const watched = plan as Partial<WatchedPlan> & { settle?: (v: AgentView) => void };
      watched.settle?.(view);
      const stopped = watched.watcher?.check(view) ?? null;
      if (stopped !== null) noteOutcome(`${plan.label} stopped: ${stopped.detail}`);
      return stopped === null ? null : stopped.detail;
    },
  };
}
