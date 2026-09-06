/**
 * Disturbance: the thing that ends an errand from outside.
 *
 * This is the file the whole mod exists for. A stop condition that only fires
 * when the errand decides it has finished is not a stop condition, it is an exit
 * path; what makes a bounded action safe to hand a character to is that the
 * world can end it too, immediately, on the very next decision.
 *
 * DERIVED FROM STATE, NEVER FROM MESSAGE TEXT. The obvious way to notice a
 * disturbance is to read the message stream for the lines the game prints when
 * something happens. It is also wrong here, twice over: those lines are
 * translated, so matching them would make every stop condition work in one
 * language and silently stop working in the next, and they are the game's
 * PRESENTATION of an event rather than the event. Everything below is read from
 * the character and the creatures instead, so it holds in any language and in
 * any front end.
 *
 * WHAT COUNTS. Five things, and each one is something a player would have
 * reacted to if they had been holding the keyboard:
 *
 *   - the character died,
 *   - the floor changed underfoot,
 *   - a status effect landed that was not there before,
 *   - hit points went down,
 *   - a creature came into view that was not in view when the errand started.
 *
 * The last one is the one that matters most in practice and the one an
 * autoplayer normally does not have, because an autoplayer WANTS the creature.
 */

import type { AgentView, PlayerStatusView } from "@rpgm-tools/neo-angband-core";
import type { Stop } from "./mission.js";

/** What a watcher is allowed to stop for. */
export interface WatchOptions {
  /** End on any loss of hit points, not only on crossing the retreat line. */
  readonly stopOnAnyDamage: boolean;
  /** End when a creature not in view at the start comes into view. */
  readonly stopOnNewCreature: boolean;
  /** End when hit points fall to or below `retreatFraction` of the maximum. */
  readonly stopOnLowHealth: boolean;
  /** The share of maximum hit points that counts as the retreat line. */
  readonly retreatFraction: number;
}

/** A running disturbance check. */
export interface Watcher {
  /** Look at the world and end the errand if something changed. */
  check(view: AgentView): Stop | null;
  /** Stop reporting this creature as new. The fighting errand's own target. */
  acknowledge(id: number): void;
  /** The creature ids that were in view when the errand started. */
  readonly known: ReadonlySet<number>;
}

/**
 * The status effects that end an errand.
 *
 * `food` is deliberately absent: it is a counter that moves every turn rather
 * than an affliction, and treating it as one would end every errand on its
 * second decision. Cut and stun are present because both are ongoing damage the
 * character took and would have reacted to.
 */
const AFFLICTIONS: readonly (keyof PlayerStatusView)[] = [
  "blind",
  "confused",
  "afraid",
  "poisoned",
  "cut",
  "stun",
  "paralyzed",
];

function afflictionsOf(status: PlayerStatusView): string[] {
  return AFFLICTIONS.filter((name) => (status[name] ?? 0) > 0);
}

function visibleIds(view: AgentView): Set<number> {
  const ids = new Set<number>();
  for (const monster of view.monsters()) if (monster.visible) ids.add(monster.id);
  return ids;
}

/**
 * Arm a watcher against the world as it is now.
 *
 * Everything in view at this moment is what the player was looking at when they
 * handed over, so none of it is a surprise and none of it ends the errand. That
 * is the whole reason the baseline is taken rather than assumed empty: an errand
 * started in a room with three creatures in it would otherwise stop on its first
 * decision, having discovered the three creatures it was sent in to deal with.
 */
export function createWatcher(view: AgentView, options: WatchOptions): Watcher {
  const known = visibleIds(view);
  const player = view.player();
  let lastHp = player.hp;
  const startingDepth = player.depth;
  let afflictions = new Set(afflictionsOf(player.status));

  return {
    known,
    acknowledge(id: number): void {
      known.add(id);
    },
    check(now: AgentView): Stop | null {
      const p = now.player();

      if (p.dead) {
        return { reason: "dead", detail: "The character died." };
      }

      if (p.depth !== startingDepth) {
        return {
          reason: "level-changed",
          detail: `The floor changed from ${String(startingDepth)} to ${String(p.depth)}.`,
        };
      }

      const current = afflictionsOf(p.status);
      const landed = current.filter((name) => !afflictions.has(name));
      afflictions = new Set(current);
      if (landed.length > 0) {
        return {
          reason: "afflicted",
          detail: `The character is ${landed.join(" and ")}.`,
        };
      }

      const hp = p.hp;
      const lost = lastHp - hp;
      lastHp = hp;

      if (options.stopOnLowHealth && p.maxHp > 0 && hp <= p.maxHp * options.retreatFraction) {
        return {
          reason: "hurt",
          detail: `Hit points are down to ${String(hp)} of ${String(p.maxHp)}.`,
        };
      }

      if (options.stopOnAnyDamage && lost > 0) {
        return {
          reason: "hurt",
          detail: `The character took ${String(lost)} damage.`,
        };
      }

      if (options.stopOnNewCreature) {
        for (const monster of now.monsters()) {
          if (!monster.visible) continue;
          if (known.has(monster.id)) continue;
          known.add(monster.id);
          return {
            reason: "creature-appeared",
            detail: `${monster.race} came into view.`,
          };
        }
      } else {
        for (const id of visibleIds(now)) known.add(id);
      }

      return null;
    },
  };
}
