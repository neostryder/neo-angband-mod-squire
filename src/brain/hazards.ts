/**
 * Terrain that blocks or hurts: visible traps to disarm, and diggable rock that
 * stands between the character and where it is going.
 *
 * A trap is read from the cell the player can see (CellView.trap is the same
 * predicate the disarm command tests). Rubble is read from the terrain flags the
 * host supplies; when the host does not name them, nothing here offers and
 * Squire keeps its older habit of walking around the rock.
 */

import type { AgentView } from "@rpgm-tools/neo-angband-core";
import type { Loc } from "../grid.js";
import { DIRECTIONS } from "../grid.js";
import { flowFrom } from "../flow.js";
import { frontiers, isRoutable, knownStairs } from "../map.js";
import type { Terrain } from "../terrain.js";

/** The direction to a visible trap next to the character, or null when none. */
export function trapDirection(view: AgentView): number | null {
  const at = view.player().grid;
  for (const direction of DIRECTIONS) {
    const cell = view.cell(at.x + direction.dx, at.y + direction.dy);
    if (cell !== null && cell.known && cell.trap) return direction.key;
  }
  return null;
}

/**
 * The direction to diggable rock that stands between the character and a goal,
 * or null when the way is already open.
 *
 * The rock must be next to the character and remembered, and the grid straight
 * beyond it must be remembered ground that reaches a frontier or a staircase on
 * its own. If the character can already reach a goal without digging, the rock
 * is not blocking anything and nothing is offered.
 */
export function rubbleDirection(view: AgentView, terrain: Terrain): number | null {
  if (terrain.isDiggable === undefined) return null;
  const at = view.player().grid;
  const goals = [...frontiers(view, terrain), ...knownStairs(view, terrain)];
  if (goals.length === 0) return null;
  const routable = (grid: Loc): boolean => isRoutable(view, terrain, grid);
  const fromGoals = flowFrom({ goals, canEnter: routable });
  if (Number.isFinite(fromGoals.distance(at))) return null;
  for (const direction of DIRECTIONS) {
    const rock: Loc = { x: at.x + direction.dx, y: at.y + direction.dy };
    const cell = view.cell(rock.x, rock.y);
    if (cell === null || !cell.known || cell.passable || !terrain.isDiggable(cell.feat)) continue;
    const beyond: Loc = { x: at.x + 2 * direction.dx, y: at.y + 2 * direction.dy };
    if (routable(beyond) && Number.isFinite(fromGoals.distance(beyond))) return direction.key;
  }
  return null;
}
