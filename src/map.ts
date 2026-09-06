/**
 * Reading the map the way an errand needs it: what is ground, what is a door,
 * what is still unexplored, and where the stairs are.
 *
 * Everything here answers from the view's own cells, which are the PLAYER'S
 * knowledge rather than the level. A grid the character has never seen reports
 * `known: false` and is treated as unexplored in every one of these predicates,
 * including the ones that decide where to walk. That is the line this mod does
 * not cross: an errand may only plan over ground the person who handed it the
 * keyboard could have planned over.
 *
 * WHY THE OBJECT COUNT IS NOT USED TO FIND THINGS. `CellView.objectCount` is
 * the live floor list on that grid, not the pile the character remembers seeing,
 * so a mod routing toward a high count would be walking to loot the player has
 * no way to know is there. Collecting is therefore limited to what is underfoot
 * on a grid the errand has already arrived at, where the count and the player's
 * own knowledge are the same thing.
 */

import type { AgentView, CellView } from "@rpgm-tools/neo-angband-core";
import type { Loc } from "./grid.js";
import { neighbours } from "./grid.js";
import type { Terrain } from "./terrain.js";

/** The cell at a grid, or null when it is off the map. */
export function cellAt(view: AgentView, at: Loc): CellView | null {
  return view.cell(at.x, at.y);
}

/** Ground the character remembers and could stand on without being burned. */
export function isKnownGround(view: AgentView, terrain: Terrain, at: Loc): boolean {
  const cell = cellAt(view, at);
  if (cell === null) return false;
  if (!cell.known || !cell.passable) return false;
  return !terrain.isHarmful(cell.feat);
}

/** A closed door the character remembers, which an errand may try to open. */
export function isClosedDoor(view: AgentView, terrain: Terrain, at: Loc): boolean {
  const cell = cellAt(view, at);
  if (cell === null || !cell.known) return false;
  return terrain.isClosedDoor(cell.feat);
}

/**
 * Whether a flood may pour through this grid.
 *
 * Closed doors are included on purpose. Refusing them would make a room with a
 * shut door read as the end of the floor, and the exploring errand would report
 * itself finished while standing in front of the way on.
 */
export function isRoutable(view: AgentView, terrain: Terrain, at: Loc): boolean {
  return isKnownGround(view, terrain, at) || isClosedDoor(view, terrain, at);
}

/** Whether the character may actually walk into this grid on this decision. */
export function isWalkable(view: AgentView, terrain: Terrain, at: Loc): boolean {
  if (!isRoutable(view, terrain, at)) return false;
  const cell = cellAt(view, at);
  /* A positive id is a creature standing there; a negative one is the character
   * itself (the view reports the engine's own -1 for the player's grid), which
   * is not an obstruction. */
  return cell !== null && cell.monster <= 0;
}

/** Whether the character is standing somewhere that is hurting it. */
export function standingOnHarm(view: AgentView, terrain: Terrain, at: Loc): boolean {
  const cell = cellAt(view, at);
  return cell !== null && terrain.isHarmful(cell.feat);
}

/**
 * The grids worth walking to in order to see more of the floor.
 *
 * A frontier is ground the character remembers, next to a grid it does not.
 * Standing on one and looking is what turns the unknown grid into a known one,
 * so flooding from every frontier at once and walking downhill is the whole of
 * exploration.
 *
 * A grid off the edge of the map is not unexplored, it is not there, so it does
 * not make its neighbour a frontier. Without that the four map edges would each
 * read as an infinite supply of things left to explore and the errand would
 * never finish.
 */
export function frontiers(view: AgentView, terrain: Terrain): Loc[] {
  const bounds = view.mapBounds();
  const found: Loc[] = [];
  for (let y = 0; y < bounds.height; y++) {
    for (let x = 0; x < bounds.width; x++) {
      const at: Loc = { x, y };
      if (!isKnownGround(view, terrain, at)) continue;
      for (const there of neighbours(at)) {
        const cell = cellAt(view, there);
        if (cell !== null && !cell.known) {
          found.push(at);
          break;
        }
      }
    }
  }
  return found;
}

/** Every down staircase the character remembers. */
export function knownDownStairs(view: AgentView, terrain: Terrain): Loc[] {
  const bounds = view.mapBounds();
  const found: Loc[] = [];
  for (let y = 0; y < bounds.height; y++) {
    for (let x = 0; x < bounds.width; x++) {
      const cell = view.cell(x, y);
      if (cell === null || !cell.known) continue;
      if (terrain.isDownStair(cell.feat)) found.push({ x, y });
    }
  }
  return found;
}

/** Whether there is something on this grid to pick up. */
export function hasFloorObject(view: AgentView, at: Loc): boolean {
  const cell = cellAt(view, at);
  return cell !== null && cell.objectCount > 0;
}
