/**
 * One step toward somewhere, or one step away from something.
 *
 * Every errand walks, and they all walk the same way: pour a flow field over the
 * ground the character remembers, take the neighbour with the lower number, and
 * turn that into the one command the game accepts for it. Keeping that in one
 * place is what makes the errands short enough to read, and it is also where the
 * two commands that are not a walk get decided - opening a door standing in the
 * way, and stepping into a creature, which is how Angband spells a melee blow.
 */

import type { AgentCommand } from "@rpgm-tools/neo-angband-core";
import type { SquireContext } from "./context.js";
import type { Loc } from "./grid.js";
import { DIRECTIONS, directionToward, key } from "./grid.js";
import { flowFrom, stepAway, stepDown } from "./flow.js";
import { cellAt, isClosedDoor, isRoutable, isWalkable } from "./map.js";

/** What one attempt to travel produced. */
export type Travel =
  /** Issue this and the character is one step closer. */
  | { readonly kind: "step"; readonly command: AgentCommand }
  /** The character is already standing on one of the goals. */
  | { readonly kind: "arrived" }
  /** No goal can be reached over ground the character remembers. */
  | { readonly kind: "unreachable" }
  /** A goal is reachable but every step toward it is blocked right now. */
  | { readonly kind: "blocked" };

/**
 * Turn a chosen neighbouring grid into the command that enters it.
 *
 * A closed door gets `open` rather than `move`. Walking into one works in the
 * game's own hands because the shell's easy-alter handling turns the bump into
 * an open, and an errand should not depend on a convenience option the player
 * may have switched off.
 */
function enter(ctx: SquireContext, from: Loc, to: Loc): AgentCommand | null {
  const dir = directionToward(from, to);
  if (dir === null) return null;
  if (isClosedDoor(ctx.view, ctx.terrain, to)) return ctx.act.open(dir);
  return ctx.act.move(dir);
}

/**
 * Take one step toward the nearest of `goals`.
 *
 * The flood is poured from the goals rather than from the character on purpose:
 * one flood then answers for every goal at once, and the character simply walks
 * downhill from wherever it happens to be standing.
 */
export function travelTo(ctx: SquireContext, goals: readonly Loc[]): Travel {
  if (goals.length === 0) return { kind: "unreachable" };
  const at = ctx.view.player().grid;
  const here = key(at);
  if (goals.some((goal) => key(goal) === here)) return { kind: "arrived" };

  const field = flowFrom({
    goals,
    canEnter: (grid) => isRoutable(ctx.view, ctx.terrain, grid),
  });
  if (!Number.isFinite(field.distance(at))) return { kind: "unreachable" };

  const direction = stepDown(field, at, (grid) => isWalkable(ctx.view, ctx.terrain, grid));
  if (direction === null) return { kind: "blocked" };

  const to: Loc = { x: at.x + direction.dx, y: at.y + direction.dy };
  const command = enter(ctx, at, to);
  return command === null ? { kind: "blocked" } : { kind: "step", command };
}

/**
 * Take one step away from `threats`, over ground the character remembers.
 *
 * The same flood, read the other way round: pour it from the creatures and walk
 * UPHILL. That gives a retreat that rounds a corner rather than one that backs
 * into a dead end, because the number on a grid is its real walking distance
 * from the danger rather than its distance in a straight line.
 */
export function retreatFrom(ctx: SquireContext, threats: readonly Loc[]): Travel {
  if (threats.length === 0) return { kind: "unreachable" };
  const at = ctx.view.player().grid;
  const field = flowFrom({
    goals: threats,
    /* The creatures' own grids have to be enterable for the flood to start at
     * all, and a creature standing on ground the character remembers is on
     * ordinary ground - it is only the CHARACTER's step into it that is barred,
     * and that is `isWalkable` below rather than this. */
    canEnter: (grid) => isRoutable(ctx.view, ctx.terrain, grid) || threats.some((t) => key(t) === key(grid)),
  });

  const direction = stepAway(field, at, (grid) => isWalkable(ctx.view, ctx.terrain, grid));
  if (direction === null) return { kind: "blocked" };

  const to: Loc = { x: at.x + direction.dx, y: at.y + direction.dy };
  const command = enter(ctx, at, to);
  return command === null ? { kind: "blocked" } : { kind: "step", command };
}

/**
 * The command that strikes an adjacent creature.
 *
 * Angband has no separate attack verb: walking into an occupied grid is the
 * blow, and the act facade's `melee` is that walk said out loud. Returns null
 * when the creature is not actually next to the character, which is the caller's
 * cue to walk instead of swinging at nothing.
 */
export function strike(ctx: SquireContext, target: Loc): AgentCommand | null {
  const at = ctx.view.player().grid;
  const dir = directionToward(at, target);
  if (dir === null) return null;
  if (Math.max(Math.abs(target.x - at.x), Math.abs(target.y - at.y)) !== 1) return null;
  return ctx.act.melee(dir);
}

/** Whether this grid holds ground the character could stand on. */
export function standable(ctx: SquireContext, at: Loc): boolean {
  const cell = cellAt(ctx.view, at);
  return cell !== null && cell.known && cell.passable;
}

/**
 * Step into a neighbouring grid the character has never seen.
 *
 * The one move that cannot be planned over remembered ground, and the one an
 * exploring character makes constantly: walking into the dark. It comes up when
 * standing next to unexplored space does not reveal it, which is what happens
 * with no light source, while blind, and at the mouth of an unlit corridor.
 *
 * This reads NOTHING about the grid it steps into - only that the character does
 * not know what is there, which the character also does not know. Walking into a
 * wall in the dark is an ordinary thing to do and costs no game turn; the idle
 * count is what stops an errand doing it forever.
 */
export function stepIntoDark(ctx: SquireContext, from: Loc): AgentCommand | null {
  for (const direction of DIRECTIONS) {
    const there: Loc = { x: from.x + direction.dx, y: from.y + direction.dy };
    const cell = cellAt(ctx.view, there);
    if (cell === null || cell.known) continue;
    return ctx.act.move(direction.key);
  }
  return null;
}
