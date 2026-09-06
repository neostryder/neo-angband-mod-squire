/**
 * Autofight: engage one creature, and stop.
 *
 * The errand a player reaches for when something has wandered into the room and
 * the outcome is not in doubt, only the keystrokes. It picks one creature, walks
 * to it, hits it until it is down, and gives the keyboard straight back. It does
 * not then look around for the next one, and that restraint is the feature: an
 * errand that kept finding new fights would be an autoplayer with extra steps.
 *
 * THE TARGET IS CHOSEN ONCE. If the player had already set a target before
 * handing over, that is the creature - naming a target is the clearest possible
 * statement of what the errand is for, and second-guessing it would make the
 * game's own targeting command useless while this mod is installed. Otherwise
 * the nearest engageable creature is chosen by src/threat.ts's weights.
 *
 * STOPPING. Six ways, and five of them are the world's rather than the errand's:
 * the target goes down, the target is no longer in sight, a creature that was
 * not there at handover arrives, hit points cross the retreat line, a status
 * effect lands, or the errand runs out of decisions. Only the first is the
 * errand finishing what it was asked to do.
 */

import type { MonsterView } from "@rpgm-tools/neo-angband-core";
import type { SquireContext } from "../context.js";
import type { Decision, Mission, Stop } from "../mission.js";
import { issue, stop } from "../mission.js";
import { createWatcher, type Watcher } from "../disturb.js";
import { advance } from "../progress.js";
import { engageable, pickTarget } from "../threat.js";
import { strike, travelTo } from "../travel.js";
import { adjacent } from "../grid.js";

/**
 * How far away a creature may be and still be worth walking to.
 *
 * Twenty king moves is about the length of a long room plus the corridor that
 * reaches it. Beyond that the walk is the errand rather than the fight, and the
 * player asked for a fight.
 */
export const AUTOFIGHT_REACH = 20;
const REACH = AUTOFIGHT_REACH;

function liveTarget(ctx: SquireContext, id: number): MonsterView | undefined {
  return ctx.view.monsters().find((monster) => monster.id === id);
}

/** Build the fighting errand. One per handover: it holds its own target. */
export function autofight(): Mission {
  let watcher: Watcher | null = null;
  let targetId: number | null = null;
  /**
   * Whether the last decision was a blow at the target.
   *
   * This is how "the target is dead" is told apart from "the target walked out
   * of sight", which the view cannot distinguish on its own: a creature that is
   * gone is simply absent from the list either way. Struck last decision and now
   * absent is a kill; absent without a blow is a creature that left. It is an
   * inference rather than a reading, and it is named as one here so that nobody
   * later mistakes the message for something the engine said.
   */
  let struck = false;

  return {
    id: "autofight",
    label: "clear what is in front of me",

    begin(ctx: SquireContext): Stop | null {
      const cfg = ctx.cfg;
      watcher = createWatcher(ctx.view, {
        /* A fight is damage. Only the retreat line ends this errand on hit
         * points, never the first blow that lands. */
        stopOnAnyDamage: false,
        stopOnNewCreature: cfg.stopOnNewCreature,
        stopOnLowHealth: cfg.stopOnLowHealth,
        retreatFraction: cfg.retreatFraction,
      });

      const at = ctx.view.player().grid;
      const options = { wakeSleepers: cfg.wakeSleepers, reach: REACH };

      const named = ctx.view.target();
      if (named !== null && named.midx > 0) {
        const monster = liveTarget(ctx, named.midx);
        /* A named target is honoured even if it is asleep: naming it IS the
         * decision to wake it, which is the thing the sleepers rule exists to
         * keep an errand from making on its own. */
        if (monster !== undefined && monster.visible) {
          targetId = monster.id;
          return null;
        }
      }

      const chosen = pickTarget(ctx.view.monsters(), at, options);
      if (chosen === null) {
        return {
          reason: "nothing-to-do",
          detail: "There is nothing in sight to fight.",
        };
      }
      targetId = chosen.id;
      return null;
    },

    step(ctx: SquireContext): Decision {
      const at = ctx.view.player().grid;
      advance(ctx.progress, at);

      if (watcher === null || targetId === null) {
        return stop("nothing-to-do", "The errand was never given a target.");
      }
      if (ctx.progress.steps > ctx.cfg.errandSteps) {
        return stop("budget", "The fight ran longer than a short errand should.");
      }

      const disturbed = watcher.check(ctx.view);
      if (disturbed !== null) return { stop: disturbed };

      const target = liveTarget(ctx, targetId);
      if (target === undefined) {
        return struck
          ? stop("done", "The target is down.")
          : stop("target-gone", "The target is no longer there.");
      }
      if (!engageable(target, { wakeSleepers: true, reach: REACH })) {
        return stop("target-gone", `The ${target.race} is out of sight.`);
      }

      if (adjacent(at, target.grid)) {
        const blow = strike(ctx, target.grid);
        if (blow === null) return stop("blocked", "The target cannot be struck from here.");
        struck = true;
        return issue(blow);
      }

      struck = false;
      /* Walking is the only thing an idle count can diagnose. Standing still
       * while trading blows is not a wedge, it is a fight, so the check lives
       * here rather than at the top of the decision. */
      if (ctx.progress.idle >= ctx.cfg.idleSteps) {
        return stop("blocked", "The way to the target is blocked.");
      }

      const travel = travelTo(ctx, [target.grid]);
      if (travel.kind === "step") return issue(travel.command);
      return stop("blocked", `The ${target.race} cannot be reached from here.`);
    },
  };
}
