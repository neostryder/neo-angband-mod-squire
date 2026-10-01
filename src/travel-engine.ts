/**
 * Engine travel: hand the whole route to the game instead of walking it a step
 * at a time.
 *
 * Squire's own errands walk by pouring a flow field and taking one step per
 * decision, which is why every errand reads the same way. The game can also walk
 * a route itself: `pathfind` follows a computed route and stops when something
 * disturbs it, `navigate-down` and `navigate-up` walk to the nearest remembered
 * stair, and `run` follows a corridor. One of those commands replaces a whole
 * run of decisions, so a walk across a floor costs one model call rather than
 * one per grid.
 *
 * WHEN NOT TO HAND OVER THE WALK. The engine refuses to start a route with a
 * creature in sight, and a route that has to be abandoned mid-way is worse than
 * a route Squire chose itself. So an awake creature in view, and a view that
 * does not expose the engine's own route read, both fall back to the caller's
 * step-by-step walk. The caller also falls back when the game refuses the
 * command without spending a turn, because the command changed nothing.
 *
 * WHY THE VIEW GATE IS travelPath. The travel commands and the read that
 * describes their route ship together: an engine new enough to expose
 * `travelPath` is one where an agent can ask for a route, and an older view
 * without it keeps Squire's own steps. The read also answers the one thing the
 * flow field cannot: which way the engine's own route leaves the character's
 * grid, which is the direction the run command needs.
 */

import type { AgentCommand, AgentView } from "@rpgm-tools/neo-angband-core";
import type { SquireContext } from "./context.js";
import type { Loc } from "./grid.js";
import { DIRECTIONS, directionToward } from "./grid.js";
import { flowFrom } from "./flow.js";
import { isRoutable, isWalkable } from "./map.js";
import { awakeInSight } from "./threat.js";

/** How the walk should be handed to the engine. */
export interface EngineTravelOptions {
  /** A stair kind, so the engine's own navigate command picks the target. */
  readonly stairs?: "up" | "down";
  /** Whether a corridor may be covered with the engine's run command. */
  readonly run?: boolean;
}

/** Whether this view can answer for the engine's own travel. */
export function engineTravelAvailable(view: AgentView): boolean {
  return typeof view.travelPath === "function";
}

/**
 * One engine command that walks toward the nearest of `goals`, or null when the
 * caller should walk the route itself. Null is the fallback signal, never an
 * error: an older view, a creature in sight and an unroutable goal all answer
 * the same way, and the caller's step-by-step walk covers all three.
 */
export function engineTravel(ctx: SquireContext, goals: readonly Loc[], options: EngineTravelOptions = {}): AgentCommand | null {
  if (goals.length === 0) return null;
  if (!engineTravelAvailable(ctx.view)) return null;
  /* The engine's travel refuses to start with a creature in view, and Squire
   * keeps its own steps rather than half a route. */
  if (awakeInSight(ctx.view.monsters()).length > 0) return null;

  const at = ctx.view.player().grid;
  /* Already standing on a goal: arrival is the caller's business. */
  if (goals.some((goal) => goal.x === at.x && goal.y === at.y)) return null;

  if (options.stairs !== undefined) {
    return ctx.act.raw(options.stairs === "down" ? "navigate-down" : "navigate-up");
  }

  const near = nearestGoal(ctx, goals);
  if (near === null) return null;
  /* The engine's own route is the one the command will walk; when it cannot
   * answer, the caller's flow field is the fallback. */
  const route = ctx.view.travelPath?.({ x: near.x, y: near.y }) ?? null;
  if (route === null || route.grids.length === 0) return null;

  const first = route.grids[0];
  if (first === undefined) return null;
  if (options.run === true && inCorridor(ctx)) {
    const dir = directionToward(at, first);
    if (dir !== null) return { ...ctx.act.raw("run"), dir };
  }
  return ctx.act.raw("pathfind", { dest: { x: near.x, y: near.y } });
}

/** The reachable goal the character can walk to soonest. */
function nearestGoal(ctx: SquireContext, goals: readonly Loc[]): Loc | null {
  const at = ctx.view.player().grid;
  const routable = (grid: Loc): boolean => isRoutable(ctx.view, ctx.terrain, grid);
  const fromPlayer = flowFrom({ goals: [at], canEnter: routable });
  let best: Loc | null = null;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const goal of goals) {
    const distance = fromPlayer.distance(goal);
    if (Number.isFinite(distance) && distance < bestDistance) {
      bestDistance = distance;
      best = goal;
    }
  }
  return best;
}

/**
 * Whether the character stands in a corridor: few enough walkable neighbours
 * that running in a straight line follows the passage rather than cutting across
 * a room.
 */
function inCorridor(ctx: SquireContext): boolean {
  const at = ctx.view.player().grid;
  let open = 0;
  for (const direction of DIRECTIONS) {
    if (isWalkable(ctx.view, ctx.terrain, { x: at.x + direction.dx, y: at.y + direction.dy })) open += 1;
  }
  return open <= 3;
}
