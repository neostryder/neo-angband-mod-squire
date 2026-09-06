/**
 * Autoexplore: walk out the rest of this floor, and stop the moment anything
 * happens.
 *
 * The errand that removes the most keystrokes from a game of Angband, and the
 * one where stopping correctly matters most, because the character is walking
 * into rooms it has not seen. Every version of this that has ever annoyed anyone
 * annoyed them the same way: it kept walking.
 *
 * WHAT "EXPLORED" MEANS HERE. A frontier is ground the character remembers,
 * standing next to a grid it does not. Pour a flow field from every frontier at
 * once, walk downhill, and the floor gets walked out with no route planning of
 * any kind: the nearest unexplored thing is always the one the field points at.
 * When there are no frontiers left, or none that can be reached over remembered
 * ground, the floor is done.
 *
 * WHAT STOPS IT. Everything src/disturb.ts knows about, plus ANY loss of hit
 * points rather than only the retreat line. Exploring is the errand where the
 * first point of damage is the whole signal: something is attacking a character
 * that was walking about, and the player wants that decision back immediately,
 * not once it has become serious.
 */

import type { SquireContext } from "../context.js";
import type { Decision, Mission, Stop } from "../mission.js";
import { issue, stop } from "../mission.js";
import { createWatcher, type Watcher } from "../disturb.js";
import { advance } from "../progress.js";
import { awakeInSight } from "../threat.js";
import { frontiers, standingOnHarm } from "../map.js";
import { retreatFrom, stepIntoDark, travelTo } from "../travel.js";

/** Build the exploring errand. */
export function autoexplore(): Mission {
  let watcher: Watcher | null = null;

  return {
    id: "autoexplore",
    label: "explore this floor",

    begin(ctx: SquireContext): Stop | null {
      const cfg = ctx.cfg;
      /* An awake creature already in sight is not a disturbance the watcher can
       * report, because the watcher's whole job is to ignore what was already
       * there. So it is caught here instead, once, before a game turn is spent:
       * walking away from something that is awake and looking at the character
       * is not exploring, it is fleeing badly. A SLEEPING creature is fine to
       * walk past, which is what the game's own stealth is for. */
      const awake = awakeInSight(ctx.view.monsters());
      const first = awake[0];
      if (first !== undefined) {
        return {
          reason: "unsafe",
          detail: `A ${first.race} is awake and in sight.`,
        };
      }

      watcher = createWatcher(ctx.view, {
        stopOnAnyDamage: true,
        stopOnNewCreature: cfg.stopOnNewCreature,
        stopOnLowHealth: cfg.stopOnLowHealth,
        retreatFraction: cfg.retreatFraction,
      });
      return null;
    },

    step(ctx: SquireContext): Decision {
      const at = ctx.view.player().grid;
      advance(ctx.progress, at);

      if (watcher === null) return stop("nothing-to-do", "The errand never started.");
      if (ctx.progress.steps > ctx.cfg.errandSteps) {
        return stop("budget", "The walk ran longer than a short errand should.");
      }

      const disturbed = watcher.check(ctx.view);
      if (disturbed !== null) return { stop: disturbed };

      /* Standing somewhere that is burning the character outranks exploring it.
       * This is reachable without the errand having chosen it - terrain can
       * change underneath a character - so it is checked rather than assumed
       * away by the routing that already avoids harmful ground. */
      if (standingOnHarm(ctx.view, ctx.terrain, at)) {
        const away = retreatFrom(ctx, [at]);
        if (away.kind === "step") return issue(away.command);
        return stop("blocked", "The character is standing on harmful ground and cannot step off.");
      }

      if (ctx.progress.idle >= ctx.cfg.idleSteps) {
        return stop("blocked", "The character has stopped making progress.");
      }

      const goals = frontiers(ctx.view, ctx.terrain);
      if (goals.length === 0) {
        return stop("done", "This floor is walked out.");
      }

      const travel = travelTo(ctx, goals);
      switch (travel.kind) {
        case "step":
          return issue(travel.command);
        case "arrived": {
          /* Already standing on a frontier, which means arriving here did not
           * reveal what is next to it. Walk into the dark. */
          const into = stepIntoDark(ctx, at);
          if (into !== null) return issue(into);
          return stop("blocked", "There is nowhere left to step from here.");
        }
        case "unreachable":
          return stop("done", "Nothing unexplored can be reached from here.");
        case "blocked":
          return stop("blocked", "The way on is blocked.");
      }
    },
  };
}
