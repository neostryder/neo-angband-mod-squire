/**
 * Grids, keypad directions, and the distances an errand measures in.
 *
 * Angband's movement commands take a keypad direction, 1 through 9 with 5
 * absent, and the whole game measures distance in king moves - a diagonal step
 * costs exactly what an orthogonal one costs. Every path this mod builds is
 * therefore a Chebyshev path, and a "nearest" creature is the one fewest steps
 * away rather than the one fewest units away in a straight line. Getting that
 * wrong is not a rounding error: it makes a monster two squares diagonally
 * away read as further off than one two squares along a corridor, and the
 * fighting errand then walks past the thing it was sent to fight.
 *
 * DIRECTION ORDER IS PART OF THE CONTRACT. Every tie in this mod breaks toward
 * the earliest direction in DIRECTIONS, which makes two runs from the same
 * position over the same map produce the same path. An errand that wanders
 * differently each time it is asked the same question cannot be reasoned about
 * by the person who asked for it.
 */

/** A map position. */
export interface Loc {
  readonly x: number;
  readonly y: number;
}

/** One keypad direction and the step it takes. */
export interface Direction {
  /** The keypad number the move command takes. */
  readonly key: number;
  readonly dx: number;
  readonly dy: number;
}

/**
 * The eight steps, in the fixed order every tie-break in this mod uses.
 *
 * Upstream's own ddd order (cave.c) is 2, 8, 6, 4, 3, 1, 9, 7: orthogonals
 * first, diagonals after. Kept, rather than sorted by keypad number, because a
 * flow that prefers a diagonal will cut a corner and clip a wall on the way,
 * and preferring the orthogonal step out of a tie is what keeps a path inside
 * the corridor it is walking down.
 */
export const DIRECTIONS: readonly Direction[] = [
  { key: 2, dx: 0, dy: 1 },
  { key: 8, dx: 0, dy: -1 },
  { key: 6, dx: 1, dy: 0 },
  { key: 4, dx: -1, dy: 0 },
  { key: 3, dx: 1, dy: 1 },
  { key: 1, dx: -1, dy: 1 },
  { key: 9, dx: 1, dy: -1 },
  { key: 7, dx: -1, dy: -1 },
];

/** King-move distance: the number of steps between two grids. */
export function steps(a: Loc, b: Loc): number {
  return Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));
}

/** Whether two grids touch, diagonals included. A grid does not touch itself. */
export function adjacent(a: Loc, b: Loc): boolean {
  const d = steps(a, b);
  return d === 1;
}

/**
 * The keypad direction that steps from `from` toward `to`, or null when the two
 * are the same grid.
 *
 * Only ever a single step. A caller that wants the whole path asks the flow
 * field for it; this answers "which way do I lean", which is what a melee blow
 * against an adjacent creature needs and nothing more.
 */
export function directionToward(from: Loc, to: Loc): number | null {
  const dx = Math.sign(to.x - from.x);
  const dy = Math.sign(to.y - from.y);
  if (dx === 0 && dy === 0) return null;
  const found = DIRECTIONS.find((d) => d.dx === dx && d.dy === dy);
  return found ? found.key : null;
}

/** The eight grids around `at`, in DIRECTIONS order. */
export function neighbours(at: Loc): Loc[] {
  return DIRECTIONS.map((d) => ({ x: at.x + d.dx, y: at.y + d.dy }));
}

/** A stable string key for a grid, for the sets and maps the memory keeps. */
export function key(at: Loc): string {
  return `${String(at.x)},${String(at.y)}`;
}
