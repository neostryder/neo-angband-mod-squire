/**
 * Which creature an errand goes after, and when it should not go after any.
 *
 * HOW THIS DIFFERS FROM A FULL AUTOPLAYER, deliberately and throughout. A full
 * autoplayer scores a creature by the damage it expects to take over the next
 * several turns: it sums blow dice, spell frequency and speed into an
 * expected-damage number, compares that against its own hit points, and picks
 * the fight that keeps it alive longest across the whole run. That is the right
 * model for something whose job is to survive to depth fifty.
 *
 * An errand is not trying to survive to depth fifty. It has been asked to clear
 * what is in front of the character and then stop, so it prices a creature by
 * how long that will take and how likely it is to turn into something else:
 *
 *   - PROXIMITY DOMINATES. The nearest reachable creature is almost always the
 *     right one, because every step spent walking past one creature to reach
 *     another is a step during which the first one is hitting the character.
 *   - A WOUNDED CREATURE IS WORTH FINISHING. It is the shortest remaining fight
 *     on the floor, which is exactly what a short errand wants.
 *   - A FLEEING CREATURE IS WORTH LESS. Chasing one is the single commonest way
 *     a short errand becomes a long one, and the creature was already beaten.
 *   - A SLEEPING CREATURE IS NOT A TARGET AT ALL unless the player said
 *     otherwise. Waking something the character had walked quietly past is a
 *     decision a player makes, not an errand.
 *
 * None of this is a claim to play better. It is a claim to finish, which is what
 * was asked for.
 */

import type { MonsterView } from "@rpgm-tools/neo-angband-core";
import type { Loc } from "./grid.js";
import { steps } from "./grid.js";

/**
 * The weights above, named so a test can move one and see the choice change.
 *
 * THEY ARE BUDGETED, not merely chosen. "Proximity dominates" is only true if
 * everything else added together cannot outweigh one step, so the three other
 * terms have a combined range of 95 against a step's 100. Widen any of them
 * without widening `perStep` and the stated design quietly stops holding: a deep
 * creature two rooms away starts outscoring the one in the doorway, and the
 * errand walks past the fight it was sent to have. `src/threat.test.ts` pins
 * this with the worst case on each side.
 */
export interface ThreatWeights {
  /** Subtracted per step of distance. Large, because proximity dominates. */
  readonly perStep: number;
  /** Added at full woundedness, scaled by the share of hit points already gone. */
  readonly wounded: number;
  /** Subtracted per level of the creature's own depth rating. */
  readonly perLevel: number;
  /**
   * The level past which a creature is simply "deep" and no further.
   *
   * Without a cap the level term is unbounded - a creature can be level 100 -
   * and it would swamp the distance term entirely at depth. What the term is
   * for is separating a kobold from a troll standing the same distance away,
   * and that separation is complete long before level 30.
   */
  readonly levelCap: number;
  /** Subtracted outright from a creature that is already running away. */
  readonly fleeing: number;
}

/** Squire's own weights. */
export const SQUIRE_WEIGHTS: ThreatWeights = {
  perStep: 100,
  wounded: 40,
  perLevel: 1,
  levelCap: 30,
  fleeing: 25,
};

/**
 * How much this errand wants to fight this creature. Higher is better.
 *
 * Deliberately unbounded below: a distant, healthy, fleeing unique scores deeply
 * negative and will never be chosen over anything adjacent, which is the point.
 */
export function priority(
  monster: MonsterView,
  from: Loc,
  weights: ThreatWeights = SQUIRE_WEIGHTS,
): number {
  const distance = steps(from, monster.grid);
  const health = monster.maxHp > 0 ? Math.max(0, Math.min(1, monster.hp / monster.maxHp)) : 1;
  let score = 1000;
  score -= distance * weights.perStep;
  score += (1 - health) * weights.wounded;
  score -= Math.min(monster.level, weights.levelCap) * weights.perLevel;
  if (monster.afraid) score -= weights.fleeing;
  return score;
}

/** What `pickTarget` is allowed to consider. */
export interface TargetOptions {
  /** Let a sleeping creature be chosen. */
  readonly wakeSleepers: boolean;
  /** The furthest a creature may be and still be worth walking to. */
  readonly reach: number;
  readonly weights?: ThreatWeights;
}

/**
 * Whether this creature is one an errand may engage at all.
 *
 * Angband 4.2 has no allied creatures, so every creature in the view is
 * hostile and the only questions left are whether the character can see it and
 * whether waking it was asked for. A creature the character cannot see is
 * excluded rather than remembered: an errand that walks to where something was
 * last seen is an errand acting on knowledge the player does not have on screen.
 */
export function engageable(monster: MonsterView, options: TargetOptions): boolean {
  if (!monster.visible) return false;
  if (monster.asleep && !options.wakeSleepers) return false;
  return true;
}

/**
 * The creature this errand should fight, or null when there is none worth it.
 *
 * Ties break toward the lower monster id, which is stable across a save and
 * across a reload, so the same standing world always produces the same choice.
 */
export function pickTarget(
  monsters: readonly MonsterView[],
  from: Loc,
  options: TargetOptions,
): MonsterView | null {
  let best: MonsterView | null = null;
  let bestScore = Number.NEGATIVE_INFINITY;
  for (const monster of monsters) {
    if (!engageable(monster, options)) continue;
    if (steps(from, monster.grid) > options.reach) continue;
    const score = priority(monster, from, options.weights);
    if (best === null || score > bestScore || (score === bestScore && monster.id < best.id)) {
      best = monster;
      bestScore = score;
    }
  }
  return best;
}

/** Every creature the character can see right now, sleeping ones included. */
export function inSight(monsters: readonly MonsterView[]): MonsterView[] {
  return monsters.filter((monster) => monster.visible);
}

/** Every creature the character can see that is awake. */
export function awakeInSight(monsters: readonly MonsterView[]): MonsterView[] {
  return monsters.filter((monster) => monster.visible && !monster.asleep);
}
