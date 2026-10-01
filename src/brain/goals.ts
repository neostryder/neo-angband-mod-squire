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
import { DIRECTIONS, directionToward, key, neighbours, steps, type Loc } from "../grid.js";
import { frontiers, hasFloorObject, isClosedDoor, isRoutable, isWalkable, knownDownStairs, knownStairs, standingOnHarm } from "../map.js";
import { flowFrom, stepAway } from "../flow.js";
import { newProgress, type Progress } from "../progress.js";
import { awakeInSight, inSight, pickTarget } from "../threat.js";
import { travelTo } from "../travel.js";
import { engineTravel } from "../travel-engine.js";
import { volleyAvailable, volleySteps, type RangedGoal } from "./volley.js";
import { AUTOFIGHT_REACH, autofight } from "../missions/autofight.js";
import { autoexplore } from "../missions/autoexplore.js";
import type { Answer, ChoiceQuestion } from "./systemone.js";
import type { Choice, Plan, Planner, Question, Reflex } from "./brain.js";
import { proceduralPick } from "../knight.js";
import { attackSpellsOutOfMana, canRead, unseenAttacks, detectionSource, hungry, readPack, studyable, unseenSources, type Pack } from "./pack.js";
import { gearCandidates } from "../gear/compare.js";
import type { Persona } from "../persona/persona.js";
import { applySafetyFloor, blend, jitteredStrength, pick as pickTop, riskCeiling } from "../persona/blend.js";
import { fleesFromNew, forget, mustPickUp, nudgePosition, nudgeUnseen, shiftThreat } from "../persona/quirks.js";
import { inCharacterInstructions, personaState } from "../persona/state.js";
import { lowOnSupplies, recallItem, RECALL_FROM_DEPTH, supplyNeeds } from "../town/needs.js";
import { neededEntrances, recallPlan, townTripPlan } from "../town/plan.js";
import type { HomeStock } from "../town/home.js";
import { assessThreat, bestBallAim, clearShot, fastUniqueAtLowLevel, harmlessKind, incomingDamage, threatIndex, unseenDamageAt, THREAT_BANDS, BAND_RISK, type SpeedEnergy, type ThreatBand, type UnseenHit } from "./threat-model.js";
export { threatIndex, roundEstimate, THREAT_BANDS } from "./threat-model.js";
export type { ThreatBand } from "./threat-model.js";
import type { Orders } from "../orders/book.js";
import { nudgeAims, steerOffers, type AimTag, type Steering } from "../strategy/steer.js";
import { descentEscapes, holdDescent } from "../strategy/hold.js";
import { nudgePursuits, pursuitFacts } from "../strategy/pursuits.js";
import type { PurchaseKind } from "../strategy/judgment.js";
import { createJourney } from "../strategy/journey.js";
import { missingPreparation } from "../strategy/readiness.js";
import type { Aim } from "../strategy/aims.js";
import type { StoreMemory } from "../town/memory.js";
import { activationUse, attackDescription, attackOptions, breatherInSight, buffUse, deviceHealUse, healingAmount, healingPotion, healingSpell, resistUse, type AttackContext, type AttackOutcome, type CombatUse } from "./combat-kit.js";
import { rubbleDirection, trapDirection } from "./hazards.js";
import { floorTarget, junkInPack, packFull, stillWorthIt } from "./items.js";
import { arrivalFeeling, badLevelFeeling } from "./level-feel.js";
import { fearedBand, feelingBelief, feelingLog, feelingToward, nudgeGrudges, type Feeling } from "../learning/grudges.js";
import { distrusted, distrustedUse, emptyFamilyFlourishes, emptyFlourishes, flourishLines, nudgeCursedGround, nudgeGrounds, type Flourishes, type FamilyFlourishes } from "../learning/family-ways.js";

/** Every option this planner can offer. */
export type Goal =
  | "swing_unseen"
  | "cast_area"
  | "unseen_staff"
  | "unseen_wand"
  | "unseen_rod"
  | "step_aside"
  | "endure"
  | "fight"
  | "shoot"
  | "throw_oil"
  | "aim_wand"
  | "cast_attack"
  | "heal"
  | "cast_heal"
  | "phase"
  | "teleport"
  | "deep_descent"
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
  | "close_door"
  | "study"
  | "wear"
  | "detect"
  | "see_invisible"
  | "light_room"
  | "recall_town"
  | "shop"
  | "recall_dungeon"
  | "wait"
  | "take_position";

const NONE_OF_THESE = "None of the listed options suits this moment.";

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
/** How much heavier melee sits for a caster with no mana for its attack spells, against a creature that hurts on touch or that it cannot kill quickly. */
const MANA_STRANDED_MELEE = 3;
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

/** Whether a routine wait has other options beside it that are not upkeep. */
function waitCompetes(offers: readonly Offer[]): boolean {
  return offers.some((o) => o.goal === "wait" && o.routine === true) && offers.some((o) => o.goal !== "wait" && o.routine !== true);
}
const SURVIVAL_GOALS: ReadonlySet<Goal> = new Set(["swing_unseen", "cast_area", "unseen_staff", "unseen_wand", "unseen_rod", "step_aside", "descend", "fight", "shoot", "throw_oil", "aim_wand", "cast_attack", "heal", "cast_heal", "device", "phase", "teleport", "retreat", "leave_level", "take_position"]);
/** How far Squire will walk to take a defensible square. Beyond it, the route check and the persona's patience would not pay back. */
const TAKE_POSITION_REACH = 4;
/** The minimum number of impassable cardinal neighbours a square must have to count as a choke point. */
const TAKE_POSITION_MIN_WALLS = 2;
/** Awake creatures in sight that count as a group. */
const TAKE_POSITION_GROUP_SIZE = 2;
/** Goals that read a scroll or book or cast a spell. The game refuses these while the character is blind, confused or in the dark. */
const READS: ReadonlySet<Goal> = new Set<Goal>(["cast_attack", "cast_heal", "study", "detect", "recall_town", "recall_dungeon", "deep_descent"]);
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
  /** HP left under the conservative next-action bound, when this action has one. */
  readonly survival?: number;
  readonly uncertain?: true;
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
  /** Filled in by `choose`. */
  trace?: PersonaTrace;
}

export interface GoalPlannerOptions {
  readonly cfg: SquireCfg;
  /** The ranked aims and town-trip gate. Without it no aim steers anything. */
  readonly strategy?: () => Steering;
  /** Why the persona chose to head home before the supply margin forced it, or null. */
  readonly townCall?: () => string | null;
  /** The buying order the persona chose for this town visit, or null for the fixed order. */
  readonly purchaseOrder?: () => readonly PurchaseKind[] | null;
  /** The player's orders and standing instructions. Without it none weigh on a decision. */
  readonly orders?: Orders;
  readonly terrain: Terrain;
  readonly speedEnergy?: SpeedEnergy;
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
  /** The heir's hatred and fear toward the creatures that killed its ancestors. */
  readonly grudges?: () => readonly Feeling[];
  readonly flourishes?: () => Flourishes;
  /** The family's cross-generation record. Used for cursed-ground nudges. */
  readonly familyFlourishes?: () => FamilyFlourishes | null;
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
  readonly threats: readonly MonsterView[];
  readonly breederExit?: boolean;
  readonly unseenDamage: number;
  readonly unseenHit?: UnseenHit;
  readonly lastSeen: ReadonlyMap<number, number>;
  readonly terrain?: Terrain;
  readonly speedEnergy?: SpeedEnergy;
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

/**
 * Whether the awake creatures in sight are worth taking a defensible square over
 * for: a creature that splits, one that breathes or summons, or a group that
 * arrives together. A single easy melee fighter is not, since a stand-and-fight
 * leaves no room for a positional read. A summoner is read from its spell
 * flags, which is how the player knows it before it has called anything; a
 * breather is read from the recall, matching how the resist offer reads one.
 */
function hardContactGroup(s: Situation): boolean {
  if (s.swarm !== null || s.awake.length >= TAKE_POSITION_GROUP_SIZE) return true;
  const recall = s.view.monsterRecall;
  for (const m of s.awake) {
    if (m.spellFlags.some((flag) => flag.startsWith("S_"))) return true;
    const lore = recall?.call(s.view, m.raceIndex);
    if (lore !== null && lore !== undefined && (/\bbreathe\b/i.test(lore.text) || /\bsummon/i.test(lore.text))) return true;
  }
  return false;
}

function situationOf(view: AgentView, dreaded: ReadonlySet<string> = new Set(), stationary: ReadonlySet<number> = new Set(), remembered: readonly MonsterView[] = [], unseenDamage = 0, terrain?: Terrain, speedEnergy?: SpeedEnergy, harmless?: (monster: MonsterView) => boolean): Situation {
  const player = view.player();
  const monsters = view.monsters();
  /* A creature that cannot hurt the character is still a target, but not a
   * reason to back away or to put off resting. */
  const awake = awakeInSight(monsters).filter((monster) => harmless?.(monster) !== true);
  const target = pickTarget(monsters, player.grid, { wakeSleepers: true, reach: AUTOFIGHT_REACH });
  const worst = awake.reduce((max, m) => Math.max(max, assessThreat(m, player, awake, view, dreaded, terrain, speedEnergy).band), -1);
  const swarm = swarmOf(monsters);
  return {
    dreaded,
    stationary,
    swarm,
    swarming: player.level <= 5 && awake.filter((monster) => monster.raceFlags.includes("MULTIPLY")).length >= 3 || swarm !== null && swarm.count >= (dreaded.has(swarm.race) ? SWARM_LEAVE_DREADED : SWARM_LEAVE),
    view,
    pack: readPack(view),
    awake,
    target,
    worst,
    hpShare: player.maxHp > 0 ? player.hp / player.maxHp : 1,
    threats: [...monsters.filter((m) => m.visible && harmless?.(m) !== true), ...remembered.filter((m) => harmless?.(m) !== true && !monsters.some((other) => other.visible && other.id === m.id))],
    unseenDamage,
    lastSeen: new Map(),
    ...(terrain === undefined ? {} : { terrain }),
    ...(speedEnergy === undefined ? {} : { speedEnergy }),
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
  const target = s.target === null ? 0 : assessThreat(s.target, s.view.player(), s.awake, s.view, s.dreaded, s.terrain, s.speedEnergy).band;
  const band = Math.max(target, s.worst);
  /* A fight with a swarm does not end: each kill makes room for more. */
  return clamp01((BAND_RISK[band] ?? 0.75) * (0.6 + (1 - s.hpShare) * 1.4) * crowd(s) * (s.swarming ? 1.5 : 1));
}

function attackRisk(s: Situation, attack: AttackOutcome): number {
  const standing = Math.max(fightRisk(s), exposure(s));
  if (s.target === null || s.target.hp <= 0) return standing;
  if (!attack.kill) return standing;
  const rest = damageFor({ ...s, threats: s.threats.filter((m) => m.id !== s.target!.id) }).damage;
  return Math.max(0.05, damageRisk(rest, s.view.player().hp), standing * attack.failure);
}

/**
 * The death risk of doing something other than fighting while threats stay
 * near. A dangerous creature is a risk at full health too: hit points change how
 * big the risk is, not whether there is one. A distant creature matters less.
 */
function exposure(s: Situation): number {
  const incoming = damageFor(s);
  return damageRisk(incoming.damage, s.view.player().hp);
}

function damageRisk(damage: number, hp: number): number {
  return damage === 0 ? 0.01 : damage >= hp ? 1 : clamp01(0.02 + damage / Math.max(1, hp) * 0.6);
}

function damageFor(s: Situation, at: Loc = s.view.player().grid, actions = 1, terrain?: Terrain, openedDoor?: Loc) {
  return incomingDamage(s.view, at, actions, terrain ?? s.terrain, { monsters: s.threats, unseenDamage: s.unseenDamage, ...(s.unseenHit === undefined ? {} : { unseenHit: s.unseenHit }), lastSeen: s.lastSeen, ...(s.speedEnergy === undefined ? {} : { energy: s.speedEnergy }), ...(openedDoor === undefined ? {} : { openedDoor }) });
}

function combatContext(s: Situation): AttackContext {
  return { ...(s.terrain === undefined ? {} : { terrain: s.terrain }), facts: { monsters: s.threats, unseenDamage: s.unseenDamage, ...(s.unseenHit === undefined ? {} : { unseenHit: s.unseenHit }), lastSeen: s.lastSeen, ...(s.speedEnergy === undefined ? {} : { energy: s.speedEnergy }) } };
}

function combatOptions(s: Situation, kind: AttackOutcome["kind"]): AttackOutcome[] {
  return s.target === null ? [] : attackOptions(s.view, s.target, kind, combatContext(s));
}

/** The recall says the creature's blow is a touch, which reaches the character as it closes in. */
function hurtsOnTouch(view: AgentView, monster: MonsterView): boolean {
  return /\btouch/i.test(view.monsterRecall?.(monster.raceIndex)?.text ?? "");
}

/** Whether the melee could kill the target within two blows. */
function killsQuickly(target: MonsterView, melee: AttackOutcome): boolean {
  if (melee.kill) return true;
  return melee.damage !== null && melee.damage * 2 >= target.hp;
}

function safeRecovery(s: Situation, terrain: Terrain): boolean {
  const player = s.view.player();
  if (player.status.poisoned > 0 || player.status.cut > 0 || hungry(s.view) || standingOnHarm(s.view, terrain, player.grid)) return false;
  const incoming = damageFor(s, player.grid, 2, terrain);
  return incoming.damage === 0 && incoming.status === 0 && s.unseenDamage === 0 && !s.threats.some((m) => {
    const away = steps(player.grid, m.grid);
    return away <= (m.raceFlags.includes("MULTIPLY") ? 10 : m.asleep ? 8 : 5) || m.raceFlags.includes("PASS_WALL") && away <= 10;
  });
}

function closeDoorStep(s: Situation, terrain: Terrain): Loc | null {
  const view = s.view;
  const player = view.player();
  const incoming = damageFor(s, player.grid, 1, terrain);
  if (player.status.blind > 0 || player.status.confused > 0 || incoming.damage >= player.hp || incoming.status > 0) return null;
  const before = damageFor(s, player.grid, 2, terrain);
  for (const at of neighbours(player.grid)) {
    const cell = view.cell(at.x, at.y);
    if (cell === null || !cell.known || !cell.passable || !terrain.isOpenDoor?.(cell.feat) || cell.monster > 0 || cell.trap || view.monsters().some((monster) => key(monster.grid) === key(at))) continue;
    /* The synthetic closed cell retains opening costs and wall-passing abilities. */
    const closedView: AgentView = { ...view, cell: (x, y) => x === at.x && y === at.y ? { ...cell, feat: -2, passable: false } : view.cell(x, y) };
    const closedTerrain: Terrain = { ...terrain, isClosedDoor: (feat) => feat === -2 || terrain.isClosedDoor(feat) };
    const after = damageFor({ ...s, view: closedView }, player.grid, 2, closedTerrain);
    const field = flowFrom({ goals: knownStairs(closedView, closedTerrain), canEnter: (grid) => key(grid) !== key(at) && isRoutable(closedView, closedTerrain, grid) });
    if (after.damage < before.damage && after.status <= before.status && Number.isFinite(field.distance(player.grid)) && leaveStep({ ...s, view: closedView }, closedTerrain) !== null) return at;
  }
  return null;
}

interface EscapeStep {
  readonly at: Loc;
  readonly damage: number;
  readonly down: boolean;
}

/** The route bound permits pursuit before contact and charges opening before moving. */
function escapeRoute(s: Situation, terrain: Terrain, goals: readonly Loc[]): EscapeStep | null {
  const player = s.view.player();
  if (goals.some((at) => key(at) === key(player.grid))) return { at: player.grid, damage: 0, down: terrain.isDownStair(s.view.cell(player.grid.x, player.grid.y)!.feat) };
  if (pinned(s) || player.status.confused > 0) return null;
  const queue: { at: Loc; elapsed: number; first: Loc; damage: number }[] = [{ at: player.grid, elapsed: 0, first: player.grid, damage: 0 }];
  const visited = new Map<string, number>([[key(player.grid), 0]]);
  for (let head = 0; head < queue.length && head < 4000; head += 1) {
    const here = queue[head]!;
    for (const at of neighbours(here.at)) {
      if (!isWalkable(s.view, terrain, at)) continue;
      const door = isClosedDoor(s.view, terrain, at);
      const elapsed = here.elapsed + (door ? 2 : 1);
      if (elapsed >= (visited.get(key(at)) ?? Infinity)) continue;
      const damage = here.damage + damageFor(s, at, elapsed, terrain, door ? at : undefined).damage +
        (door ? damageFor(s, here.at, here.elapsed + 1, terrain, at).damage : 0);
      if (damage >= player.hp && damage > 0) continue;
      const first = here.elapsed === 0 ? at : here.first;
      if (here.elapsed === 0 && damageFor(s).damage > 0 && damage > damageFor(s).damage * (player.level < 35 ? 0.8 : 0.6)) continue;
      const goal = goals.find((grid) => key(grid) === key(at));
      if (goal !== undefined) return { at: first, damage, down: terrain.isDownStair(s.view.cell(goal.x, goal.y)!.feat) };
      visited.set(key(at), elapsed);
      queue.push({ at, elapsed, first, damage });
    }
  }
  return null;
}

function leaveStep(s: Situation, terrain: Terrain): EscapeStep | null {
  if (s.view.player().depth === 0) return null;
  if (missingPreparation(s.view, s.view.player().depth + 1).length > 0) {
    return escapeRoute(s, terrain, knownStairs(s.view, terrain).filter((at) => terrain.isUpStair(s.view.cell(at.x, at.y)!.feat)));
  }
  return escapeRoute(s, terrain, knownDownStairs(s.view, terrain)) ?? escapeRoute(s, terrain, knownStairs(s.view, terrain));
}

function retreatStep(s: Situation, terrain: Terrain, flight: "any" | "down" | "none"): EscapeStep | null {
  if (flight !== "none") {
    const route = escapeRoute(s, terrain, flight === "down" ? knownDownStairs(s.view, terrain) : knownStairs(s.view, terrain));
    if (route !== null) return route;
  }
  if (pinned(s) || s.view.player().status.confused > 0) return null;
  const at = s.view.player().grid;
  const threats = s.threats.filter((m) => !m.asleep).map((m) => m.grid);
  if (s.unseenHit !== undefined && s.unseenDamage > 0) threats.push(s.unseenHit.grid);
  const field = flowFrom({ goals: threats, canEnter: (grid) => isRoutable(s.view, terrain, grid) || threats.some((t) => key(t) === key(grid)) });
  const current = damageFor(s).damage;
  const safe = (grid: Loc) => {
    if (!isWalkable(s.view, terrain, grid)) return false;
    const damage = isClosedDoor(s.view, terrain, grid)
      ? Math.max(damageFor(s, at, 1, terrain, grid).damage, damageFor(s, grid, 2, terrain, grid).damage)
      : damageFor(s, grid, 1, terrain).damage;
    return damage < s.view.player().hp && (current === 0 || damage <= current * (s.view.player().level < 35 ? 0.8 : 0.6));
  };
  if (s.unseenDamage > 0) {
    const shelter = (grid: Loc) => (s.view.cell(grid.x, grid.y)?.glow === true ? 1 : 0) +
      1 / (1 + neighbours(grid).filter((next) => isRoutable(s.view, terrain, next)).length);
    const next = neighbours(at).filter((grid) => safe(grid) && !isClosedDoor(s.view, terrain, grid))
      .sort((a, b) => damageFor(s, a).damage - damageFor(s, b).damage || shelter(b) - shelter(a))[0];
    if (next !== undefined) return { at: next, damage: damageFor(s, next).damage, down: false };
  }
  const direction = stepAway(field, at, safe);
  if (direction === null) return null;
  const to = { x: at.x + direction.dx, y: at.y + direction.dy };
  return { at: to, damage: isClosedDoor(s.view, terrain, to) ? Math.max(damageFor(s, at, 1, terrain, to).damage, damageFor(s, to, 2, terrain, to).damage) : damageFor(s, to, 1, terrain).damage, down: false };
}

function within(s: Situation, range: number): boolean {
  return s.target !== null && steps(s.view.player().grid, s.target.grid) <= range;
}

function pinned(s: Situation): boolean {
  const player = s.view.player();
  return s.awake.some((m) => steps(player.grid, m.grid) <= 1 && m.speed >= player.speed);
}

function immediateDanger(s: Situation): boolean {
  const incoming = damageFor(s);
  return incoming.damage > 0 || incoming.status > 0;
}

function stairsUnderfoot(s: Situation, terrain: Terrain): boolean {
  const player = s.view.player();
  const cell = s.view.cell(player.grid.x, player.grid.y);
  return player.depth > 0 && cell !== null && (terrain.isUpStair(cell.feat) || terrain.isDownStair(cell.feat));
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
/** Player turns one wait errand holds for a pending recall: the longest delay and a little more. */
export const RECALL_HOLD_STEPS = 40;
/* A second scroll restarts descent's countdown, so a stack must wait longer than the maximum seven world ticks. */
const DEEP_DESCENT_WAIT_TURNS = 80;

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

export function offersFor(s: Situation, cfg: SquireCfg, terrain: Terrain, persona: Persona | null = null, visited: ReadonlySet<number> = new Set(), triedStudies: ReadonlySet<string> = new Set(), newLevel = false, recallActive = false, widen = false, saving = false, rememberedFeeling: string | null = null, aims: readonly Aim[] = [], feelings: readonly Feeling[] = [], flourishes: Flourishes = emptyFlourishes(), storeMemory?: readonly StoreMemory[], homeStock?: HomeStock): Offer[] {
  const view = s.view;
  const player = view.player();
  const at = player.grid;
  const hurt = player.hp < player.maxHp;
  const out: Offer[] = [];
  const incoming = damageFor(s, at, 1, terrain);
  const recovery = safeRecovery(s, terrain);
  const tieBreakKind = persona?.toggles.favouredWeapons === true ? flourishes.favouredKind : null;
  const add = (goal: Goal, criteria: string, risk: number, routine = false, survival = player.hp - incoming.damage, uncertain = false) => out.push({ goal, criteria, risk: clamp01(risk), survival, ...(routine ? { routine: true as const } : {}), ...(uncertain ? { uncertain: true as const } : {}) });
  /* A level is left once, however many reasons there are to leave it. */
  const exit = leaveStep(s, terrain);
  const addLeave = (criteria: string, _risk: number) => { if (exit !== null && !out.some((o) => o.goal === "leave_level")) add("leave_level", criteria, damageRisk(exit.damage, player.hp), false, player.hp - exit.damage); };
  const nearDeath = s.hpShare < 0.35;
  const unseenLethal = s.unseenDamage > 0 && damageFor(s, at, 2, terrain).damage >= player.hp;
  const fastUnique = inSight(view.monsters()).find((m) => fastUniqueAtLowLevel(m, player));
  /* A caster whose only attack is its spells, with no mana for any of them, facing
   * a creature that hurts on touch or that it cannot kill quickly in melee. */
  const melee = s.target === null ? undefined : combatOptions(s, "fight")[0];
  const strandedMelee = s.target !== null && !s.target.asleep && melee !== undefined && attackSpellsOutOfMana(view) && (hurtsOnTouch(view, s.target) || !killsQuickly(s.target, melee));
  /* The escape offers matter once the creature is close enough to strike. */
  const meleeDanger = strandedMelee && s.target !== null && steps(at, s.target.grid) <= 1;
  if (s.breederExit === true || player.level <= 5 && s.swarming) {
    const door = closeDoorStep(s, terrain);
    if (door !== null) add("close_door", "Close the adjacent open door to separate the breeders from the exit route. The closing action is survivable and the door reduces incoming damage over two actions.", damageRisk(incoming.damage, player.hp));
  }
  const addAttack = (goal: AttackOutcome["kind"], criteria: string, attack: AttackOutcome, weight = 1) => {
    const remaining = attack.kill && s.target !== null ? damageFor({ ...s, threats: s.threats.filter((monster) => monster.id !== s.target!.id) }, at, 1, terrain).damage : incoming.damage;
    add(goal, criteria + attackDescription(attack, view), attackRisk(s, attack) * weight, false, player.hp - remaining, attack.failure > 0 && attack.kill);
  };

  const needs = supplyNeeds(view, s.pack, persona, flourishes.darkLesson);
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
  if (recallActive && damageFor(s, at, 2, terrain).damage === 0 && incoming.status === 0 && s.unseenDamage === 0) {
    add("wait", "Wait for the Word of Recall already read to take effect.", exposure(s) * 0.8, s.awake.length === 0);
  }
  /* A second reading cancels a recall already under way, so none is offered while one is pending. */
  if (!recallActive && player.depth > 0 && recall !== null && (nearDeath || (fastUnique !== undefined && !immediateDanger(s)))) {
    add("recall_town", "Read Word of Recall to leave the dungeon. It takes 15 to 34 turns to work and cannot stop the next blow.", exposure(s));
  } else if (!recallActive && player.depth > 0 && recall !== null && lowOnSupplies(needs) && tripPays && !immediateDanger(s)) {
    const low = needs.filter((n) => n.kind !== "recall" && n.have < (n.kind === "healing" ? 2 : n.kind === "phase" ? 1 : n.hungry ? 1 : 0));
    add("recall_town", `Read Word of Recall to return to town and restock. The character is low on ${low.map((n) => n.name).join(", ")}.`, townRisk);
  }
  if (player.depth === 0) {
    const shops = neededEntrances(view, terrain, persona, visited, aims, flourishes, storeMemory, homeStock);
    if (shops.length > 0) {
      const missing = needs.filter((n) => n.have < n.want).map((n) => n.name);
      add("shop", missing.length > 0 ? `Visit the shops for ${missing.join(", ")}.` : `Visit the ${shops[0]!.name} to inspect its stock.`, townRisk);
    } else if (!recallActive && recall !== null && player.maxDepth > 1) {
      add("recall_dungeon", `Read Word of Recall to return to the deepest level reached, ${String(player.maxDepth * 50)} ft.`, townRisk);
    }
  }

  if (s.target !== null) {
    /* Walking up to a creature that stays where it is, a mold or a mushroom
     * patch, only trades blows with something that would never have followed. */
    const adjacent = steps(at, s.target.grid) <= 1;
    const walkUp = !adjacent && !fastUniqueAtLowLevel(s.target, player) && !s.stationary.has(s.target.id) && canReach(view, terrain, s.target.grid);
    /* The game refuses every blow from an afraid character without spending a turn. */
    if ((adjacent || walkUp) && player.status.afraid === 0 && melee !== undefined) {
      const away = steps(at, s.target.grid);
      const touch = hurtsOnTouch(view, s.target);
      const warning = strandedMelee ? ` The character is out of mana for its attack spells and this creature ${touch ? "hurts on touch" : "cannot be killed quickly"}, so resting, retreating or leaving the level is safer.` : "";
      addAttack("fight", (adjacent
        ? `Fight the ${s.target.race} in melee until it dies or something changes.`
        : `Walk ${String(away)} steps to the ${s.target.race}${s.target.asleep ? ", waking it," : ""} and fight it in melee; it can strike first while the character closes in.`) + warning, melee, strandedMelee ? MANA_STRANDED_MELEE : 1);
    }
    const ranged = within(s, MISSILE_RANGE);
    const clear = clearShot(view, s.target);
    /* A ranged attack keeps the character where it stands, so it is never safer
     * than standing there: rating it lower once had Squire cast at an adjacent
     * deadly creature when the model and the persona both said to retreat. */
    const missile = combatOptions(s, "shoot")[0];
    if (ranged && clear && s.pack.launcher && missile !== undefined) {
      addAttack("shoot", `Fire at the ${s.target.race} with the equipped launcher (carrying ${missile.source?.name ?? "ammunition"}).`, missile);
    }
    const oil = combatOptions(s, "throw_oil")[0];
    if (ranged && clear && oil !== undefined) {
      addAttack("throw_oil", `Throw ${oil.source?.name ?? "a flask of oil"} at the ${s.target.race}.`, oil);
    }
    const wand = combatOptions(s, "aim_wand")[0];
    if (ranged && clear && wand !== undefined) {
      addAttack("aim_wand", `Aim ${wand.source?.name ?? "a wand"} at the ${s.target.race}.`, wand);
    }
    const cast = combatOptions(s, "cast_attack")[0];
    const spell = cast?.source !== null && cast?.source !== undefined && "sidx" in cast.source ? cast.source : undefined;
    if (ranged && spell !== undefined && (clear || /(?:ball|orb|cloud|storm)/i.test(spell.name) && bestBallAim(view, s.awake, s.target) !== null)) {
      const aim = /(?:ball|orb|cloud|storm)/i.test(spell.name) ? "at the best visible blast position" : `at the ${s.target.race}`;
      addAttack("cast_attack", `Cast ${spell.name} ${aim}: it costs ${String(spell.mana)} of the ${String(player.sp)} mana left (${String(spell.fail)}% chance to fail).`, cast!);
    }
  }
  /* A bad cut does not close by itself, and a character bleeding out dies of it
   * with no creature near. A healing potion closes it, so drinking one is
   * offered whenever the cut is bad, and a worse one puts everything that
   * spends turns on something else on hold. */
  const cutBad = player.status.cut > BAD_CUT && s.pack.heal[0] !== undefined;
  const bleeding = player.status.cut > NASTY_CUT && s.pack.heal[0] !== undefined;
  const potion = healingPotion(view, incoming.damage);
  const cureStatus = player.status.poisoned > 0 || player.status.cut > 0 || player.status.blind > 0 || player.status.confused > 0;
  if ((hurt || cutBad) && potion !== undefined && (!recovery || cureStatus)) {
    const healed = healingAmount(view, potion);
    const after = Math.min(player.maxHp, player.hp + healed);
    if (healed >= incoming.damage || incoming.damage >= player.hp || cureStatus) {
      add("heal", `Drink ${potion.name} to restore hit points.${cutBad ? " It also closes the bleeding wound." : ""} The cure reaches at least ${String(after)} HP before up to ${String(incoming.damage)} incoming damage.`, damageRisk(incoming.damage, after), false, after - incoming.damage);
    }
  }
  const healSpell = healingSpell(view, incoming.damage);
  if (hurt && healSpell !== undefined) {
    const after = Math.min(player.maxHp, player.hp + healingAmount(view, healSpell));
    const bound = healSpell.fail === 0 ? after : player.hp;
    if (incoming.damage === 0 || after > incoming.damage && (after - player.hp >= incoming.damage || incoming.damage >= player.hp && after - player.hp > incoming.damage / 3)) add("cast_heal", `Cast ${healSpell.name} to restore hit points (${String(healSpell.fail)}% chance to fail).`, Math.max(healSpell.fail / 100, damageRisk(incoming.damage, bound)), false, bound - incoming.damage, healSpell.fail > 0);
  }
  /* Leaving goes down when it can, since going up from the first level is a trip to town and back. */
  const leaveBy = exit?.down === true ? "Walk to a known down staircase and take it" : "Walk to the nearest staircase, up or down, and take it";
  if (s.unseenDamage > 0) {
    addLeave(`${leaveBy}. Recent unexplained damage still makes this region dangerous even with no attacker in sight. The route has been checked against incoming damage.`, exposure(s));
    if (player.status.afraid === 0) add("swing_unseen", "Swing into an adjacent square where the unseen attacker might stand. Use its last known direction when available, otherwise choose a random direction. A miss spends an action exposed to another hit.", exposure(s), false, player.hp - incoming.damage, true);
    for (const goal of ["cast_area", "unseen_staff", "unseen_wand", "unseen_rod"] as const) {
      const source = unseenAttacks(view, goal, player.depth > 0 && player.gold < RECALL_MIN_GOLD && !reachableAnyStairs(view, terrain) && reachableFrontier(view, terrain))[0];
      if (source === undefined) continue;
      const purpose = /Treasure Location/i.test(source.name) ? "look for treasure to fund supplies while searching this unexplored floor for an exit; it cannot reveal the attacker" : /Mapping/i.test(source.name) ? "map ground that might lead to an exit; it cannot reveal the attacker" : goal === "cast_area" ? "cast an area effect where the attacker might stand" : goal === "unseen_staff" ? "affect or reveal creatures without seeing a target" : "aim toward the attacker's likely position";
      add(goal, `Use ${source.name} to ${purpose}. The attacker's position and resistance are uncertain; this costs an action exposed to another hit and can fail or miss.`, exposure(s), false, player.hp - incoming.damage, true);
    }
    for (const goal of ["detect", "see_invisible", "light_room"] as const) {
      const source = unseenSources(view, goal)[0];
      if (source === undefined) continue;
      const purpose = goal === "detect" ? "look for the creature dealing unexplained damage"
        : goal === "see_invisible" ? "see an invisible attacker for a while" : "light the room and reveal creatures beyond the carried light";
      add(goal, `Use ${source.name} to ${purpose}. This spends an action exposed to the unseen threat; success does not prove the region is safe.`, exposure(s));
    }
  }
  if (stairsUnderfoot(s, terrain) && (nearDeath || s.worst >= 2)) {
    addLeave("Take the staircase underfoot now to leave the creatures behind.", 0.01);
  }
  if (fastUnique !== undefined && reachableAnyStairs(view, terrain)) {
    addLeave(`${leaveBy}. The ${fastUnique.race} moves faster than this low-level character; leave before it closes in.`, exposure(s) * 0.3);
  }
  /* Breeders are easy one at a time, so the escapes below would not be offered
   * for them; leaving is offered for their numbers instead. */
  if (widen && !(s.swarming && s.swarm !== null) && s.awake.length > 0 && player.depth > 0 && reachableAnyStairs(view, terrain)) {
    addLeave(`${leaveBy} to leave every creature on this level behind.`, exposure(s) * 0.4);
  }
  if (s.swarming && s.swarm !== null && player.depth > 0 && reachableAnyStairs(view, terrain)) {
    addLeave(`${leaveBy}. ${String(s.swarm.count)} ${s.swarm.race} are in sight and breed faster than they die; a new level leaves them behind.`, exposure(s) * 0.3);
  }
  const feared = feelings.length === 0 ? undefined : inSight(view.monsters()).find((m) => feelingToward(feelings, m.race)?.kind === "fear");
  if (feared !== undefined && player.depth > 0 && reachableAnyStairs(view, terrain)) {
    const who = feared.raceFlags.includes("UNIQUE") ? feared.race : `the ${feared.race}`;
    addLeave(`${leaveBy}. The character fears ${who}, which killed some of its family, and a new level leaves it behind.`, exposure(s) * 0.3);
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
  if (player.depth > 0 && s.awake.length === 0 && !reachableFrontier(view, terrain) && missingPreparation(view, player.depth + 1).length > 0) {
    addLeave("The character can earn more experience on a fresh floor by taking the up stairs.", exposure(s) + 0.02);
  }
  /* Backing off from an easy creature at good health only costs turns, and
   * offering it made a timid persona walk away from every mouse. */
  /* An afraid character cannot fight back, so getting away is worth offering even from an easy creature. */
  /* Low health makes escapes worth offering even against easy creatures. */
  /* A caster with no mana for its spells cannot kill at range and should not trade blows with a creature that hurts on touch. */
  if (nearDeath || s.unseenDamage > 0 || meleeDanger || (s.awake.length > 0 && (widen || s.worst >= 1 || s.hpShare < ESCAPE_BELOW_HP || player.status.afraid > 0))) {
    if (s.pack.phase[0] !== undefined || s.pack.escapeSpell[0] !== undefined) {
      const how = s.pack.phase[0]?.name ?? s.pack.escapeSpell[0]?.name ?? "";
      const short = s.pack.phase[0] !== undefined || /^(Phase Door|Blink|Shadow Shift)$/i.test(how);
      add("phase", `Use ${how}: a ${short ? "short" : "long"} random teleport that breaks contact${short ? " for a moment" : ""}.`, Math.max(0.1, exposure(s) * 0.4), false, player.hp, true);
    }
    if (s.pack.teleport[0] !== undefined) {
      const teleport = s.pack.teleport[0];
      /* Teleport Level leaves the floor, up or down, which is a bigger step than moving across it. */
      const leaves = /Teleport Level/i.test(teleport.name);
      add("teleport", leaves
        ? `Use ${teleport.name} to leave this level entirely, going one level up or down.`
        : `Use ${teleport.name} to escape far from every creature in sight.`, Math.max(0.05, exposure(s) * (leaves ? 0.3 : 0.2)), false, player.hp, !leaves || /Staff/i.test(teleport.name));
    }
    if (!immediateDanger(s) && s.pack.descent[0] !== undefined) {
      add("deep_descent", `Read ${s.pack.descent[0].name} to leave this level after a delay of 4 to 7 turns. It drops the character several levels deeper.`, exposure(s) * 0.8 + 0.2);
    }
    const flight = retreatStairs(s, terrain, widen);
    const retreat = retreatStep(s, terrain, flight);
    if ((s.awake.length > 0 || s.unseenDamage > 0) && retreat !== null) add("retreat", s.unseenDamage > 0
      ? "Step away from the region of unexplained damage toward a checked escape route or safer ground; the unseen attacker could still follow."
      : flight === "any"
      ? "Head for the nearest known staircase and take it, leaving the awake creatures behind."
      : flight === "down"
        ? "Head for a known down staircase and take it, leaving the awake creatures behind."
        : "Step up to four steps away from the awake creatures in sight; one standing next to the character may still strike as it leaves.", damageRisk(retreat.damage, player.hp), false, player.hp - retreat.damage);
  }
  if (!bleeding && s.awake.length === 0 && recovery && (hurt || player.sp < player.maxSp)) {
    /* Resting passes the turns a pending recall needs as well as waiting does, and heals besides. */
    add("rest", "Rest until hit points and mana recover.", 0.01, recallActive);
  }
  if (hungry(view) && s.pack.food[0] !== undefined) {
    add("eat", `Eat ${s.pack.food[0].name}; the character is hungry.`, exposure(s));
  }
  const gear = gearCandidates(view, tieBreakKind).find((g) => !g.unknown || (persona?.sliders.curiosity ?? 0) >= 50);
  /* Walking in the dark shows nothing, so while a light sits unused in the pack
   * lighting it comes before exploring or the stairs. */
  const unlit = gear !== undefined && gear.criteria.includes("has no light");
  if (!bleeding && incoming.damage < player.hp && gear !== undefined && (unlit || !s.awake.some((m) => steps(at, m.grid) <= 3))) {
    /* Changing gear spends a turn, which is as risky as any other turn not spent fighting. */
    add("wear", gear.criteria, Math.max(gear.unknown ? 0.05 : 0.02, exposure(s)), !gear.unknown && gear.safeUpgrade !== false && s.awake.length === 0 && !immediateDanger(s));
  }
  if (!bleeding && newLevel && player.depth > 0 && s.awake.length === 0 && s.unseenDamage === 0) {
    const source = detectionSource(view);
    if (source !== null) add("detect", `${source.kind === "cast" ? "Cast" : source.kind === "zap" ? "Zap" : "Read"} ${source.name} to survey this new level.`, 0.02, true);
  }
  const study = studyable(view, triedStudies);
  /* A new spell costs one turn and is always worth having, so with nothing awake
   * in sight it comes before walking on, the way lighting a torch does. */
  const learnFirst = study !== null && s.awake.length === 0 && !immediateDanger(s);
  /* A turn of study is safe while the creatures that could reach the character
   * this turn would cost less than the retreat fraction of its hit points, so a
   * breeding swarm that only chips at it does not put a new spell off forever.
   * A creature that can paralyse, confuse or slow is not a small cost at any
   * hit-point share, so its reach rules study out. */
  if (!bleeding && study !== null && incoming.status === 0 && incoming.damage < player.hp * cfg.retreatFraction) {
    add("study", `Learn the spell ${study.spell} from a carried book. It takes one turn.`, exposure(s), s.awake.length === 0 && !immediateDanger(s));
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
    if (device !== null && !recovery) {
      const after = Math.min(player.maxHp, player.hp + healingAmount(view, device));
      if (after > incoming.damage || incoming.damage >= player.hp) add("device", `Use ${device.name} to restore hit points.`, damageRisk(incoming.damage, after), false, player.hp - incoming.damage, true);
    }
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
    const loot = floorTarget(view, terrain, saving, persona);
    if (loot?.look === true) add("fetch", `Walk ${String(loot.away)} step${loot.away === 1 ? "" : "s"} to look at ${loot.name} on the floor.`, exposure(s) + 0.02);
    else if (loot !== null) {
      const why = loot.gold ? " It is gold, which buys the aim." : loot.sellable ? " It looks worth selling." : "";
      add("fetch", `Walk ${String(loot.away)} step${loot.away === 1 ? "" : "s"} to the ${loot.name} on the floor and pick it up.${why}`, exposure(s) + 0.02);
    }
  }
  if (!bleeding && full) {
    const junk = junkInPack(view);
    if (junk !== null) add("drop_junk", `The pack is full; drop ${junk.name} to make room.`, exposure(s));
  }
  if (hasFloorObject(view, at) && !full) add("pick_up", "Pick up the object on the floor under the character.", exposure(s));
  const townNeedsStairs = player.depth === 0 && knownDownStairs(view, terrain).length === 0;
  /* Town explore only looks for the way down, so with a reachable staircase it has nothing to walk to. */
  const townStairsReached = player.depth === 0 && !townNeedsStairs && reachableStairs(view, terrain);
  if ((!unlit || townNeedsStairs) && !learnFirst && !bleeding && !townStairsReached && (reachableFrontier(view, terrain) || townNeedsStairs)) {
    add("explore", s.unseenDamage > 0 ? "Keep exploring toward unexplored ground despite the recent unexplained hits. Small hits can be endured, but an empty visible list does not prove safety." : "Walk toward the nearest unexplored ground on this level.", exposure(s) + 0.02);
  }
  if ((!unlit || player.depth === 0) && !learnFirst && !bleeding && reachableStairs(view, terrain) && cfg.descend &&
    /* In town, the stairs are the way down whenever recall cannot be: no scroll,
     * or no depth yet to return to. Shopping comes first while there is gold. */
    (player.depth > 0 || ((recall === null || player.maxDepth <= 1) && (player.gold <= 0 || neededEntrances(view, terrain, persona, visited, aims, flourishes, storeMemory, homeStock).length === 0)))) {
    add("descend", "Walk to a known down staircase and take it to the next, more dangerous level.", exposure(s) + (1 - s.hpShare) * 0.3);
  }
  const adequate = out.some((offer) => SURVIVAL_GOALS.has(offer.goal) && (offer.survival ?? 0) > 0);
  if (!bleeding && hardContactGroup(s)) {
    const take = offerTakePosition(s, terrain);
    if (take !== null) out.push(take);
  }
  return out.filter((offer) => {
    if (unseenLethal && !SURVIVAL_GOALS.has(offer.goal)) return false;
    if (adequate && (offer.goal === "heal" || offer.goal === "cast_heal" || offer.goal === "device") && (offer.survival ?? 0) <= 0) return false;
    return true;
  });
}

/** A square where the character would face the threat with fewer creatures at once. */
export interface ChokeSpot {
  readonly at: Loc;
  /** Cardinal neighbours of the spot that are walls, doors or otherwise impassable. */
  readonly walls: number;
  /** True for a closed-door square, which itself narrows the front. */
  readonly door: boolean;
  /** Incoming damage for one action at the spot, from the threats now awake. */
  readonly damage: number;
  /** Damage taken walking to the spot, one action per step, against the standing damage for the same time. */
  readonly routeDamage: number;
  /** Status damage dealt to the character along the route. */
  readonly routeStatus: number;
  /** Steps from the character, along the checked route. */
  readonly steps: number;
  /**
   * The route the check priced, one grid per step, ending on the spot. Walking
   * this exact route is what makes the offer's guarantee true: the plan never
   * walks a shorter path the check never saw.
   */
  readonly route: readonly Loc[];
}

/** The number of a grid's four cardinal neighbours that are walls or otherwise impassable. */
function cardinalWalls(s: Situation, at: Loc): number {
  let walls = 0;
  for (const n of neighbours(at)) {
    if (n.x !== at.x && n.y !== at.y) continue;
    const cell = s.view.cell(n.x, n.y);
    if (cell !== null && !cell.passable) walls += 1;
  }
  return walls;
}

/** Whether a grid is itself a choke point: a closed door, or mostly walled in. */
export function isChokeSquare(s: Situation, terrain: Terrain, at: Loc): boolean {
  if (isClosedDoor(s.view, terrain, at)) return true;
  return cardinalWalls(s, at) >= TAKE_POSITION_MIN_WALLS;
}

/** One grid's place on the cheapest route found so far, with the path that reached it. */
interface RouteEntry {
  readonly at: Loc;
  readonly damage: number;
  readonly status: number;
  readonly steps: number;
  readonly path: readonly Loc[];
}

/**
 * The damage the character takes reaching every grid within a few steps, one
 * action per step, against the active threats. A grid is dropped once a step
 * would push the running total to a lethal figure, so no route through a
 * killing blow survives. Each entry keeps the path whose damage it quotes, so
 * the plan can walk exactly the route the check priced.
 */
function routeDamages(s: Situation, terrain: Terrain): Map<string, RouteEntry> {
  const at = s.view.player().grid;
  const hp = s.view.player().hp;
  const start: RouteEntry = { at, damage: 0, status: 0, steps: 0, path: [at] };
  const best = new Map<string, RouteEntry>([[key(at), start]]);
  const queue: { readonly at: Loc; readonly entry: RouteEntry }[] = [{ at, entry: start }];
  for (let head = 0; head < queue.length && head < 4000; head += 1) {
    const here = queue[head]!;
    if (here.entry.steps >= TAKE_POSITION_REACH) continue;
    for (const next of neighbours(here.at)) {
      if (!isRoutable(s.view, terrain, next)) continue;
      const step = damageFor(s, next, 1, terrain);
      const damage = here.entry.damage + step.damage;
      if (damage >= hp) continue;
      const prev = best.get(key(next));
      if (prev !== undefined && damage >= prev.damage) continue;
      const entry: RouteEntry = { at: next, damage, status: here.entry.status + step.status, steps: here.entry.steps + 1, path: [...here.entry.path, next] };
      best.set(key(next), entry);
      queue.push({ at: next, entry });
    }
  }
  return best;
}

/**
 * Find nearby choke points over ground the character remembers. A spot is a
 * choke point when at least TAKE_POSITION_MIN_WALLS of its four cardinal
 * neighbours are impassable, or the spot itself is a closed door. A spot whose
 * route takes more damage than standing still for the same number of turns, or
 * whose route leaves the character status-affected, is left out, so the persona
 * never has to choose between a worse spot and a walk through a killing blow.
 */
export function chokeSpots(s: Situation, terrain: Terrain): ChokeSpot[] {
  const player = s.view.player();
  const at = player.grid;
  if (pinned(s) || player.status.confused > 0) return [];
  const routes = routeDamages(s, terrain);
  const out: ChokeSpot[] = [];
  for (const route of routes.values()) {
    if (route.steps === 0) continue;
    const grid = route.at;
    if (!isWalkable(s.view, terrain, grid)) continue;
    const door = isClosedDoor(s.view, terrain, grid);
    const walls = cardinalWalls(s, grid);
    if (!door && walls < TAKE_POSITION_MIN_WALLS) continue;
    /* The walk costs no more than standing still as long, and neither does the walk with the one-turn wait there. */
    const spotDamage = damageFor(s, grid, 1, terrain).damage;
    if (route.damage > damageFor(s, at, route.steps, terrain).damage) continue;
    if (route.damage + spotDamage > damageFor(s, at, route.steps + 1, terrain).damage) continue;
    /* Only status beyond what standing still for the same time already brings counts. */
    if (route.status > damageFor(s, at, route.steps, terrain).status) continue;
    out.push({ at: grid, walls, door, damage: spotDamage, routeDamage: route.damage, routeStatus: route.status, steps: route.steps, route: route.path.slice(1) });
  }
  return out;
}

/** The best defensible square to step to now, judged by damage then by how walled in it is. */
export function bestChokeSpot(s: Situation, terrain: Terrain): ChokeSpot | null {
  const here = damageFor(s, s.view.player().grid, 1, terrain).damage;
  const spots = chokeSpots(s, terrain)
    .filter((spot) => spot.damage < here || spot.damage === here && (spot.door || spot.walls >= TAKE_POSITION_MIN_WALLS) && spot.steps >= 1)
    .sort((a, b) => a.damage - b.damage || b.walls - a.walls || a.routeDamage - b.routeDamage || a.steps - b.steps);
  return spots[0] ?? null;
}

/**
 * The offer Squire extends to take a defensible square nearby, when the
 * character faces a summoner, a breather, or a group. A character already in a
 * choke point has nothing to gain from another move, and the route is verified
 * against standing still for the same time, so the persona never has to choose
 * between fighting from a worse spot and walking into one.
 */
export function offerTakePosition(s: Situation, terrain: Terrain): Offer | null {
  const player = s.view.player();
  const at = player.grid;
  if (player.status.confused > 0 || player.status.afraid > 0 || player.status.blind > 0) return null;
  /* The caller has already checked hardContactGroup. */
  if (pinned(s)) return null;
  if (isChokeSquare(s, terrain, at)) return null;
  const best = bestChokeSpot(s, terrain);
  if (best === null) return null;
  const reach = best.steps === 1 ? "1 step" : `${String(best.steps)} steps`;
  const reason = best.door
    ? "the doorway narrows the front to one creature at a time"
    : best.walls >= 3
      ? "the dead end limits who can reach it together"
      : "the corridor limits who can reach it together";
  return {
    goal: "take_position",
    criteria: `Step ${reach} to a nearby choke point so ${reason}; the route has been checked and does not take more damage than standing here for the same time, and waiting there for the creature to come alone is part of the same offer.`,
    risk: damageRisk(best.damage, player.hp),
    /* The plan walks the route, then waits, so both costs bound what is left. */
    survival: Math.max(0, player.hp - best.routeDamage - best.damage),
  };
}

export function createGoalPlanner(options: GoalPlannerOptions): Planner<GoalDigest> {
  const { cfg, terrain, log } = options;
  const journey = createJourney(terrain, (view) => situationNow(view).unseenDamage > 0);
  const personaOption = options.persona;
  const personaOf = typeof personaOption === "function" ? personaOption : () => personaOption ?? null;
  const flourishesNow = () => options.flourishes?.() ?? emptyFlourishes();
  function flourishView(view: AgentView): AgentView {
    const run = flourishesNow();
    const persona = personaOf();
    if (!persona?.toggles.inheritedSuperstitions || run.superstitions.length === 0) return view;
    return { ...view, inventory: () => view.inventory().map((item) => distrusted(item, run, persona) ? { ...item, activation: false } : item) };
  }
  const rng = options.rng ?? Math.random;
  const backstoryTokens = options.backstoryTokens ?? 600;
  /* Awake creatures seen at the last decision, so a craven persona can tell what is new. */
  let lastAwake = new Set<number>();
  /* Creatures whose grudge has been told in the log, so each is told once. */
  const grudgeNoticed = new Set<number>();
  const visitedShops = new Set<number>();
  /* Studies already tried, as "level:spell", so a study the game refused is not repeated. */
  const triedStudies = new Set<string>();
  let decisionDepth: number | null = null;
  /* When and where Squire last read Word of Recall, for games whose view does not report a pending recall. */
  let recallRead: RecallRead | null = null;
  let descentRead: RecallRead | null = null;
  const rememberedThreats = new Map<number, { monster: MonsterView; turn: number }>();
  let observed: { depth: number; hp: number; grid: Loc } | null = null;
  let unseenHit: UnseenHit | null = null;
  /* Kinds that have taken hit points from the character, which are never
   * harmless again, and how many observations each creature on this level has
   * spent next to the character without a loss. */
  const hurtBy = new Set<string>();
  const contacts = new Map<number, number>();
  function harmlessNow(view: AgentView, monster: MonsterView): boolean {
    return !hurtBy.has(monster.race) && harmlessKind(monster, view, contacts.get(monster.id) ?? 0);
  }
  function situationNow(view: AgentView, update = false, observe = update): Situation {
    view = flourishView(view);
    const player = view.player();
    const turn = view.turn();
    if (observed !== null && observed.depth !== player.depth) {
      rememberedThreats.clear();
      unseenHit = null;
      contacts.clear();
    }
    const liveIds = new Set(view.monsters().map((m) => m.id));
    for (const id of rememberedThreats.keys()) if (!liveIds.has(id)) rememberedThreats.delete(id);
    if (observe) {
      const visible = view.monsters().filter((m) => m.visible);
      const explains = (grid: Loc, damage: number) => {
        const background = incomingDamage(view, grid, 2, terrain, { monsters: [], ...(options.speedEnergy === undefined ? {} : { energy: options.speedEnergy }) }).damage;
        return visible.some((monster) => !monster.asleep && incomingDamage(view, grid, 2, terrain, { monsters: [monster], ...(options.speedEnergy === undefined ? {} : { energy: options.speedEnergy }) }).damage - background >= damage);
      };
      if (unseenHit !== null && explains(unseenHit.grid, unseenHit.damage)) unseenHit = null;
      if (observed !== null && observed.depth === player.depth && observed.hp > player.hp && !explains(observed.grid, observed.hp - player.hp) && !explains(player.grid, observed.hp - player.hp) && player.status.poisoned === 0 && player.status.cut === 0 && !standingOnHarm(view, terrain, observed.grid) && !standingOnHarm(view, terrain, player.grid)) {
        const likely = [...rememberedThreats.values()].filter((m) => steps(player.grid, m.monster.grid) <= 1).sort((a, b) => b.turn - a.turn)[0];
        unseenHit = { grid: { ...player.grid }, damage: observed.hp - player.hp, turn, ...(likely === undefined ? {} : { direction: directionToward(player.grid, likely.monster.grid) ?? undefined }) };
      }
      for (const monster of visible) rememberedThreats.set(monster.id, { monster: { ...monster, grid: { ...monster.grid }, visible: false }, turn });
      const awakeVisible = visible.filter((monster) => !monster.asleep);
      const adjacent = awakeVisible.filter((monster) => steps(player.grid, monster.grid) <= 1 || observed !== null && steps(observed.grid, monster.grid) <= 1);
      if (observed !== null && observed.depth === player.depth && observed.hp > player.hp) {
        const blamed = adjacent.length > 0 ? adjacent : awakeVisible.filter((monster) => monster.spellFlags.length > 0);
        for (const monster of blamed) hurtBy.add(monster.race);
      } else {
        for (const monster of adjacent) contacts.set(monster.id, (contacts.get(monster.id) ?? 0) + 1);
      }
      observed = { depth: player.depth, hp: player.hp, grid: { ...player.grid } };
    }
    for (const [id, memory] of rememberedThreats) if (turn - memory.turn > 50 || turn < memory.turn) rememberedThreats.delete(id);
    const unseenDamage = unseenDamageAt(unseenHit ?? undefined, player.grid, turn);
    const situation = situationOf(view, dreadedNow(), stationaryNow(view, update), [...rememberedThreats.values()].map((m) => m.monster), unseenDamage, terrain, options.speedEnergy, (monster) => harmlessNow(view, monster));
    return { ...situation, ...(unseenHit === null ? {} : { unseenHit }), breederExit: journey.breederExit(view), lastSeen: new Map([...rememberedThreats].map(([id, memory]) => [id, memory.turn])) };
  }
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
    plan = journey.guarded(goal, plan);
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
      const proposed = plan.step(v, act);
      const command = proposed !== null && distrustedUse(proposed, v, flourishesNow(), personaOf()) ? null : proposed;
      if (command !== null) issued += 1;
      /* A plan that ends with no game time passed changed nothing: either it
       * issued no command, or the game refused every one it issued (a spell
       * while confused, a blocked step). Asking again this turn would repeat it. */
      else if (issued === 0 || v.turn() === startTurn) {
        if (goal !== null) stalled.set(goal, v.turn());
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

  /** The dashboard reason for handing back with nothing to offer. */
  function nothingToDo(v: AgentView, tried: readonly Goal[]): string {
    if (tried.length > 0) {
      const wait = refused.has("wait") ? "the game refused to let it wait a turn here" : stalled.has("wait") ? "waiting a turn passed no game time" : "waiting a turn is not safe here";
      return `Squire has nothing left to try here: ${tried.join(", ")} came to nothing this turn, and ${wait}.`;
    }
    if (knownDownStairs(v, terrain).length > 0 && !reachableStairs(v, terrain)) {
      return "Squire can see nothing to do here: a down staircase is known, but no remembered ground leads to it, and nothing unexplored can be reached.";
    }
    return "Squire can see nothing to do here: no creature to fight, nothing unexplored, and no known way down.";
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
    return { view: flourishView(view), act, terrain, cfg: with_, progress, log };
  }

  /* Creatures seen on this level. One that steps out of the light and back is
   * not news: at night in town that happens every few turns, and treating it
   * as new ended every plan before it got anywhere. */
  let seenDepth = -1;
  const seenOnLevel = new Map<number, string>();
  function noteSeen(view: AgentView): void {
    const depth = view.player().depth;
    if (depth !== seenDepth) {
      seenDepth = depth;
      seenOnLevel.clear();
      breedersOnLevel.clear();
    }
    /* The game reuses a dead creature's id for the next one it makes, so an id
     * that comes back as another kind is news. An id missing from the list is
     * kept: some games list only the creatures in view, and forgetting those
     * made Farmer Maggot news each time he stepped back into the light. */
    for (const m of view.monsters()) {
      if (!m.visible) continue;
      seenOnLevel.set(m.id, m.race);
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
      stopOnAnyDamage: (hurt || !view.monsters().some((monster) => monster.visible && !monster.asleep)) && player.status.poisoned === 0 && player.status.cut === 0,
      stopOnNewCreature: true,
      stopOnLowHealth: !hurt,
      retreatFraction: cfg.retreatFraction,
      /* Above the line, a big blow or a run of smaller ones is news too. */
      stopOnDamageShare: DAMAGE_SHARE_REDECIDE,
      routine: (monster) => harmlessNow(view, monster) || routineBreeder(monster) && incomingDamage(view, view.player().grid, 1, terrain, { monsters: [monster], ...(options.speedEnergy === undefined ? {} : { energy: options.speedEnergy }) }).damage === 0,
    });
    const races = new Map(view.monsters().map((m) => [m.id, m.race]));
    for (const [id, race] of seenOnLevel) {
      if ((races.get(id) ?? race) === race) watcher.acknowledge(id);
      else seenOnLevel.delete(id);
    }
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
  function atTarget(label: string, view: AgentView, command: (ctx: SquireContext) => AgentCommand | null, ball = false): WatchedPlan {
    return once(label, view, (ctx) => {
      const s = situationOf(ctx.view, dreadedNow(), stationaryNow(ctx.view, false));
      if (s.target === null) return null;
      if (ball && ctx.view.blastArea !== undefined && ctx.view.projectionPath !== undefined) {
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
    const next = volleySteps(goal, target.id, spellSidx, (v) => combatContext(situationNow(v)));
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
    view = flourishView(view);
    const pack = readPack(view);
    switch (goal) {
      case "endure":
        return once("wait for an opening", view, (ctx) => ctx.act.hold());
      case "step_aside":
        return once("try another safe step", view, (ctx) => {
          const s = situationNow(ctx.view);
          const at = ctx.view.player().grid;
          const safe = neighbours(at).filter((grid) => isWalkable(ctx.view, terrain, grid) && !standingOnHarm(ctx.view, terrain, grid) && !ctx.view.monsters().some((m) => m.visible && steps(m.grid, grid) <= 1) && damageFor(s, grid, 1, terrain).damage < ctx.view.player().hp);
          const next = safe[Math.floor(rng() * safe.length)];
          const dir = next === undefined ? null : directionToward(at, next);
          return dir === null ? null : ctx.act.move(dir);
        });
      case "swing_unseen":
        return once("swing at the unseen attacker", view, (ctx) => {
          if (ctx.view.player().status.afraid > 0) return null;
          const s = situationNow(ctx.view);
          const dir = s.unseenHit?.direction ?? DIRECTIONS[Math.floor(rng() * DIRECTIONS.length)]!.key;
          return ctx.act.melee(dir);
        });
      case "cast_area":
      case "unseen_staff":
      case "unseen_wand":
      case "unseen_rod":
        return once("answer the unseen attacker", view, (ctx) => {
          const s = situationNow(ctx.view);
          if (s.unseenDamage <= 0) return null;
          const source = unseenAttacks(ctx.view, goal, ctx.view.player().depth > 0 && ctx.view.player().gold < RECALL_MIN_GOLD && !reachableAnyStairs(ctx.view, terrain) && reachableFrontier(ctx.view, terrain))[0];
          if (source === undefined) return null;
          const dir = s.unseenHit?.direction ?? DIRECTIONS[Math.floor(rng() * DIRECTIONS.length)]!.key;
          const offset = DIRECTIONS.find((d) => d.key === dir)!;
          const at = ctx.view.player().grid;
          ctx.act.setTargetLocation(at.x + offset.dx, at.y + offset.dy);
          return source.how === "wand" ? ctx.act.aimWand(source.handle) : useCommand(ctx, source);
        });
      case "recall_town":
      case "recall_dungeon": {
        const item = recallItem(view);
        if (item === null) return once("no recall scroll", view, () => null);
        recallRead = { turn: view.turn(), depth: view.player().depth };
        return watched(recallPlan(item), view);
      }
      case "shop":
        return watched(townTripPlan(terrain, personaOf(), visitedShops, log, options.strategy?.().aims ?? [], flourishesNow, options.strategy, options.purchaseOrder, options.strategy?.().homeStock, options.strategy?.().saveHomeStock), view);
      case "fight":
        return missionPlan("fight", autofight(), view, fightCfg);
      case "shoot": {
        if (volleyAvailable(view)) return volleyPlan("shoot", "shoot", view);
        const target = situationNow(view).target;
        const next = target === null ? () => null : volleySteps("shoot", target.id, undefined, (v) => combatContext(situationNow(v)));
        return once("shoot", view, next);
      }
      case "throw_oil": {
        if (volleyAvailable(view)) return volleyPlan("throw_oil", "throw oil", view);
        const target = situationNow(view).target;
        const next = target === null ? () => null : volleySteps("throw_oil", target.id, undefined, (v) => combatContext(situationNow(v)));
        return once("throw oil", view, next);
      }
      case "aim_wand": {
        const wand = pack.attackWand[0];
        if (volleyAvailable(view)) return volleyPlan("aim_wand", `aim ${wand?.name ?? "a wand"}`, view);
        const target = situationNow(view).target;
        const next = target === null ? () => null : volleySteps("aim_wand", target.id, undefined, (v) => combatContext(situationNow(v)));
        return once(`aim ${wand?.name ?? "a wand"}`, view, next);
      }
      case "cast_attack": {
        const cast = combatOptions(situationNow(view), "cast_attack")[0];
        const spell = cast?.source !== null && cast?.source !== undefined && "sidx" in cast.source ? cast.source : undefined;
        const label = `cast ${spell?.name ?? "a spell"}`;
        const ball = spell !== undefined && /(?:ball|orb|cloud|storm)/i.test(spell.name);
        /* A ball is aimed afresh every cast to keep the blast off the
         * character, so only bolts volley. */
        if (!ball && spell !== undefined && volleyAvailable(view)) return volleyPlan("cast_attack", label, view, spell.sidx);
        return atTarget(label, view, (ctx) => {
          const usable = spell !== undefined && combatOptions(situationNow(ctx.view), "cast_attack").some((attack) => attack.source !== null && "sidx" in attack.source && attack.source.sidx === spell.sidx);
          return usable ? ctx.act.cast(spell!.sidx) : null;
        }, ball);
      }
      case "heal": {
        const potion = healingPotion(view, damageFor(situationNow(view)).damage);
        return once(`drink ${potion?.name ?? "a potion"}`, view, (ctx) => {
          const s = situationNow(ctx.view);
          if (!offersFor(s, cfg, terrain).some((offer) => offer.goal === "heal")) return null;
          const now = healingPotion(ctx.view, damageFor(s).damage);
          return now === undefined ? null : ctx.act.quaff(now.handle);
        });
      }
      case "cast_heal": {
        const spell = healingSpell(view, damageFor(situationNow(view)).damage);
        return once(`cast ${spell?.name ?? "a spell"}`, view, (ctx) => {
          const s = situationNow(ctx.view);
          if (!offersFor(s, cfg, terrain).some((offer) => offer.goal === "cast_heal")) return null;
          const now = healingSpell(ctx.view, damageFor(s).damage);
          return now === undefined ? null : ctx.act.cast(now.sidx);
        });
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
      case "deep_descent": {
        const scroll = pack.descent[0];
        if (scroll !== undefined) descentRead = { turn: view.turn(), depth: view.player().depth };
        return once("read Deep Descent", view, (ctx) => scroll === undefined ? null : ctx.act.read(scroll.handle));
      }
      case "retreat": {
        /* Fleeing heads for the way out of the level when one is known and
         * leads somewhere safer, and only backs up a few steps when not. */
        const flight = retreatStairs(situationNow(view), terrain, offeredWiden);
        const depth = view.player().depth;
        return stepsPlan("back away", view, (ctx, i) => {
          if (ctx.view.player().depth !== depth) return null;
          const here = ctx.view.player().grid;
          const cell = ctx.view.cell(here.x, here.y);
          if (flight !== "none" && cell !== null && terrain.isDownStair(cell.feat)) return ctx.act.descend();
          if (flight === "any" && cell !== null && terrain.isUpStair(cell.feat)) return ctx.act.ascend();
          if (flight === "none" && i >= RETREAT_STEPS) return null;
          const checked = retreatStep(situationNow(ctx.view), terrain, flight);
          if (checked === null) return null;
          const dir = directionToward(here, checked.at);
          if (dir === null) return null;
          return isClosedDoor(ctx.view, terrain, checked.at) ? ctx.act.open(dir) : ctx.act.move(dir);
        });
      }
      case "rest":
        return once("rest", view, (ctx) => safeRecovery(situationNow(ctx.view), terrain) ? ctx.act.rest() : null);
      case "wait": {
        const holdOne = (ctx: SquireContext): AgentCommand | null => {
          const incoming = damageFor(situationNow(ctx.view), ctx.view.player().grid, 2, terrain);
          if (incoming.damage !== 0 || incoming.status !== 0) return null;
          /* Holding on a shop entrance opens the shop instead of passing a turn, and a
           * rest of one turn repeats the last rest count, which may be none. */
          const here = ctx.view.player().grid;
          return terrain.isShopEntrance(ctx.view.cell(here.x, here.y)?.feat ?? -1) ? ctx.act.rest(2) : ctx.act.hold();
        };
        const depth = view.player().depth;
        if (!recallPending(view.player(), recallRead, view.turn())) return once("wait a turn", view, holdOne);
        /* A recall takes 15 to 34 player turns, and asking again after each one
         * spent a decision per turn on the same answer; the errand's own watch
         * still stops the wait for anything that comes into view. */
        return stepsPlan("wait for the recall", view, (ctx, i) =>
          i >= RECALL_HOLD_STEPS || ctx.view.player().depth !== depth || !recallPending(ctx.view.player(), recallRead, ctx.view.turn()) ? null : holdOne(ctx));
      }
      case "study": {
        const study = studyable(view, triedStudies);
        if (study === null) return once("nothing to study", view, () => null);
        /* The spell is recorded only when the study command is issued, so a plan
         * that an interruption stops before its first step does not lock the
         * spell out for the level. */
        return once("study", view, (ctx) => {
          triedStudies.add(`${String(ctx.view.player().level)}:${String(study.sidx)}`);
          return ctx.act.raw("study", { handle: study.handle, spell: study.sidx });
        });
      }
      case "wear": {
        const personaNow = personaOf();
        const tieBreakKind = personaNow?.toggles.favouredWeapons === true ? flourishesNow().favouredKind : null;
        const candidate = gearCandidates(view, tieBreakKind).find((gear) => !gear.unknown || (personaNow?.sliders.curiosity ?? 0) >= 50);
        return once(`wear ${candidate?.name ?? "gear"}`, view, (ctx) => candidate === undefined || damageFor(situationNow(ctx.view)).damage >= ctx.view.player().hp || !gearCandidates(ctx.view, personaOf()?.toggles.favouredWeapons === true ? flourishesNow().favouredKind : null).some((gear) => gear.handle === candidate.handle) ? null : ctx.act.wear(candidate.handle));
      }
      case "detect": {
        const reactive = situationNow(view).unseenDamage > 0;
        if (reactive) return once("detect", view, (ctx) => {
          const source = unseenSources(ctx.view, "detect")[0];
          return source === undefined ? null : useCommand(ctx, source);
        });
        const source = detectionSource(view);
        return once(`detect with ${source?.name ?? "a known source"}`, view, (ctx) => {
          if (source === null) return null;
          if (source.kind === "cast") return ctx.act.cast(source.sidx);
          return source.kind === "zap" ? ctx.act.zapRod(source.handle) : ctx.act.read(source.handle);
        });
      }
      case "see_invisible":
      case "light_room":
        return once(goal === "see_invisible" ? "see invisible creatures" : "light the room", view, (ctx) => {
          const source = unseenSources(ctx.view, goal)[0];
          return source === undefined ? null : useCommand(ctx, source);
        });
      case "eat": {
        const food = pack.food[0];
        return once("eat", view, (ctx) => (food === undefined ? null : ctx.act.eat(food.handle)));
      }
      case "pick_up":
        return once("pick up", view, (ctx) => ctx.act.pickup());
      case "fetch":
        return (() => {
          const saving = savingFor(view);
          const loot = floorTarget(view, terrain, saving, personaOf());
          if (loot === null) return once("nothing to fetch", view, () => null);
          let grabbed = false;
          return stepsPlan("fetch item", view, (ctx) => {
            if (grabbed || !stillWorthIt(ctx.view, loot, saving, personaOf())) return null;
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
        return view.player().depth === 0
          ? missionPlan("explore", autoexplore({ allowAwake: true, findTownStairs: true }), view)
          : (() => { const wide = offeredWiden; return stepsPlan("explore", view, (ctx) => journey.explore(ctx, wide)); })();
      case "leave_level": {
        /* The journey reroutes the walk to its own exit, often the up stairs, so the label names the stairs it will take. */
        const way = journey.exitWay(view) ?? (leaveStep(situationNow(view), terrain)?.down === true ? "down" : null);
        return stepsPlan(way === "down" ? "take the stairs down" : way === "up" ? "take the stairs up" : "take the nearest stairs", view, (ctx) => {
          const here = ctx.view.player();
          if (here.depth !== view.player().depth) return null;
          const cell = ctx.view.cell(here.grid.x, here.grid.y);
          if (cell !== null && terrain.isDownStair(cell.feat) && missingPreparation(ctx.view, here.depth + 1).length === 0) return ctx.act.descend();
          if (cell !== null && terrain.isUpStair(cell.feat)) return ctx.act.ascend();
          const checked = leaveStep(situationNow(ctx.view), terrain);
          if (checked === null) return null;
          const dir = directionToward(here.grid, checked.at);
          if (dir === null) return null;
          return isClosedDoor(ctx.view, terrain, checked.at) ? ctx.act.open(dir) : ctx.act.move(dir);
        });
      }
      case "close_door":
        return once("close a door", view, (ctx) => {
          const s = situationNow(ctx.view);
          if (s.breederExit !== true) return null;
          const at = closeDoorStep(s, terrain);
          const dir = at === null ? null : directionToward(ctx.view.player().grid, at);
          return dir === null ? null : ctx.act.close(dir);
        });
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
      case "take_position": {
        /* Step along the route the offer's check priced, worked out once and
         * replayed step by step. A step that now costs more than standing
         * still ends the plan rather than walking into a worse spot. */
        let route: readonly Loc[] | null = null;
        let waited = false;
        let started = false;
        return stepsPlan("step to a defensible square", view, (ctx) => {
          const s = situationNow(ctx.view);
          const at = ctx.view.player().grid;
          if (isChokeSquare(s, terrain, at)) {
            /* Standing in the spot: one wait lets a creature that can walk
             * come to us. With one already adjacent, or none that can close
             * in, the plan ends so the next decision fights. */
            if (waited) return null;
            const adjacent = s.awake.some((m) => steps(m.grid, at) <= 1);
            const closing = s.awake.some((m) => !m.raceFlags.includes("NEVER_MOVE"));
            if (adjacent || !closing) return null;
            waited = true;
            return ctx.act.hold();
          }
          if (route === null) {
            const target = bestChokeSpot(s, terrain);
            if (target === null) return null;
            route = target.route;
          }
          const index = route.findIndex((cell) => key(cell) === key(at));
          /* The route starts beside the character. Pushed off it after that,
           * the plan ends and the next decision prices the new square. */
          const next = index >= 0 ? route[index + 1] : !started && route[0] !== undefined && steps(at, route[0]) === 1 ? route[0] : undefined;
          if (next === undefined) return null;
          if (!isWalkable(ctx.view, terrain, next) && !isClosedDoor(ctx.view, terrain, next)) return null;
          const ahead = damageFor(s, next, 1, terrain);
          const here = damageFor(s, at, 1, terrain);
          if (ahead.damage > here.damage || ahead.status > here.status) return null;
          const dir = directionToward(at, next);
          if (dir === null) return null;
          if (isClosedDoor(ctx.view, terrain, next)) return ctx.act.open(dir);
          started = true;
          return ctx.act.move(dir);
        });
      }
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

  function grudgesNow(): readonly Feeling[] {
    return options.grudges?.() ?? [];
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
    const sighted = view.monsters().filter((m) => m.visible).map((m) => m.race);
    const pursued = nudgePursuits(nudgeAims(weighted, digest.offers, persona.sliders.ambition, riskCeiling(persona)), digest.offers, options.strategy?.().pursuits ?? [], view, riskCeiling(persona), descentEscapes(view, badFeeling !== null));
    const felt = nudgeGrudges(pursued, digest.offers, grudgesNow(), sighted, riskCeiling(persona));
    const grounded = nudgeGrounds(felt, digest.offers, flourishesNow(), view, persona, riskCeiling(persona));
    const cursed = nudgeCursedGround(grounded, options.familyFlourishes?.() ?? emptyFamilyFlourishes(), view, persona, riskCeiling(persona));
    const unseen = nudgeUnseen(cursed, digest.offers, persona, situationNow(view).unseenDamage, view.player().hp, riskCeiling(persona));
    const positioned = nudgePosition(unseen, digest.offers, persona);
    const nudged = holdDescent(positioned, options.strategy?.().aims ?? [], view, badFeeling !== null, spent);
    const floor = applySafetyFloor(nudged, risk, riskCeiling(persona), persona.quirks.deathwish.on);
    const pick = pickTop(floor.dist) ?? advice;
    return record(pick, { best: best.probabilities, inCharacter: inChar, blended: floor.dist, strength, removed: floor.removed });
  }

  /**
   * Moments that don't need the model: upkeep with nothing awake in sight, a
   * single option the persona's risk ceiling allows, and a situation the model
   * answered within the last few turns.
   */
  function reflexFor(offers: readonly Offer[], persona: Persona | null, situation: string, turn: number, passes: ReadonlySet<string>, s: Situation): { readonly goal: Goal; readonly why: string } | null {
    if (options.reflex === false) return null;
    const incoming = damageFor(s).damage;
    const viable = offers.filter((offer) => SURVIVAL_GOALS.has(offer.goal) && (offer.survival ?? 0) > 0 &&
      !(offer.goal === "retreat" && stairsUnderfoot(s, terrain) && offers.some((other) => other.goal === "leave_level")));
    if (incoming > 0 && incoming >= s.view.player().hp && viable.length === 1) return { goal: viable[0]!.goal, why: viable[0]!.uncertain === true ? "the only feasible immediate escape" : "the only immediate survival option" };
    const routine = ROUTINE.map((goal) => offers.find((o) => o.goal === goal && o.routine === true)).find((o) => o !== undefined);
    /* A wait that competes with other options is the persona's call, drawn from its Patience slider. */
    if (routine !== undefined) {
      /* With no persona there is no Patience to draw from, so the wait stays the routine it always was. */
      if (routine.goal !== "wait" || byRules || persona === null || !waitCompetes(offers)) return { goal: routine.goal, why: "routine upkeep" };
      if (rng() < persona.sliders.patience / 100) return { goal: "wait", why: "routine upkeep" };
    }
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

  function ownChoice(digest: GoalDigest, view: AgentView): Choice {
    const s = situationNow(view);
    const persona = personaOf();
    const preferred = proceduralPick(digest.offers, s.hpShare);
    const probabilities = Object.fromEntries(digest.offers.map((offer) => [offer.goal, (offer.goal === preferred ? 2 : 1) / (1 + offer.risk * 8)]));
    if (s.unseenDamage > 0 && persona !== null) {
      const bold = persona.sliders.boldness / 100;
      for (const offer of digest.offers) {
        if (["swing_unseen", "cast_area", "unseen_wand"].includes(offer.goal)) probabilities[offer.goal] = (probabilities[offer.goal] ?? 0) * (1 + bold * 4);
        if (["detect", "see_invisible", "light_room", "unseen_staff", "unseen_rod"].includes(offer.goal)) probabilities[offer.goal] = (probabilities[offer.goal] ?? 0) * (1 + (1 - bold) * 4);
        if (persona.quirks.cowardice.on && ["leave_level", "retreat", "phase", "teleport"].includes(offer.goal)) probabilities[offer.goal] = (probabilities[offer.goal] ?? 0) * 16;
      }
    }
    const answer: Answer & { type: "choice" } = { type: "choice", choice: preferred ?? digest.offers[0]?.goal ?? "wait", confidence: 1, probabilities };
    const picked = decide(answer, undefined, digest, { goal: answer }, view);
    const offer = digest.offers.find((offer) => offer.goal === picked) ?? [...digest.offers].sort((a, b) => a.risk - b.risk)[0];
    if (offer === undefined) return { plan: build("step_aside", view) };
    digest.trace ??= { best: probabilities, inCharacter: null, blended: probabilities, strength: 0, removed: [], advice: answer.choice, pick: offer.goal };
    options.orders?.decided(offer.goal, view);
    return { plan: noteStalls(offer.goal, build(offer.goal, view), view.turn()) };
  }

  /* True while Squire picks by its own rules, which keep today's reflexes. */
  let byRules = false;

  const planner: Planner<GoalDigest> = {
    rules(view, reason, stuck = false) {
      if (stuck) {
        lastAnswer = null;
        for (const goal of sameTurn.keys()) stalled.set(goal, view.turn());
      }
      byRules = true;
      let question: ReturnType<typeof planner.ask>;
      try {
        question = planner.ask(view);
      } finally {
        byRules = false;
      }
      if ("handBack" in question || "reflex" in question) return question;
      const choice = ownChoice(question.context, view);
      if ("handBack" in choice) return choice;
      const goal = question.context.trace?.pick ?? question.context.offers[0]?.goal ?? "wait";
      return { reflex: reason, plan: choice.plan, context: question.context, answers: { goal: { type: "choice", choice: goal, confidence: 1, probabilities: { [goal]: 1 } } } };
    },
    ask(view) {
      view = flourishView(view);
      const persona = personaOf();
      const player = view.player();
      if (player.depth > 0) visitedShops.clear();
      if (player.dead || player.winner) return { handBack: player.dead ? "The character has died." : "The character has won." };
      noteSeen(view);
      noteFeeling(view);
      const s = situationNow(view, true);
      const turn = view.turn();
      for (const [goal, at] of stalled) if (at !== turn) stalled.delete(goal);
      const here = whereNow(view);
      for (const [goal, r] of refused) if (r.where !== here || turn - r.turn > REFUSAL_HOLD_TURNS) refused.delete(goal);
      const newLevel = decisionDepth !== player.depth;
      decisionDepth = player.depth;
      const widen = s.hpShare < 0.35 || (s.awake.length > 0 && player.hp <= player.maxHp * cfg.retreatFraction);
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
      const descending = descentRead !== null && descentRead.depth === player.depth && turn - descentRead.turn >= 0 && turn - descentRead.turn <= DEEP_DESCENT_WAIT_TURNS;
      const usable = (offer: Offer) => !(descending && offer.goal === "deep_descent") && !stalled.has(offer.goal) && !refused.has(offer.goal) && (sameTurn.get(offer.goal) ?? 0) < SAME_TURN_PLANS;
      const base = offersFor(s, cfg, terrain, persona, visitedShops, triedStudies, newLevel, recalling, widen, saving, badFeeling, aims, persona === null ? [] : grudgesNow(), flourishesNow(), options.strategy?.().storeMemory, options.strategy?.().homeStock);
      const steered = options.strategy === undefined ? base : steerOffers(base, view, options.strategy(), { recallActive: recalling, tripRisk: Math.max(0.02, exposure(s)) }, (goal, criteria, risk) => ({ goal, criteria, risk }));
      const chosenHome = options.townCall?.() ?? null;
      const offered = journey.apply(steered, view, persona, visitedShops, recalling, false, chosenHome);
      let offers = offered.filter(usable);
      /* Everything tried this turn came to nothing, cornered in a corridor
       * perhaps. Letting a turn pass changes the situation where asking again
       * would not. */
      if (offers.length === 0 && offered.length > 0 && (!recalling || journey.safeDelay(view)) && damageFor(s, player.grid, 2, terrain).damage === 0 && damageFor(s).status === 0 && !stalled.has("wait") && !refused.has("wait") && (sameTurn.get("wait") ?? 0) < SAME_TURN_PLANS) {
        offers = [{ goal: "wait", criteria: "Wait a turn; nothing else on offer can be done from here right now.", risk: exposure(s) }];
      }
      if (offers.length === 0) {
        const tried = offered.map((o) => o.goal);
        log(`goal: nothing to offer (light ${String(player.light)}, blind ${String(player.status.blind)}, confused ${String(player.status.confused)}, offered: ${tried.join(", ") || "none"}, stalled: ${[...stalled.keys()].join(", ") || "none"}, refused: ${[...refused.keys()].join(", ") || "none"})`);
        const reason = journey.blocked(view) ?? nothingToDo(view, tried);
        offeredWiden = true;
        const wider = offersFor(s, cfg, terrain, persona, visitedShops, triedStudies, newLevel, recalling, true, saving, badFeeling, aims);
        if (reachableFrontier(view, terrain) && !wider.some((o) => o.goal === "explore")) wider.push({ goal: "explore", criteria: "Explore reachable unknown ground to earn experience at this depth.", risk: exposure(s) + 0.02 });
        if (player.depth === 0 && cfg.descend && reachableStairs(view, terrain) && !wider.some((o) => o.goal === "descend")) wider.push({ goal: "descend", criteria: "Walk to the stairs and earn experience and gold on dungeon level 1.", risk: exposure(s) });
        offers = journey.apply(wider, view, persona, visitedShops, recalling, true, chosenHome).filter(usable);
        if (offers.length === 0) {
          if (neighbours(player.grid).some((grid) => isWalkable(view, terrain, grid) && !standingOnHarm(view, terrain, grid) && damageFor(s, grid, 1, terrain).damage < player.hp)) offers.push({ goal: "step_aside", criteria: "Walk one step onto safe ground away from visible creatures.", risk: exposure(s) });
          if (safeRecovery(s, terrain)) offers.push({ goal: "wait", criteria: "Wait a turn for the situation to change.", risk: 0.02 });
          if (offers.length === 0 && player.status.afraid === 0) offers.push({ goal: "swing_unseen", criteria: "Swing around the character while looking for a way out.", risk: exposure(s) });
          if (offers.length === 0) offers.push({ goal: "endure", criteria: "Wait one turn for fear or another condition to pass. No checked escape or usable attack remains; another hit could kill the character.", risk: exposure(s), survival: player.hp - damageFor(s).damage, uncertain: true });
        }
        log(`goal: Squire widens its choices. ${reason}`);
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
      const feelings = persona === null ? [] : grudgesNow();
      const creatureLines = seen.map((m) => {
        const rating = assessThreat(m, player, s.awake, view, s.dreaded, terrain, options.speedEnergy);
        const real = rating.band;
        const feeling = feelingToward(feelings, m.race);
        const seenAs = persona === null ? real : fearedBand(shiftThreat(real, THREAT_BANDS.length, persona, rng), THREAT_BANDS.length, feeling);
        if (seenAs !== real) believed.push(`the ${m.race} is ${THREAT_BANDS[seenAs] ?? "deadly"}`);
        if (feeling !== undefined) {
          believed.push(feelingBelief(feeling));
          if (persona !== null && !grudgeNoticed.has(m.id)) {
            grudgeNoticed.add(m.id);
            log(feelingLog(persona.name, feeling));
          }
        }
        const tags = [m.asleep ? "asleep" : "", m.afraid ? "afraid" : "", m.raceFlags.includes("UNIQUE") ? "unique" : "", m.speed > player.speed ? "faster than the character" : ""]
          .filter((t) => t !== "")
          .join(", ");
        return { race: m.race, band: THREAT_BANDS[real] ?? "deadly", ...(rating.description === null ? {} : { capability: rating.description }), away: steps(player.grid, m.grid), tags };
      });

      const creatures = seen.length === 0 ? "No creatures in sight." : groupLines(creatureLines);
      const passes = options.orders?.passes(view) ?? new Set<string>();
      /* What the orders and the persona's ceiling say is part of the situation: a new order or a lower ceiling makes the last answer stale. */
      const situation = JSON.stringify([
        player.depth, healthBand(player.hp, player.maxHp), creatures, statusOf(view, canRead(view)), unexplored, stairs,
        player.hp, player.sp, player.speed, player.grid, s.threats.map((m) => [m.id, m.grid, m.speed, m.hp]), s.unseenDamage,
        hungry(view), offers.map((o) => [o.goal, o.risk, o.survival, o.uncertain]).sort(),
        options.orders?.revision(view) ?? "", [...passes].sort(), persona === null ? null : [riskCeiling(persona), persona.quirks.deathwish.on], flourishLines(flourishesNow(), persona),
      ]);
      const reflex = reflexFor(offers, persona, situation, turn, passes, s);
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
            incoming: `Up to ${String(damageFor(s, player.grid, 1, terrain).damage)} HP damage in one action and ${String(damageFor(s, player.grid, 2, terrain).damage)} in two. Status danger ${String(damageFor(s).status)}; uncertainty ${String(damageFor(s).uncertainty)}. These are conservative bounds, not death probabilities.`,
            ground: standingOnHarm(view, terrain, player.grid) ? "The ground here is hurting the character." : "Safe ground.",
            level: `${unexplored ? "Unexplored ground remains." : "The level is explored."} ${stairs ? "A down staircase is known." : "No down staircase is known."}`,
            status: statusOf(view, canRead(view)),
            ...(lastOutcome === null ? {} : { last: lastOutcome }),
            ...(aimNote === null ? {} : { aims: aimNote }),
            ...(orderNote === null ? {} : { orders: orderNote }),
            ...(hungry(view) ? { hunger: "The character is hungry." } : {}),
            ...swarmNote(seen),
            ...lessonsFor(view),
            ...(persona === null ? {} : { persona: { name: persona.name, ...personaState(persona, backstoryTokens), ...pursuitFacts(options.strategy?.().pursuits ?? []), ...(flourishLines(flourishesNow(), persona).length === 0 ? {} : { family: flourishLines(flourishesNow(), persona).join(" ") }), ...(believed.length === 0 ? {} : { believes: `${believed.join("; ")}.` }) } }),
          },
          questions:
            persona === null
              ? { goal }
              : { goal, in_character: { type: "choice", instructions: inCharacterInstructions(persona), criteria }, ...(options.orders?.ask(offers, view) ?? {}) },
        },
        context: { depth: player.depth, offers, newCreatures, situation },
      };
      return question;
    },

    choose(answers: Readonly<Record<string, Answer>>, digest: GoalDigest, view: AgentView): Choice {
      view = flourishView(view);
      const answer = answers["goal"];
      if (answer?.type !== "choice") return ownChoice(digest, view);
      const pick = decide(answer, answers["in_character"], digest, answers, view);
      if (pick === "none_of_these") {
        const p = view.player();
        const s = situationNow(view);
        const hurt = p.maxHp > 0 && p.hp <= p.maxHp * cfg.retreatFraction;
        const danger = (hurt && (s.awake.length > 0 || p.status.poisoned > 0 || p.status.cut > 0)) || s.unseenDamage > 0 || s.worst >= 2 || digest.offers.some((o) => o.risk > 0.3);
        if (danger) {
          const priority: Goal[] = [
            ...(stairsUnderfoot(s, terrain) ? ["leave_level", "retreat"] as const : []),
            "teleport", "phase", "heal", "device", "cast_heal",
            ...(!immediateDanger(s) ? ["recall_town", "deep_descent", "leave_level"] as const : []),
            ...(!pinned(s) ? ["retreat"] as const : []),
            "fight", "shoot", "cast_attack", "aim_wand", "throw_oil",
          ];
          /* A refusal cannot turn survival into a loot errand, even when the persona rejected every useful action. */
          const fresh = offersFor(s, cfg, terrain, personaOf(), visitedShops, triedStudies, false, recallPending(p, recallRead, view.turn()), offeredWiden, false, null, options.strategy?.().aims ?? [], [], flourishesNow(), options.strategy?.().storeMemory, options.strategy?.().homeStock);
          const candidates = fresh.filter((offer) => priority.includes(offer.goal) && digest.offers.some((old) => old.goal === offer.goal));
          const fallback = candidates.sort((a, b) => {
            const adequate = Number((b.survival ?? 0) > 0) - Number((a.survival ?? 0) > 0);
            return adequate || a.risk - b.risk || priority.indexOf(a.goal) - priority.indexOf(b.goal);
          })[0]?.goal;
          if (fallback === undefined) return ownChoice(digest, view);
          log(`goal: none fit in danger, taking the survival fallback (${fallback})`);
          return { plan: noteStalls(fallback, build(fallback, view), view.turn()) };
        }
        return ownChoice(digest, view);
      }
      const offer = digest.offers.find((o) => o.goal === pick);
      if (offer === undefined) {
        return ownChoice(digest, view);
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
      situationNow(view, false, true);
      const exiting = journey.breederExit(view);
      /* A search for the missing staircase has to run; interrupting it every step was the loop. */
      if (exiting && !(plan.label === "explore" && journey.searchingNow(view)) && ["explore", "rest", "fetch"].includes(plan.label)) return "Three awake breeders marked this level for departure.";
      const watched = plan as Partial<WatchedPlan> & { settle?: (v: AgentView) => void };
      watched.settle?.(view);
      const stopped = watched.watcher?.check(view) ?? null;
      if (stopped !== null) noteOutcome(`${plan.label} stopped: ${stopped.detail}`);
      return stopped === null ? null : stopped.detail;
    },
  };
  return planner;
}
