/**
 * The first planner: the model picks what to do next, and Squire's errand code
 * does it.
 *
 * Code works out the facts (how hurt the character is, what is awake in sight,
 * whether unexplored ground or a down staircase is known) and offers only the
 * goals that make sense right now. The model picks one, and the pick becomes a
 * plan built from the same missions and moves the procedural errands use.
 *
 * Every plan runs under a watcher. A creature coming into view, hit points
 * crossing the retreat line, a status effect or a new level drops the plan, and
 * the model is asked again about the new situation.
 */

import type { AgentActions, AgentCommand, AgentView } from "@rpgm-tools/neo-angband-core";
import type { SquireContext } from "../context.js";
import type { Mission } from "../mission.js";
import { isStop } from "../mission.js";
import type { SquireCfg } from "../settings.js";
import type { Terrain } from "../terrain.js";
import { createWatcher, type Watcher } from "../disturb.js";
import { frontiers, hasFloorObject, knownDownStairs, standingOnHarm } from "../map.js";
import { newProgress, type Progress } from "../progress.js";
import { awakeInSight, inSight, pickTarget } from "../threat.js";
import { retreatFrom, travelTo } from "../travel.js";
import { AUTOFIGHT_REACH, autofight } from "../missions/autofight.js";
import { autoexplore } from "../missions/autoexplore.js";
import { campaign } from "../missions/campaign.js";
import type { Answer, ChoiceQuestion } from "./systemone.js";
import type { Choice, Plan, Planner, Question } from "./brain.js";

/** The goals this planner can offer. */
export type Goal = "fight" | "explore" | "descend" | "retreat" | "rest" | "pick_up";

/** What each goal means, as the model reads it. */
export const GOAL_CRITERIA: Readonly<Record<Goal, string>> = Object.freeze({
  fight: "Attack the nearest creature Squire can reach, and keep fighting until it is dead or something changes.",
  explore: "Walk toward the nearest unexplored ground on this level. Not for when an awake creature is a real threat.",
  descend: "Walk to a known down staircase and take it to the next level. Not for when the character is badly hurt.",
  retreat: "Step away from the awake creatures in sight, to gain distance before they can attack.",
  rest: "Rest until hit points and mana recover. Only safe with nothing awake in sight.",
  pick_up: "Pick up the object on the floor under the character.",
});

const NONE_OF_THESE = "No offered goal fits. Squire falls back to its fixed errand order for a few steps.";

/** How many steps the fixed errand order runs when the model picks none of the goals. */
const FALLBACK_STEPS = 8;

/** How many steps a retreat plan takes before the model is asked again. */
const RETREAT_STEPS = 4;

/** A word for the character's hit points, which the model reads more reliably than a ratio. */
export function healthBand(hp: number, maxHp: number): string {
  if (maxHp <= 0) return "unknown";
  const share = hp / maxHp;
  if (share >= 0.9) return "full";
  if (share >= 0.6) return "lightly hurt";
  if (share >= 0.35) return "badly hurt";
  return "near death";
}

/**
 * How a creature compares with the character, from their levels alone. A rough
 * first cut: monster recall and damage estimates will replace it.
 */
export function threatBand(monsterLevel: number, characterLevel: number): string {
  if (monsterLevel * 2 <= characterLevel) return "an easy kill";
  if (monsterLevel <= characterLevel) return "a fair fight";
  if (monsterLevel <= characterLevel + 5) return "dangerous";
  return "deadly";
}

/** Rules of the game the model needs for this decision, in a few plain lines. */
const HANDBOOK: readonly string[] = Object.freeze([
  "Killing creatures earns experience, and experience makes the character stronger.",
  "Going deeper before the character is strong enough is a common way to die; a character should usually clear easy creatures before descending.",
  "Resting with an awake creature in sight gets interrupted, and a creature that is deadly should be escaped rather than fought.",
]);

/** The facts one decision is made from. */
export interface GoalDigest {
  readonly depth: number;
  readonly offered: readonly Goal[];
}

export interface GoalPlannerOptions {
  readonly cfg: SquireCfg;
  readonly terrain: Terrain;
  readonly log: (message: string) => void;
}

interface Built {
  readonly plan: Plan;
}

/** A plan that owns a watcher, so `trigger` can ask it. */
interface WatchedPlan extends Plan {
  readonly watcher: Watcher;
}

export function createGoalPlanner(options: GoalPlannerOptions): Planner<GoalDigest> {
  const { cfg, terrain, log } = options;

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
      stopOnAnyDamage: false,
      stopOnNewCreature: true,
      /* Already under the line: crossing it again is not news. */
      stopOnLowHealth: !hurt,
      retreatFraction: cfg.retreatFraction,
    });
  }

  /** Run a mission as a plan. The mission's own stop ends the plan. */
  function missionPlan(label: string, mission: Mission, view: AgentView, with_: SquireCfg = cfg, limit = Infinity): WatchedPlan {
    const progress = newProgress(view.player().depth);
    let begun = false;
    let done = false;
    return {
      label,
      watcher: watch(view),
      step(v, act) {
        if (done || progress.steps >= limit) return null;
        const ctx = context(v, act, progress, with_);
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

  function build(goal: Goal, view: AgentView): Built {
    switch (goal) {
      case "fight":
        return { plan: missionPlan("fight", autofight(), view, fightCfg) };
      case "explore":
        return { plan: missionPlan("explore", autoexplore(), view) };
      case "descend":
        return {
          plan: stepsPlan("take the stairs down", view, (ctx) => {
            const at = ctx.view.player().grid;
            const stairs = knownDownStairs(ctx.view, terrain);
            if (stairs.some((s) => s.x === at.x && s.y === at.y)) {
              /* One descend, then the plan is over: the next level is a new decision. */
              return ctx.view.player().depth === view.player().depth ? ctx.act.descend() : null;
            }
            const travel = travelTo(ctx, stairs);
            return travel.kind === "step" ? travel.command : null;
          }),
        };
      case "retreat":
        return {
          plan: stepsPlan("back away", view, (ctx, i) => {
            if (i >= RETREAT_STEPS) return null;
            const away = retreatFrom(ctx, awakeInSight(ctx.view.monsters()).map((m) => m.grid));
            return away.kind === "step" ? away.command : null;
          }),
        };
      case "rest":
        return { plan: stepsPlan("rest", view, (ctx, i) => (i === 0 ? ctx.act.rest() : null)) };
      case "pick_up":
        return { plan: stepsPlan("pick up", view, (ctx, i) => (i === 0 ? ctx.act.pickup() : null)) };
    }
  }

  return {
    ask(view) {
      const player = view.player();
      if (player.dead) return { handBack: "The character has died." };
      const at = player.grid;
      const monsters = view.monsters();
      const awake = awakeInSight(monsters);
      const seen = inSight(monsters);
      const target = pickTarget(monsters, at, { wakeSleepers: true, reach: AUTOFIGHT_REACH });
      const unexplored = frontiers(view, terrain).length;
      const stairs = knownDownStairs(view, terrain);
      const underfoot = hasFloorObject(view, at);

      const offered: Goal[] = [];
      if (target !== null) offered.push("fight");
      if (awake.length > 0) offered.push("retreat");
      if (awake.length === 0 && (player.hp < player.maxHp || player.sp < player.maxSp)) offered.push("rest");
      if (underfoot) offered.push("pick_up");
      if (unexplored > 0) offered.push("explore");
      if (stairs.length > 0 && cfg.descend) offered.push("descend");

      if (offered.length === 0) {
        return { handBack: "Squire can see nothing to do here: no creature to fight, nothing unexplored, and no known way down." };
      }

      const criteria: Record<string, string | null> = {};
      for (const goal of offered) criteria[goal] = GOAL_CRITERIA[goal];
      criteria["none_of_these"] = NONE_OF_THESE;
      const goal: ChoiceQuestion = {
        type: "choice",
        instructions:
          "You are playing Angband, a dungeon game where death is permanent. Which goal gives this character the best chance to survive and keep making progress?",
        criteria,
      };

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
                    .map(
                      (m) =>
                        `${m.race}: ${threatBand(m.level, player.level)}${m.asleep ? ", asleep" : ""}${m.afraid ? ", afraid" : ""}`,
                    )
                    .join("; "),
            ground: standingOnHarm(view, terrain, at) ? "The ground here is hurting the character." : "Safe ground.",
            level: `${unexplored > 0 ? "Unexplored ground remains." : "The level is explored."} ${stairs.length > 0 ? "A down staircase is known." : "No down staircase is known."}`,
          },
          questions: { goal },
        },
        context: { depth: player.depth, offered },
      };
      return question;
    },

    choose(answers: Readonly<Record<string, Answer>>, digest: GoalDigest, view: AgentView): Choice {
      const answer = answers["goal"];
      if (answer?.type !== "choice") return { handBack: "The model gave no goal." };
      const pick = answer.choice;
      if (pick === "none_of_these") {
        log("goal: none fit, following the fixed errand order");
        return { plan: missionPlan("follow the errand order", campaign(), view, cfg, FALLBACK_STEPS) };
      }
      if (!digest.offered.includes(pick as Goal)) {
        return { handBack: "The model picked a goal Squire did not offer, so the keyboard is yours." };
      }
      log(`goal: ${pick} (${Math.round((answer.probabilities[pick] ?? 0) * 100)}%)`);
      return build(pick as Goal, view);
    },

    trigger(view, plan) {
      const watched = plan as Partial<WatchedPlan>;
      const stopped = watched.watcher?.check(view) ?? null;
      return stopped === null ? null : stopped.detail;
    },
  };
}
