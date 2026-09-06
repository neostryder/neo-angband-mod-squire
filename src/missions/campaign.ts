/**
 * Campaign: the long errand, which carries the character instead of running one
 * short job.
 *
 * This is Squire at its least distinctive on purpose. A mod whose whole argument
 * is that bounded actions are better than an autoplayer still has to be able to
 * play, or the argument is untested: the short errands are made of the same
 * decisions, and if those decisions cannot carry a character down a floor they
 * were not going to clear a room either. So the campaign exists as the proof,
 * and it is off by default because it is not the reason to install this.
 *
 * THE LADDER, in strict order, one rung per decision:
 *
 *   1. Survive. Below the retreat line, back away from whatever is awake and in
 *      sight, or rest when nothing is.
 *   2. Fight. Something awake and in reach: close with it and hit it.
 *   3. Collect. Something underfoot on a grid not already picked over: take it.
 *   4. Explore. Unexplored ground that can be reached: walk toward it.
 *   5. Descend. The floor is walked out and a down staircase is known: use it.
 *   6. Nothing left. Stop, and hand the keyboard back.
 *
 * HOW THIS DIFFERS FROM A FAITHFUL AUTOPLAYER'S LADDER. A faithful one weighs
 * every rung against every other on a single danger number and will happily
 * spend fifty decisions shopping, resting and re-equipping before it takes a
 * step. This one is a strict priority order with no shopping, no equipment
 * decisions, no spellcasting and no stair-scumming, and it descends the moment
 * the floor is done rather than when a depth model says it is ready. It is a
 * simpler player and it dies sooner. What it is instead is legible: every
 * decision it makes can be traced to one rung.
 *
 * THE CAMPAIGN DOES NOT STOP ON DISTURBANCE. That is the entire difference
 * between it and the two short errands, and it is why it needs its own explicit
 * consent rather than being what happens when both short errands are switched
 * off.
 */

import type { SquireContext } from "../context.js";
import type { Decision, Mission, Stop } from "../mission.js";
import { issue, stop } from "../mission.js";
import { adjacent } from "../grid.js";
import { advance, alreadyCollected, markCollected } from "../progress.js";
import { awakeInSight, pickTarget } from "../threat.js";
import { frontiers, hasFloorObject, knownDownStairs, standingOnHarm } from "../map.js";
import { retreatFrom, stepIntoDark, strike, travelTo } from "../travel.js";

/** How far the campaign will walk to reach a fight. */
const FIGHT_REACH = 20;

/** Build the long errand. */
export function campaign(): Mission {
  let lastDepth: number | null = null;

  return {
    id: "campaign",
    label: "play on until I take the keyboard back",

    begin(): Stop | null {
      return null;
    },

    step(ctx: SquireContext): Decision {
      const player = ctx.view.player();
      const at = player.grid;
      advance(ctx.progress, at);

      if (player.dead) return stop("dead", "The character died.");

      /* A new floor is a new set of everything this errand remembers. Without
       * this the grids picked over on the last floor would still read as picked
       * over here, and the idle count carried across a staircase would report a
       * wedge on the first decision after arriving. */
      if (lastDepth !== null && player.depth !== lastDepth) {
        ctx.progress.collected.clear();
        ctx.progress.idle = 0;
      }
      lastDepth = player.depth;

      const hurt = player.maxHp > 0 && player.hp <= player.maxHp * ctx.cfg.retreatFraction;
      const awake = awakeInSight(ctx.view.monsters());

      /* 0. Standing somewhere that is hurting the character outranks the whole
       * ladder: no other rung is worth a turn while the ground is doing damage. */
      if (standingOnHarm(ctx.view, ctx.terrain, at)) {
        const away = retreatFrom(ctx, [at]);
        if (away.kind === "step") return issue(away.command);
      }

      /* 1. Survive. */
      if (hurt) {
        if (awake.length > 0) {
          const away = retreatFrom(ctx, awake.map((monster) => monster.grid));
          if (away.kind === "step") return issue(away.command);
          /* Cornered. Falling through to the fight rung is the right answer:
           * a character with nowhere to go fights, and standing still while
           * something hits it is the one option that is never better. */
        } else {
          return issue(ctx.act.rest());
        }
      }

      /* 2. Fight. */
      const target = pickTarget(ctx.view.monsters(), at, {
        wakeSleepers: ctx.cfg.wakeSleepers,
        reach: FIGHT_REACH,
      });
      if (target !== null) {
        if (adjacent(at, target.grid)) {
          const blow = strike(ctx, target.grid);
          if (blow !== null) return issue(blow);
        } else {
          const travel = travelTo(ctx, [target.grid]);
          if (travel.kind === "step") return issue(travel.command);
        }
      }

      /* 3. Collect. Underfoot only - see src/map.ts for why nothing routes
       * toward an object it can see from across the room. */
      if (ctx.cfg.collect && !alreadyCollected(ctx.progress, at) && hasFloorObject(ctx.view, at)) {
        markCollected(ctx.progress, at);
        return issue(ctx.act.pickup());
      }

      /* 4. Explore. */
      const goals = frontiers(ctx.view, ctx.terrain);
      if (goals.length > 0 && ctx.progress.idle < ctx.cfg.idleSteps) {
        const travel = travelTo(ctx, goals);
        if (travel.kind === "step") return issue(travel.command);
        if (travel.kind === "arrived") {
          const into = stepIntoDark(ctx, at);
          if (into !== null) return issue(into);
        }
      }

      /* 5. Descend. */
      if (ctx.cfg.descend) {
        const stairs = knownDownStairs(ctx.view, ctx.terrain);
        if (stairs.some((grid) => grid.x === at.x && grid.y === at.y)) {
          return issue(ctx.act.descend());
        }
        if (stairs.length > 0 && ctx.progress.idle < ctx.cfg.idleSteps) {
          const travel = travelTo(ctx, stairs);
          if (travel.kind === "step") return issue(travel.command);
        }
      }

      /* 6. Nothing left. */
      return stop(
        "done",
        ctx.progress.idle >= ctx.cfg.idleSteps
          ? "The character has stopped making progress."
          : "There is nothing left to do on this floor.",
      );
    },
  };
}
