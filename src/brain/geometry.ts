/**
 * The ground around the character, as a tactical question needs it: what is on
 * each of the eight neighbouring squares, where a creature's line of sight can
 * be broken within a move or two, how far the nearest stairs are, where the
 * choke points are, and what hurts on the way. Everything is read from the
 * grids the character remembers and the creatures it can see; an unknown grid
 * is never assumed to block a line of sight.
 *
 * The model is told these facts and picks an option. Turning the option into
 * steps is code's work, so nothing here plans a route for the model to follow.
 */

import type { AgentView, MonsterView } from "../host-adapter.js";
import { key, neighbours, type Loc } from "../grid.js";
import { flowFrom } from "../flow.js";
import { isClosedDoor, isRoutable, isWalkable, knownStairs } from "../map.js";
import type { Terrain } from "../terrain.js";
import { stepsText, turnsText } from "./bands.js";
import { inLineOfFire } from "./threat-model.js";

/** How far the hazard list looks. */
export const HAZARD_REACH = 5;

/* Compass names in the order the neighbours are read out, clockwise from north. */
const COMPASS: readonly { readonly dx: number; readonly dy: number; readonly name: string }[] = [
  { dx: 0, dy: -1, name: "north" }, { dx: 1, dy: -1, name: "north-east" }, { dx: 1, dy: 0, name: "east" }, { dx: 1, dy: 1, name: "south-east" },
  { dx: 0, dy: 1, name: "south" }, { dx: -1, dy: 1, name: "south-west" }, { dx: -1, dy: 0, name: "west" }, { dx: -1, dy: -1, name: "north-west" },
];

/** The compass direction from one grid toward another, as a word. */
export function compass(from: Loc, to: Loc): string {
  const dx = Math.sign(to.x - from.x);
  const dy = Math.sign(to.y - from.y);
  return COMPASS.find((c) => c.dx === dx && c.dy === dy)?.name ?? "here";
}

export type NeighbourKind = "wall" | "floor" | "door" | "creature" | "hazard" | "unknown";

/** A grid that hurts to stand on, or holds a trap the character can see. */
export function isHazard(view: AgentView, terrain: Terrain, at: Loc): boolean {
  const cell = view.cell(at.x, at.y);
  return cell !== null && cell.known && (terrain.isHarmful(cell.feat) || cell.trap);
}

/** What one neighbouring grid holds, as the character knows it. */
export function neighbourKind(view: AgentView, terrain: Terrain, at: Loc): NeighbourKind {
  const cell = view.cell(at.x, at.y);
  if (cell === null) return "wall";
  if (!cell.known) return "unknown";
  if (view.monsters().some((m) => m.visible && key(m.grid) === key(at))) return "creature";
  if (isHazard(view, terrain, at)) return "hazard";
  if (isClosedDoor(view, terrain, at)) return "door";
  return cell.passable ? "floor" : "wall";
}

/** The eight neighbours, clockwise from north, with the creature on a square named. */
export function neighbourLine(view: AgentView, terrain: Terrain): string {
  const at = view.player().grid;
  const parts = COMPASS.map((c) => {
    const grid = { x: at.x + c.dx, y: at.y + c.dy };
    const kind = neighbourKind(view, terrain, grid);
    const who = kind === "creature" ? view.monsters().find((m) => m.visible && key(m.grid) === key(grid))?.race : undefined;
    const cell = view.cell(grid.x, grid.y);
    const what = kind === "hazard" ? (cell !== null && terrain.isHarmful(cell.feat) ? "hazard (burning ground)" : "hazard (a trap)") : kind;
    return `${c.name} ${what}${who === undefined ? "" : ` (${who})`}`;
  });
  return `Next to the character: ${parts.join(", ")}.`;
}

/** A square out of every watching creature's line of sight, and the walk that reaches it. */
export interface SightBreak {
  readonly at: Loc;
  /** The grids walked, one per action, ending on the square. */
  readonly route: readonly Loc[];
  /** Damage taken on the walk, one action per step, by the caller's bound. */
  readonly damage: number;
  readonly status: number;
}

/** Whether any of `watchers` can see or fire at the character where it stands. */
export function seenBy(view: AgentView, watchers: readonly MonsterView[]): boolean {
  const from = view.player().grid;
  return watchers.some((m) => inLineOfFire(view, m.grid, from));
}

/**
 * Squares within `reach` steps where none of `watchers` could see or fire at
 * the character, over remembered ground with no burning ground, visible trap,
 * closed door or creature on the way. A walk whose damage could kill is left
 * out. Empty when no watcher can see the character now, since there is then
 * no line to break.
 */
export function sightBreaks(view: AgentView, terrain: Terrain, watchers: readonly MonsterView[], cost: (at: Loc, actions: number) => { readonly damage: number; readonly status: number }, hp: number, reach: number): SightBreak[] {
  const from = view.player().grid;
  if (!seenBy(view, watchers)) return [];
  const hidden = (at: Loc) => watchers.every((m) => !inLineOfFire(view, m.grid, at));
  const best = new Map<string, SightBreak>();
  const queue: SightBreak[] = [{ at: from, route: [], damage: 0, status: 0 }];
  for (let head = 0; head < queue.length; head += 1) {
    const here = queue[head]!;
    if (here.route.length >= reach) continue;
    for (const next of neighbours(here.at)) {
      if (key(next) === key(from) || !isWalkable(view, terrain, next) || isClosedDoor(view, terrain, next) || isHazard(view, terrain, next)) continue;
      const step = cost(next, 1);
      const damage = here.damage + step.damage;
      if (damage >= hp) continue;
      const prev = best.get(key(next));
      if (prev !== undefined && (prev.route.length < here.route.length + 1 || prev.damage <= damage)) continue;
      const entry: SightBreak = { at: next, route: [...here.route, next], damage, status: here.status + step.status };
      best.set(key(next), entry);
      queue.push(entry);
    }
  }
  /* The flood finds grids in compass order, and the sort is stable, so a tie keeps that order. */
  return [...best.values()].filter((b) => hidden(b.at)).sort((a, b) => a.route.length - b.route.length || a.damage - b.damage);
}

/** The sight breaks in words, nearest first. */
export function sightBreakLine(view: AgentView, breaks: readonly SightBreak[], watching: boolean): string {
  if (!watching) return "Line of sight: no awake creature in view can see the character.";
  if (breaks.length === 0) return "Line of sight: no square within two steps is hidden from the awake creatures in view.";
  const from = view.player().grid;
  const listed = breaks.slice(0, 3).map((b) => `${stepsText(b.route.length)} ${compass(from, b.at)}, ${turnsText(b.route.length)}`);
  return `Line of sight breaks from every awake creature in view: ${listed.join("; ")}.`;
}

/** Steps over remembered ground from the character to the nearest of `goals`, or null when none can be walked to. */
function walkSteps(view: AgentView, terrain: Terrain, goals: readonly Loc[]): number | null {
  if (goals.length === 0) return null;
  const field = flowFrom({ goals, canEnter: (grid) => isRoutable(view, terrain, grid) });
  const distance = field.distance(view.player().grid);
  return Number.isFinite(distance) ? distance : null;
}

/** The nearest known up and down staircases, each with the walk and the turns it takes. */
export function stairLine(view: AgentView, terrain: Terrain): string {
  if (view.player().depth === 0) return "Stairs: this is the town; its only staircase leads down into the dungeon.";
  const stairs = knownStairs(view, terrain);
  const part = (name: "up" | "down", kind: (feat: number) => boolean) => {
    const a = name === "up" ? "an" : "a";
    const goals = stairs.filter((at) => kind(view.cell(at.x, at.y)!.feat));
    if (goals.length === 0) return `no ${name} staircase is known`;
    const walk = walkSteps(view, terrain, goals);
    if (walk === null) return `${a} ${name} staircase is known but no remembered ground leads to it`;
    return walk === 0 ? `${a} ${name} staircase is underfoot, ${turnsText(1)} to take` : `the nearest ${name} staircase is ${stepsText(walk)} away, ${turnsText(walk + 1)} to reach and take`;
  };
  return `Stairs: ${part("up", (feat) => terrain.isUpStair(feat))}; ${part("down", (feat) => terrain.isDownStair(feat))}.`;
}

/** A choke point as the state names it. */
export interface ChokeMention {
  readonly at: Loc;
  readonly steps: number;
  readonly door: boolean;
  readonly walls: number;
}

/** The choke points within reach, nearest first, or the plain fact that there is none. */
export function chokeLine(view: AgentView, spots: readonly ChokeMention[], standingIn: boolean): string {
  const from = view.player().grid;
  const here = standingIn ? "The character stands in a choke point now. " : "";
  if (spots.length === 0) return `${here}Choke points: none within a few steps along a checked route.`;
  const listed = [...spots].sort((a, b) => a.steps - b.steps).slice(0, 3).map((s) => `${stepsText(s.steps)} ${compass(from, s.at)} (${s.door ? "a doorway" : s.walls >= 3 ? "a dead end" : "a corridor"}), ${turnsText(s.steps)}`);
  return `${here}Choke points: ${listed.join("; ")}.`;
}

/** A hazard the character could walk into, with the steps to reach it. */
export interface HazardMention {
  readonly at: Loc;
  readonly kind: "burning ground" | "trap";
  readonly steps: number;
}

/**
 * Hazards within `reach` steps over remembered ground: ground that burns and
 * traps the character can see. A walk is never continued through a hazard, so
 * the steps are the walk up to its edge.
 */
export function hazardsNear(view: AgentView, terrain: Terrain, reach = HAZARD_REACH): HazardMention[] {
  const from = view.player().grid;
  const seen = new Map<string, number>([[key(from), 0]]);
  const queue: Loc[] = [from];
  const out: HazardMention[] = [];
  for (let head = 0; head < queue.length; head += 1) {
    const here = queue[head]!;
    const d = seen.get(key(here))!;
    if (d >= reach) continue;
    for (const next of neighbours(here)) {
      if (seen.has(key(next))) continue;
      if (isHazard(view, terrain, next)) {
        seen.set(key(next), d + 1);
        const cell = view.cell(next.x, next.y)!;
        out.push({ at: next, kind: terrain.isHarmful(cell.feat) ? "burning ground" : "trap", steps: d + 1 });
        continue;
      }
      if (!isRoutable(view, terrain, next)) continue;
      seen.set(key(next), d + 1);
      queue.push(next);
    }
  }
  return out;
}

/** The hazards in words, nearest first. */
export function hazardLine(view: AgentView, hazards: readonly HazardMention[], reach = HAZARD_REACH): string {
  if (hazards.length === 0) return `Hazards: none known within ${String(reach)} steps.`;
  const from = view.player().grid;
  const listed = [...hazards].sort((a, b) => a.steps - b.steps).slice(0, 4).map((h) => `${h.kind} ${stepsText(h.steps)} ${compass(from, h.at)}, ${turnsText(h.steps)}`);
  return `Hazards on the way: ${listed.join("; ")}. Squire's routes never cross burning ground, and a walk out of sight steps around traps too.`;
}
