/**
 * The flow field: a breadth-first distance map poured out from a set of goals,
 * and the single step that walks down it.
 *
 * This is the same idea Angband's own borg uses to get anywhere - flood the map
 * outward from where you want to be, then always step to the neighbour with the
 * lower number - and it is reimplemented here rather than shared, because the
 * questions the two ask are not the same shape. A full autoplayer floods for a
 * dozen different goal kinds at once and weighs the results against each other;
 * an errand floods for exactly one goal kind and stops when it arrives.
 *
 * MULTI-SOURCE, WHICH IS THE WHOLE TRICK. Seeding the queue with every goal at
 * distance zero means one flood answers "how far is the NEAREST goal, and which
 * way is it" for every grid on the map at once. Flooding from the character
 * toward each goal in turn would be one flood per goal and would still have to
 * be reconciled afterwards.
 *
 * EXPANSION IS OVER KNOWN GROUND ONLY. `canEnter` is asked about the grid being
 * expanded INTO, and the callers pass a predicate that refuses anything the
 * player does not remember. A path through ground the character has never seen
 * is a path the character could not have planned, and walking one would be this
 * mod reading a map the player is not holding.
 *
 * DETERMINISM. The queue is FIFO and the neighbours are visited in the fixed
 * DIRECTIONS order, so the same map and the same goals always produce the same
 * field, and `stepDown` always breaks a tie the same way. Two runs of the same
 * errand from the same place take the same path.
 */

import type { Direction, Loc } from "./grid.js";
import { DIRECTIONS, key } from "./grid.js";

/** A poured distance map. */
export interface FlowField {
  /** Steps from this grid to the nearest goal, or Infinity when unreached. */
  distance(at: Loc): number;
  /** How many grids the flood reached. Zero means no goal was enterable. */
  readonly reached: number;
}

/** How to pour one. */
export interface FlowOptions {
  /** Where the flood starts: distance zero. */
  readonly goals: readonly Loc[];
  /** Whether the flood may expand into this grid. Asked once per grid. */
  readonly canEnter: (at: Loc) => boolean;
  /**
   * The most grids the flood may reach before it stops early.
   *
   * A real Angband level is a few thousand grids and the flood is linear in
   * them, so this is not there for speed. It is there because the flood runs
   * inside a decision the game is waiting on, and an unbounded loop over a
   * hostile or malformed map would freeze the host rather than merely play
   * badly. An early stop degrades to a shorter path, never to a wrong one.
   */
  readonly limit?: number;
}

const DEFAULT_LIMIT = 20000;

/**
 * Pour a field outward from `goals`.
 *
 * A goal that `canEnter` refuses is dropped rather than seeded, so flooding to
 * a staircase behind a wall answers Infinity everywhere instead of answering
 * zero at one unreachable grid.
 */
export function flowFrom(options: FlowOptions): FlowField {
  const limit = options.limit ?? DEFAULT_LIMIT;
  const distance = new Map<string, number>();
  const queue: Loc[] = [];

  for (const goal of options.goals) {
    const at = key(goal);
    if (distance.has(at)) continue;
    if (!options.canEnter(goal)) continue;
    distance.set(at, 0);
    queue.push(goal);
  }

  for (let head = 0; head < queue.length && distance.size < limit; head++) {
    const here = queue[head];
    if (here === undefined) break;
    const next = (distance.get(key(here)) ?? 0) + 1;
    for (const direction of DIRECTIONS) {
      const there: Loc = { x: here.x + direction.dx, y: here.y + direction.dy };
      const at = key(there);
      if (distance.has(at)) continue;
      if (!options.canEnter(there)) continue;
      distance.set(at, next);
      queue.push(there);
    }
  }

  return {
    distance: (at) => distance.get(key(at)) ?? Number.POSITIVE_INFINITY,
    reached: distance.size,
  };
}

/**
 * The step from `from` that gets closest to the goal, or null when no
 * neighbour is an improvement.
 *
 * STRICTLY lower, never equal. A neighbour at the same distance is a sideways
 * move, and a pair of grids that each accept a sideways move into the other is
 * exactly how an errand walks back and forth forever while reporting progress.
 *
 * `canStep` is asked separately from the field's own `canEnter` because the two
 * questions differ at the last step: the flood may pour through a grid holding
 * a creature (it is ground, and the creature will move), while the character
 * stepping into that grid would be attacking rather than walking. A caller that
 * wants a walk passes a predicate that refuses an occupied grid; a caller that
 * wants to close with something passes one that allows it.
 */
export function stepDown(
  field: FlowField,
  from: Loc,
  canStep: (at: Loc) => boolean,
): Direction | null {
  const here = field.distance(from);
  let best: Direction | null = null;
  let bestDistance = here;
  for (const direction of DIRECTIONS) {
    const there: Loc = { x: from.x + direction.dx, y: from.y + direction.dy };
    const d = field.distance(there);
    if (!Number.isFinite(d) || d >= bestDistance) continue;
    if (!canStep(there)) continue;
    best = direction;
    bestDistance = d;
  }
  return best;
}

/**
 * The step from `from` that gets FURTHEST from the goals: retreat.
 *
 * The mirror of stepDown, and the survival rung's only move. Strictly greater,
 * for the same reason: a sideways retreat is not a retreat.
 */
export function stepAway(
  field: FlowField,
  from: Loc,
  canStep: (at: Loc) => boolean,
): Direction | null {
  const here = field.distance(from);
  if (!Number.isFinite(here)) return null;
  let best: Direction | null = null;
  let bestDistance = here;
  for (const direction of DIRECTIONS) {
    const there: Loc = { x: from.x + direction.dx, y: from.y + direction.dy };
    const d = field.distance(there);
    if (!Number.isFinite(d) || d <= bestDistance) continue;
    if (!canStep(there)) continue;
    best = direction;
    bestDistance = d;
  }
  return best;
}
