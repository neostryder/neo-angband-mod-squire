/**
 * What one errand has already done: the running state a decision cannot read
 * out of the world.
 *
 * Kept deliberately small. Everything about the map, the creatures and the
 * character is read fresh from the view on every decision, because the view IS
 * the player's own knowledge and a second remembered copy of it would be a
 * second thing to go stale. What cannot be read from the view is history: how
 * many decisions this errand has spent, whether the character has actually
 * moved lately, and which grid it was standing on last time.
 *
 * WHY IDLE TICKS EXIST. An errand that keeps issuing a legal command that
 * achieves nothing is the failure mode that costs a player the most: it looks
 * like the mod working and it never ends. Walking into a wall, opening a door
 * that is stuck, or bumping a creature that has since become invisible all
 * produce a command the engine accepts and a character that does not move.
 * Counting the decisions since the character last changed grid catches all
 * three without needing to know which one happened.
 */

import type { Loc } from "./grid.js";
import { key } from "./grid.js";

/** The running state of one errand. */
export interface Progress {
  /** Decisions this errand has made, including the one being made now. */
  steps: number;
  /** Decisions in a row without the character changing grid. */
  idle: number;
  /** The grid the character was on at the previous decision, or null at the start. */
  at: Loc | null;
  /** The depth the errand started on. */
  depth: number;
  /** Grids this errand has already tried to pick up from, so it tries once. */
  readonly collected: Set<string>;
}

/** A fresh errand's progress. */
export function newProgress(depth: number): Progress {
  return { steps: 0, idle: 0, at: null, depth, collected: new Set<string>() };
}

/**
 * Fold one decision's worth of movement into the progress.
 *
 * Called at the TOP of a decision, with where the character is now: the count
 * that matters is how long it has been since the last actual move, and that can
 * only be measured after the previous command has resolved.
 */
export function advance(progress: Progress, at: Loc): void {
  progress.steps += 1;
  if (progress.at !== null && key(progress.at) === key(at)) progress.idle += 1;
  else progress.idle = 0;
  progress.at = at;
}

/** Whether this grid has already been picked over by this errand. */
export function alreadyCollected(progress: Progress, at: Loc): boolean {
  return progress.collected.has(key(at));
}

/** Record that this grid has been picked over. */
export function markCollected(progress: Progress, at: Loc): void {
  progress.collected.add(key(at));
}
