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
 *
 * TRAVEL stops for more. A rest, a run, a walk to a known place and an
 * exploring walk never ask the model anything while they go, so they stop on
 * every entry in `TRAVEL_INTERRUPTS` and hand the choice back. Those are
 * all things a player would look up for: a new message, an object or a
 * staircase coming into view, a fork in the way, a command that did not take.
 */

import type { AgentView, MonsterView, PlayerStatusView } from "./host-adapter.js";
import type { Stop } from "./mission.js";
import { countBand, depthBand, healthBand, lossBand } from "./brain/bands.js";
import { key, type Loc } from "./grid.js";
import { knownCount } from "./map.js";
import type { Terrain } from "./terrain.js";

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
  /**
   * End when one blow takes at least this share of maximum hit points, or all
   * the damage since the start takes twice it. Unset means only the rules above.
   */
  readonly stopOnDamageShare?: number;
  /**
   * Creatures that are not news even when new to view, such as one more worm
   * from a mass already seen breeding. Asked again on every check, so one that
   * stops being routine still ends the errand.
   */
  readonly routine?: (monster: MonsterView, view: AgentView) => boolean;
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
const AFFLICTIONS = [
  "blind",
  "confused",
  "afraid",
  "poisoned",
  "cut",
  "stun",
  "paralyzed",
] as const satisfies readonly (keyof PlayerStatusView)[];

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
  const startHp = player.hp;
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
          detail: `The depth changed from ${String(startingDepth)} (${depthBand(startingDepth)}) to ${String(p.depth)} (${depthBand(p.depth)}).`,
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
          detail: `Hit points are down to ${String(hp)} of ${String(p.maxHp)} (${healthBand(hp, p.maxHp)}).`,
        };
      }

      const share = options.stopOnDamageShare;
      if (share !== undefined && p.maxHp > 0 && lost > 0 && (lost >= p.maxHp * share || startHp - hp >= p.maxHp * share * 2)) {
        return {
          reason: "hurt",
          detail: `The character took ${String(lost)} damage (${lossBand(lost, p.maxHp)}).`,
        };
      }

      if (options.stopOnAnyDamage && lost > 0) {
        return {
          reason: "hurt",
          detail: `The character took ${String(lost)} damage (${lossBand(lost, p.maxHp)}).`,
        };
      }

      if (options.stopOnNewCreature) {
        for (const monster of now.monsters()) {
          if (!monster.visible) continue;
          if (known.has(monster.id)) continue;
          if (options.routine?.(monster, now) === true) continue;
          known.add(monster.id);
          return {
            reason: "creature-appeared",
            detail: `${monster.race.charAt(0).toUpperCase()}${monster.race.slice(1)} came into view.`,
          };
        }
      } else {
        for (const id of visibleIds(now)) known.add(id);
      }

      return null;
    },
  };
}

/** The kinds of travel Squire carries out on its own: a rest, an engine run, a walk to a known place, and exploring. */
export type TravelMode = "rest" | "run" | "pathfind" | "explore";

export type TravelInterrupt = "new-hostile" | "hp-change" | "status-change" | "important-message" | "target-moved" | "item" | "branch" | "stair" | "failed-command";

const ALL_TRAVEL: readonly TravelMode[] = ["rest", "run", "pathfind", "explore"];

/**
 * Everything that ends safe travel, in the order it is checked, with the kinds
 * of travel each one applies to. A walk to a known place keeps going past a
 * fork, since its route is already chosen; a run and an exploring walk stop
 * there, because the way on is a new choice.
 */
export const TRAVEL_INTERRUPTS: readonly { readonly id: TravelInterrupt; readonly modes: readonly TravelMode[]; readonly what: string }[] = Object.freeze([
  { id: "new-hostile", modes: ALL_TRAVEL, what: "a creature that can hurt the character comes into view" },
  { id: "hp-change", modes: ALL_TRAVEL, what: "hit points fall, other than to poison or bleeding" },
  { id: "status-change", modes: ALL_TRAVEL, what: "a status effect starts or ends" },
  { id: "important-message", modes: ALL_TRAVEL, what: "the game prints a new message" },
  { id: "target-moved", modes: ["pathfind"], what: "the object the walk is heading for is no longer there" },
  { id: "item", modes: ALL_TRAVEL, what: "an object turns up underfoot or comes into view" },
  { id: "branch", modes: ["run", "explore"], what: "the way forks" },
  { id: "stair", modes: ALL_TRAVEL, what: "a staircase turns up underfoot or comes into view" },
  { id: "failed-command", modes: ALL_TRAVEL, what: "the last command did not do what it should have" },
]);

/** What one travel watch is told about its errand. */
export interface TravelWatchOptions {
  readonly mode: TravelMode;
  readonly terrain: Terrain;
  /** Where the errand is heading. Objects and stairs there are its purpose, not news. */
  readonly destinations?: readonly Loc[];
  /** The object the walk is heading for, which must still be there. */
  readonly target?: Loc;
  /** Creatures that cannot hurt the character are not news. */
  readonly harmless?: (monster: MonsterView, view: AgentView) => boolean;
}

/** A running travel check. */
export interface TravelWatch {
  /** The first interrupt that applies, or null. `failed` is the mismatch the last command left, if any. */
  check(view: AgentView, failed?: string | null): { readonly id: TravelInterrupt; readonly detail: string } | null;
}

/** How far around the character the watch looks for new objects and stairs: the game's sight range. */
const TRAVEL_SIGHT = 20;

const RING: readonly (readonly [number, number])[] = [[0, -1], [1, -1], [1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1]];

/**
 * The number of separate ways out of a grid: runs of open neighbours, walking
 * once around it. A corridor has two, a room's floor one, a fork three or more.
 */
export function openings(view: AgentView, terrain: Terrain, at: Loc): number {
  const open = RING.map(([dx, dy]) => {
    const cell = view.cell(at.x + dx, at.y + dy);
    return cell !== null && cell.known && (cell.passable || terrain.isClosedDoor(cell.feat));
  });
  let runs = 0;
  for (let i = 0; i < open.length; i += 1) if (open[i] === true && open[(i + open.length - 1) % open.length] !== true) runs += 1;
  return runs;
}

/**
 * Known grids holding objects, and those holding stairs: near the character,
 * or across the whole level when `everywhere` is set.
 */
function nearbyFinds(view: AgentView, terrain: Terrain, everywhere = false): { readonly items: Set<string>; readonly stairs: Set<string> } {
  const at = view.player().grid;
  const bounds = everywhere ? view.mapBounds() : null;
  const top = bounds === null ? at.y - TRAVEL_SIGHT : 0;
  const bottom = bounds === null ? at.y + TRAVEL_SIGHT : bounds.height - 1;
  const left = bounds === null ? at.x - TRAVEL_SIGHT : 0;
  const right = bounds === null ? at.x + TRAVEL_SIGHT : bounds.width - 1;
  const items = new Set<string>();
  const stairs = new Set<string>();
  for (let y = top; y <= bottom; y += 1) {
    for (let x = left; x <= right; x += 1) {
      const cell = view.cell(x, y);
      if (cell === null || !cell.known) continue;
      if (knownCount(cell) > 0) items.add(key({ x, y }));
      if (terrain.isDownStair(cell.feat) || terrain.isUpStair(cell.feat)) stairs.add(key({ x, y }));
    }
  }
  return { items, stairs };
}

/**
 * Arm a travel watch against the world as it is now. As with `createWatcher`,
 * what is already in view when the errand starts is what it was chosen
 * knowing about, so none of it ends the errand.
 */
export function createTravelWatch(view: AgentView, options: TravelWatchOptions): TravelWatch {
  const applies = new Set(TRAVEL_INTERRUPTS.filter((entry) => entry.modes.includes(options.mode)).map((entry) => entry.id));
  const startKey = key(view.player().grid);
  const goals = new Set((options.destinations ?? []).map(key));
  if (options.target !== undefined) goals.add(key(options.target));
  const known = visibleIds(view);
  let lastHp = view.player().hp;
  let afflictions = afflictionsOf(view.player().status);
  let lastMessages = view.messages().join("\n");
  /* Everything already remembered on the level is old news, however far off it is now. */
  const seen = nearbyFinds(view, options.terrain, true);
  const forks = new Set<string>([startKey]);
  return {
    check(now, failed = null) {
      const p = now.player();
      const here = key(p.grid);
      if (applies.has("new-hostile")) {
        for (const monster of now.monsters()) {
          if (!monster.visible || known.has(monster.id) || options.harmless?.(monster, now) === true) continue;
          known.add(monster.id);
          return { id: "new-hostile", detail: `${monster.race.charAt(0).toUpperCase()}${monster.race.slice(1)} came into view.` };
        }
      }
      const lost = lastHp - p.hp;
      lastHp = p.hp;
      /* Poison costs a point a turn and a cut up to three; only a loss beyond twice that is news. */
      const tick = (p.status.poisoned > 0 ? 1 : 0) + (p.status.cut > 0 ? 3 : 0);
      if (applies.has("hp-change") && lost > 0 && (lost > tick * 2 || lost * 10 >= p.maxHp)) {
        return { id: "hp-change", detail: `The character lost ${String(lost)} hit points (${lossBand(lost, p.maxHp)}).` };
      }
      const status = afflictionsOf(p.status);
      const landed = status.filter((name) => !afflictions.includes(name));
      const ended = afflictions.filter((name) => !status.includes(name));
      afflictions = status;
      if (applies.has("status-change") && landed.length > 0) return { id: "status-change", detail: `The character is ${landed.join(" and ")}.` };
      if (applies.has("status-change") && ended.length > 0) return { id: "status-change", detail: `The character is no longer ${ended.join(" or ")}.` };
      const messages = now.messages();
      const text = messages.join("\n");
      const fresh = messages.length > 0 && text !== lastMessages;
      lastMessages = text;
      if (applies.has("important-message") && fresh) return { id: "important-message", detail: "The game printed a new message." };
      /* Standing on the target means the walk arrived and picked it up, which is not a move. */
      if (applies.has("target-moved") && options.target !== undefined && here !== key(options.target)) {
        const cell = now.cell(options.target.x, options.target.y);
        if (cell === null || knownCount(cell) === 0) return { id: "target-moved", detail: "The object the walk was heading for is no longer there." };
      }
      const finds = nearbyFinds(now, options.terrain);
      if (applies.has("item")) {
        const underfoot = here !== startKey && !goals.has(here) && finds.items.has(here) && !seen.items.has(`underfoot ${here}`);
        const newly = [...finds.items].filter((grid) => !seen.items.has(grid) && !goals.has(grid));
        for (const grid of finds.items) seen.items.add(grid);
        if (underfoot) {
          seen.items.add(`underfoot ${here}`);
          return { id: "item", detail: "The character is standing on an object." };
        }
        if (newly.length > 0) return { id: "item", detail: newly.length === 1 ? "An object came into view." : `${String(newly.length)} objects (${countBand(newly.length)}) came into view.` };
      }
      if (applies.has("branch") && !forks.has(here) && openings(now, options.terrain, p.grid) >= 3) {
        forks.add(here);
        return { id: "branch", detail: "The way forks here." };
      }
      if (applies.has("stair")) {
        const underfoot = here !== startKey && !goals.has(here) && finds.stairs.has(here) && !seen.stairs.has(`underfoot ${here}`);
        const newly = [...finds.stairs].filter((grid) => !seen.stairs.has(grid) && !goals.has(grid));
        for (const grid of finds.stairs) seen.stairs.add(grid);
        if (underfoot) {
          seen.stairs.add(`underfoot ${here}`);
          return { id: "stair", detail: "The character is standing on a staircase." };
        }
        if (newly.length > 0) return { id: "stair", detail: "A staircase came into view." };
      }
      if (applies.has("failed-command") && failed !== null) return { id: "failed-command", detail: failed };
      return null;
    },
  };
}
