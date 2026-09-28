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
import { frontiers, hasFloorObject, knownDownStairs, standingOnHarm } from "../map.js";
import { newProgress, type Progress } from "../progress.js";
import { awakeInSight, inSight, pickTarget } from "../threat.js";
import { retreatFrom, travelTo } from "../travel.js";
import { AUTOFIGHT_REACH, autofight } from "../missions/autofight.js";
import { autoexplore } from "../missions/autoexplore.js";
import { campaign } from "../missions/campaign.js";
import type { Answer, ChoiceQuestion } from "./systemone.js";
import type { Choice, Plan, Planner, Question } from "./brain.js";
import { hungry, readPack, type Pack } from "./pack.js";
import type { Persona } from "../persona/persona.js";
import { applySafetyFloor, blend, jitteredStrength, pick as pickTop, riskCeiling } from "../persona/blend.js";
import { fleesFromNew, forget, mustPickUp, shiftThreat } from "../persona/quirks.js";
import { inCharacterInstructions, personaState } from "../persona/state.js";
import { lowOnSupplies, recallItem, supplyNeeds } from "../town/needs.js";
import { neededEntrances, recallPlan, townTripPlan } from "../town/plan.js";

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
  | "explore"
  | "descend"
  | "recall_town"
  | "shop"
  | "recall_dungeon";

const NONE_OF_THESE = "No offered option fits. Squire falls back to its fixed errand order for a few steps.";

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

export const THREAT_BANDS = ["an easy kill", "a fair fight", "dangerous", "deadly"] as const;
export type ThreatBand = (typeof THREAT_BANDS)[number];

/**
 * How a creature compares with the character, from their levels. Uniques count
 * one band worse than their level suggests.
 */
export function threatIndex(monster: Pick<MonsterView, "level" | "raceFlags">, characterLevel: number): number {
  let band: number;
  if (monster.level * 2 <= characterLevel) band = 0;
  else if (monster.level <= characterLevel) band = 1;
  else if (monster.level <= characterLevel + 5) band = 2;
  else band = 3;
  if (monster.raceFlags.includes("UNIQUE")) band = Math.min(3, band + 1);
  return band;
}

export function threatBand(monsterLevel: number, characterLevel: number): ThreatBand {
  return THREAT_BANDS[threatIndex({ level: monsterLevel, raceFlags: [] }, characterLevel)] ?? "deadly";
}

/** Rough chance a band kills a healthy character that stands and fights it. */
const BAND_RISK: readonly number[] = [0.03, 0.15, 0.4, 0.75];

/** Rules of the game the model needs for this decision, in a few plain lines. */
const HANDBOOK: readonly string[] = Object.freeze([
  "Killing creatures earns experience, and experience makes the character stronger.",
  "Going deeper before the character is strong enough is a common way to die; a character should usually clear easy creatures before descending.",
  "Resting with an awake creature in sight gets interrupted, and a creature that is deadly should be escaped rather than fought.",
  "Healing potions are worth drinking before hit points get too low to survive one more round, and Phase Door breaks contact for a moment while Teleportation leaves the fight entirely.",
  "Missiles, thrown oil, wands and attack spells hurt a creature before it can reach the character.",
  "When healing, escapes or food run low, Word of Recall returns the character to town to restock; another recall returns to the deepest reached dungeon level.",
]);

/** One option offered to the model. */
export interface Offer {
  readonly goal: Goal;
  /** What the option does, as the model reads it. */
  readonly criteria: string;
  /** Rough chance, 0 to 1, that this choice leads to death soon. */
  readonly risk: number;
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
  /** Filled in by `choose`. */
  trace?: PersonaTrace;
}

export interface GoalPlannerOptions {
  readonly cfg: SquireCfg;
  readonly terrain: Terrain;
  readonly log: (message: string) => void;
  /**
   * The character's persona, or a getter for it so drift during a run reaches
   * the next decision. Without one, Squire asks only for the best move.
   */
  readonly persona?: Persona | null | (() => Persona | null);
  /** Lesson lines relevant to this moment, from the character and its ancestors. */
  readonly lessons?: (view: AgentView) => readonly string[];
  /** Rescale the best-move answer from past outcomes. Never applied to the in-character answer. */
  readonly calibrate?: (probs: Readonly<Record<string, number>>) => Record<string, number>;
  /** Random draws for persona volatility and quirks. */
  readonly rng?: () => number;
  /** Most tokens of persona backstory one decision may carry, from the backend's budget. */
  readonly backstoryTokens?: number;
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
  readonly hpShare: number;
}

function situationOf(view: AgentView): Situation {
  const player = view.player();
  const monsters = view.monsters();
  const awake = awakeInSight(monsters);
  const target = pickTarget(monsters, player.grid, { wakeSleepers: true, reach: AUTOFIGHT_REACH });
  const worst = awake.reduce((max, m) => Math.max(max, threatIndex(m, player.level)), -1);
  return {
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
function fightRisk(s: Situation): number {
  const band = s.target === null ? 0 : threatIndex(s.target, s.view.player().level);
  return clamp01((BAND_RISK[band] ?? 0.75) * (0.6 + (1 - s.hpShare) * 1.4));
}

/** The death risk of doing something other than fighting while threats stay near. */
function exposure(s: Situation): number {
  if (s.worst < 0) return 0.01;
  return clamp01((BAND_RISK[s.worst] ?? 0.75) * (1 - s.hpShare) * 1.2);
}

function within(s: Situation, range: number): boolean {
  return s.target !== null && steps(s.view.player().grid, s.target.grid) <= range;
}

/** The options that apply right now, each with its description and risk. */
export function offersFor(s: Situation, cfg: SquireCfg, terrain: Terrain, persona: Persona | null = null, visited: ReadonlySet<number> = new Set()): Offer[] {
  const view = s.view;
  const player = view.player();
  const at = player.grid;
  const hurt = player.hp < player.maxHp;
  const out: Offer[] = [];
  const add = (goal: Goal, criteria: string, risk: number) => out.push({ goal, criteria, risk: clamp01(risk) });

  const needs = supplyNeeds(view, s.pack, persona);
  const recall = recallItem(view);
  const townRisk = s.awake.some((m) => steps(at, m.grid) <= 3) ? Math.max(0.02, BAND_RISK[s.worst] ?? 0.75) : 0.02;
  if (player.depth > 0 && recall !== null && lowOnSupplies(needs)) {
    const low = needs.filter((n) => n.kind !== "recall" && n.have < (n.kind === "healing" ? 2 : n.kind === "phase" ? 1 : n.hungry ? 1 : 0));
    add("recall_town", `Read Word of Recall to return to town and restock. The character is low on ${low.map((n) => n.name).join(", ")}.`, townRisk);
  }
  if (player.depth === 0) {
    const shops = neededEntrances(view, terrain, persona, visited);
    if (shops.length > 0) {
      const missing = needs.filter((n) => n.have < n.want).map((n) => n.name);
      add("shop", `Visit the shops for ${missing.join(", ") || "surplus gear sales"}.`, townRisk);
    } else if (recall !== null && player.maxDepth > 1) {
      add("recall_dungeon", `Read Word of Recall to return to the deepest level reached, ${String(player.maxDepth * 50)} ft.`, townRisk);
    }
  }

  if (s.target !== null) {
    add("fight", `Close with the ${s.target.race} and fight it in melee until it dies or something changes.`, fightRisk(s));
    const ranged = within(s, MISSILE_RANGE);
    if (ranged && s.pack.launcher && s.pack.ammo[0] !== undefined) {
      add("shoot", `Fire ${s.pack.ammo[0].name} at the ${s.target.race} with the equipped launcher.`, fightRisk(s) * 0.7);
    }
    if (ranged && s.pack.oil[0] !== undefined) {
      add("throw_oil", `Throw a flask of oil at the ${s.target.race}; it burns for good damage early in the game.`, fightRisk(s) * 0.7);
    }
    if (ranged && s.pack.attackWand[0] !== undefined) {
      add("aim_wand", `Aim ${s.pack.attackWand[0].name} at the ${s.target.race}.`, fightRisk(s) * 0.65);
    }
    const spell = s.pack.attackSpell[0];
    if (ranged && spell !== undefined) {
      add("cast_attack", `Cast ${spell.name} at the ${s.target.race} (${String(spell.fail)}% chance to fail).`, fightRisk(s) * 0.65);
    }
  }
  if (hurt && s.pack.heal[0] !== undefined) {
    add("heal", `Drink ${s.pack.heal[0].name} to restore hit points.`, exposure(s) * 0.5);
  }
  const healSpell = s.pack.healSpell[0];
  if (hurt && healSpell !== undefined) {
    add("cast_heal", `Cast ${healSpell.name} to restore hit points (${String(healSpell.fail)}% chance to fail).`, exposure(s) * 0.6);
  }
  if (s.awake.length > 0) {
    if (s.pack.phase[0] !== undefined || s.pack.escapeSpell[0] !== undefined) {
      const how = s.pack.phase[0]?.name ?? s.pack.escapeSpell[0]?.name ?? "";
      add("phase", `Use ${how}: a short random teleport that breaks contact for a moment.`, exposure(s) * 0.4);
    }
    if (s.pack.teleport[0] !== undefined) {
      add("teleport", `Use ${s.pack.teleport[0].name} to escape far from every creature in sight.`, exposure(s) * 0.2);
    }
    add("retreat", "Step away from the awake creatures in sight, to gain distance before they can attack.", exposure(s) * 0.8);
  }
  if (s.awake.length === 0 && (hurt || player.sp < player.maxSp)) {
    add("rest", "Rest until hit points and mana recover.", 0.01);
  }
  if (hungry(view) && s.pack.food[0] !== undefined) {
    add("eat", `Eat ${s.pack.food[0].name}; the character is hungry.`, exposure(s));
  }
  if (hasFloorObject(view, at)) add("pick_up", "Pick up the object on the floor under the character.", exposure(s));
  if (frontiers(view, terrain).length > 0) {
    add("explore", "Walk toward the nearest unexplored ground on this level.", exposure(s) + 0.02);
  }
  if (knownDownStairs(view, terrain).length > 0 && cfg.descend &&
    (player.depth > 0 || (recall === null && (player.gold <= 0 || neededEntrances(view, terrain, persona, visited).length === 0)))) {
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
  /* Goals whose last plan ended without a command, keyed to the game turn it
   * ended on. Offering one again before time moves would repeat the same empty
   * plan, so it is left out until the turn changes. */
  const stalled = new Map<Goal, number>();

  function noteStalls(goal: Goal, plan: Plan): Plan {
    let issued = 0;
    const step: Plan["step"] = (v, act) => {
      const command = plan.step(v, act);
      if (command !== null) issued += 1;
      else if (issued === 0) stalled.set(goal, v.turn());
      return command;
    };
    return { ...plan, step };
  }

  /* A fight the model chose may wake a sleeper: the state says which creatures
   * are asleep, so waking one is part of the choice. */
  const fightCfg: SquireCfg = { ...cfg, wakeSleepers: true };

  function context(view: AgentView, act: AgentActions, progress: Progress, with_: SquireCfg = cfg): SquireContext {
    return { view, act, terrain, cfg: with_, progress, log };
  }

  function watch(view: AgentView): Watcher {
    const player = view.player();
    const hurt = player.maxHp > 0 && player.hp <= player.maxHp * cfg.retreatFraction;
    return createWatcher(view, {
      /* Already under the line: crossing it again is not news, but every
       * further blow is, so the model is asked again after each one. */
      stopOnAnyDamage: hurt,
      stopOnNewCreature: true,
      stopOnLowHealth: !hurt,
      retreatFraction: cfg.retreatFraction,
    });
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
    const missionCfg = hurt ? { ...with_, stopOnLowHealth: false } : with_;
    let begun = false;
    let done = false;
    return {
      label,
      watcher: watch(view),
      step(v, act) {
        if (done || progress.steps >= limit) return null;
        const ctx = context(v, act, progress, missionCfg);
        if (!begun) {
          begun = true;
          const declined = mission.begin(ctx);
          if (declined !== null) {
            done = true;
            log(`${label}: ${declined.detail}`);
            return null;
          }
        }
        const decision = mission.step(ctx);
        if (isStop(decision)) {
          done = true;
          log(`${label}: ${decision.stop.detail}`);
          return null;
        }
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
  function atTarget(label: string, view: AgentView, command: (ctx: SquireContext) => AgentCommand): WatchedPlan {
    return once(label, view, (ctx) => {
      const s = situationOf(ctx.view);
      if (s.target === null) return null;
      if (!ctx.act.setTargetMonster(s.target.id)) return null;
      return command(ctx);
    });
  }

  function build(goal: Goal, view: AgentView): Plan {
    const pack = readPack(view);
    switch (goal) {
      case "recall_town":
      case "recall_dungeon": {
        const item = recallItem(view);
        return item === null ? once("no recall scroll", view, () => null) : watched(recallPlan(item), view);
      }
      case "shop":
        return watched(townTripPlan(terrain, personaOf(), visitedShops), view);
      case "fight":
        return missionPlan("fight", autofight(), view, fightCfg);
      case "shoot": {
        const ammo = pack.ammo[0];
        return atTarget("shoot", view, (ctx) => ctx.act.fire(ammo?.handle ?? 0));
      }
      case "throw_oil": {
        const oil = pack.oil[0];
        return atTarget("throw oil", view, (ctx) => ctx.act.throw(oil?.handle ?? 0));
      }
      case "aim_wand": {
        const wand = pack.attackWand[0];
        return atTarget(`aim ${wand?.name ?? "a wand"}`, view, (ctx) => ctx.act.aimWand(wand?.handle ?? 0));
      }
      case "cast_attack": {
        const spell = pack.attackSpell[0];
        return atTarget(`cast ${spell?.name ?? "a spell"}`, view, (ctx) => ctx.act.cast(spell?.sidx ?? 0));
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
      case "retreat":
        return stepsPlan("back away", view, (ctx, i) => {
          if (i >= RETREAT_STEPS) return null;
          const away = retreatFrom(ctx, awakeInSight(ctx.view.monsters()).map((m) => m.grid));
          return away.kind === "step" ? away.command : null;
        });
      case "rest":
        return once("rest", view, (ctx) => ctx.act.rest());
      case "eat": {
        const food = pack.food[0];
        return once("eat", view, (ctx) => (food === undefined ? null : ctx.act.eat(food.handle)));
      }
      case "pick_up":
        return once("pick up", view, (ctx) => ctx.act.pickup());
      case "explore":
        /* The model saw every awake creature before choosing to explore. */
        return missionPlan("explore", autoexplore({ allowAwake: true }), view);
      case "descend":
        return stepsPlan("take the stairs down", view, (ctx) => {
          const at = ctx.view.player().grid;
          const stairs = knownDownStairs(ctx.view, terrain);
          if (stairs.some((s) => s.x === at.x && s.y === at.y)) {
            /* One descend, then the plan is over: the next level is a new decision. */
            return ctx.view.player().depth === view.player().depth ? ctx.act.descend() : null;
          }
          const travel = travelTo(ctx, stairs);
          return travel.kind === "step" ? travel.command : null;
        });
    }
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
  function decide(raw: Answer & { type: "choice" }, inCharacter: Answer | undefined, digest: GoalDigest): string {
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
    const floor = applySafetyFloor(blended, risk, riskCeiling(persona), persona.quirks.deathwish.on);
    const pick = pickTop(floor.dist) ?? advice;
    return record(pick, { best: best.probabilities, inCharacter: inChar, blended: floor.dist, strength, removed: floor.removed });
  }

  return {
    ask(view) {
      const persona = personaOf();
      const player = view.player();
      if (player.depth > 0) visitedShops.clear();
      if (player.dead) return { handBack: "The character has died." };
      const s = situationOf(view);
      const turn = view.turn();
      for (const [goal, at] of stalled) if (at !== turn) stalled.delete(goal);
      const offers = offersFor(s, cfg, terrain, persona, visitedShops).filter((offer) => !stalled.has(offer.goal));
      if (offers.length === 0) {
        return { handBack: "Squire can see nothing to do here: no creature to fight, nothing unexplored, and no known way down." };
      }

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
      const unexplored = frontiers(view, terrain).length > 0;
      const stairs = knownDownStairs(view, terrain).length > 0;

      const question: Question<GoalDigest> = {
        request: {
          state: {
            rules: HANDBOOK.join(" "),
            character: `Level ${String(player.level)} ${player.race} ${player.cls}, on dungeon level ${String(player.depth)} (deepest reached ${String(player.maxDepth)}).`,
            health: `${healthBand(player.hp, player.maxHp)}: ${String(player.hp)} of ${String(player.maxHp)} hit points`,
            ...(player.maxSp > 0 ? { mana: `${String(player.sp)} of ${String(player.maxSp)}` } : {}),
            creatures:
              seen.length === 0
                ? "No creatures in sight."
                : seen
                    .map((m) => {
                      const real = threatIndex(m, player.level);
                      /* A persona's optimism or delusion changes what the character believes, not the safety floor. */
                      const seenAs = persona === null ? real : shiftThreat(real, THREAT_BANDS.length, persona, rng);
                      const band = THREAT_BANDS[seenAs] ?? "deadly";
                      const tags = [m.asleep ? "asleep" : "", m.afraid ? "afraid" : "", m.raceFlags.includes("UNIQUE") ? "unique" : ""]
                        .filter((t) => t !== "")
                        .join(", ");
                      const away = steps(player.grid, m.grid);
                      return `${m.race}: ${band}, ${String(away)} steps away${tags === "" ? "" : `, ${tags}`}`;
                    })
                    .join("; "),
            ground: standingOnHarm(view, terrain, player.grid) ? "The ground here is hurting the character." : "Safe ground.",
            level: `${unexplored ? "Unexplored ground remains." : "The level is explored."} ${stairs ? "A down staircase is known." : "No down staircase is known."}`,
            ...(hungry(view) ? { hunger: "The character is hungry." } : {}),
            ...lessonsFor(view),
            ...(persona === null ? {} : { persona: { name: persona.name, ...personaState(persona, backstoryTokens) } }),
          },
          questions:
            persona === null
              ? { goal }
              : { goal, in_character: { type: "choice", instructions: inCharacterInstructions(persona), criteria } },
        },
        context: { depth: player.depth, offers, newCreatures },
      };
      return question;
    },

    choose(answers: Readonly<Record<string, Answer>>, digest: GoalDigest, view: AgentView): Choice {
      const answer = answers["goal"];
      if (answer?.type !== "choice") return { handBack: "The model gave no goal." };
      const pick = decide(answer, answers["in_character"], digest);
      if (pick === "none_of_these") {
        log("goal: none fit, following the fixed errand order");
        return { plan: missionPlan("follow the errand order", campaign(), view, cfg, FALLBACK_STEPS) };
      }
      const offer = digest.offers.find((o) => o.goal === pick);
      if (offer === undefined) {
        return { handBack: "The model picked an option Squire did not offer, so the keyboard is yours." };
      }
      const trace = digest.trace;
      if (trace !== undefined && trace.pick !== trace.advice) {
        log(`goal: ${pick}, against advice (${trace.advice})${trace.quirk === undefined ? "" : `: ${trace.quirk}`}`);
      } else {
        log(`goal: ${pick} (${String(Math.round((answer.probabilities[pick] ?? 0) * 100))}%)`);
      }
      return { plan: noteStalls(offer.goal, build(offer.goal, view)) };
    },

    trigger(view, plan) {
      const watched = plan as Partial<WatchedPlan>;
      const stopped = watched.watcher?.check(view) ?? null;
      return stopped === null ? null : stopped.detail;
    },
  };
}
