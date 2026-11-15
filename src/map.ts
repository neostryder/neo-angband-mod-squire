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

import type { AgentView, CellView, MonsterView, PlayerView } from "./host-adapter.js";
import type { Loc } from "./grid.js";
import { key, neighbours, steps } from "./grid.js";
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
  return (isKnownGround(view, terrain, at) || isClosedDoor(view, terrain, at)) && !besideParalysingGazer(view, at) &&
    (!besideStationaryThreat(view, at) || steps(playerSnapshot(view).grid, at) === 0);
}

export function neverMoves(view: AgentView, monster: MonsterView): boolean {
  return /^floating eye$/i.test(monster.race) || monster.raceFlags.includes("NEVER_MOVE") || /\bdoes not deign to chase intruders\b/i.test(view.monsterRecall?.(monster.raceIndex)?.text ?? "");
}

/**
 * The grids of visible creatures that never move, and of visible paralysing
 * gazers, for one snapshot of the game.
 *
 * Route floods ask about every grid on the floor. Reading the creature list,
 * and a creature's recall text, for each of those grids made one decision cost
 * seconds of main-thread time, so the answer is worked out once per view and
 * kept against it. A view is a snapshot, so the turn and the character's grid
 * guard the entry in case a test reuses one object while editing it.
 */
interface Hazards {
  readonly turn: number;
  readonly epoch: number;
  readonly stationary: readonly Loc[];
  readonly gazers: readonly Loc[];
}

const hazardCache = new WeakMap<object, Hazards>();
let hazardEpoch = 0;

export function snapshotEpoch(): number {
  return hazardEpoch;
}

interface Snapshot {
  readonly turn: number;
  readonly epoch: number;
  readonly player: PlayerView;
  readonly monsters: MonsterView[];
  readonly lists: Map<Terrain, Map<string, Loc[]>>;
  known?: number;
}

const snapshots = new WeakMap<AgentView, Snapshot>();

function snapshotOf(view: AgentView): Snapshot {
  const turn = view.turn();
  let snapshot = snapshots.get(view);
  if (snapshot === undefined || snapshot.turn !== turn || snapshot.epoch !== hazardEpoch) {
    snapshot = { turn, epoch: hazardEpoch, player: view.player(), monsters: view.monsters(), lists: new Map() };
    snapshots.set(view, snapshot);
  }
  return snapshot;
}

export function snapshotIdentity(view: AgentView): object {
  return snapshotOf(view);
}

/** A decision wrapper keeps the source's immutable player, monsters and map. */
export function shareSnapshot(source: AgentView, wrapper: AgentView): void {
  snapshots.set(wrapper, snapshotOf(source));
}

export function playerSnapshot(view: AgentView): PlayerView {
  return snapshotOf(view).player;
}

export function monsterSnapshot(view: AgentView): MonsterView[] {
  return snapshotOf(view).monsters;
}

export function knownGridCount(view: AgentView): number {
  const snapshot = snapshotOf(view);
  if (snapshot.known === undefined) {
    const bounds = view.mapBounds();
    let known = 0;
    for (let y = 0; y < bounds.height; y++) for (let x = 0; x < bounds.width; x++) if (view.cell(x, y)?.known === true) known++;
    snapshot.known = known;
  }
  return snapshot.known;
}

function snapshotList(view: AgentView, terrain: Terrain, name: string, read: () => Loc[]): Loc[] {
  const snapshot = snapshotOf(view);
  let lists = snapshot.lists.get(terrain);
  if (lists === undefined) { lists = new Map(); snapshot.lists.set(terrain, lists); }
  let list = lists.get(name);
  if (list === undefined) { list = read(); lists.set(name, list); }
  return [...list];
}

/**
 * Forget every kept hazard answer. A real view never changes, so this is for a
 * test world that edits the one view object in place.
 */
export function invalidateHazards(): void {
  hazardEpoch++;
}

function hazardsOf(view: AgentView): Hazards {
  const turn = view.turn();
  const kept = hazardCache.get(view);
  if (kept !== undefined && kept.turn === turn && kept.epoch === hazardEpoch) return kept;
  const stationary: Loc[] = [];
  const gazers: Loc[] = [];
  for (const monster of monsterSnapshot(view)) {
    if (!monster.visible) continue;
    if (neverMoves(view, monster)) stationary.push(monster.grid);
    if (paralysingGazer(view, monster)) gazers.push(monster.grid);
  }
  const fresh: Hazards = { turn, epoch: hazardEpoch, stationary, gazers };
  hazardCache.set(view, fresh);
  return fresh;
}

export function besideStationaryThreat(view: AgentView, at: Loc): boolean {
  const hazards = hazardsOf(view);
  /* A fixed occupant blocks its cell; adjacent melee exposure belongs to the forecast. */
  return hazards.stationary.some((grid) => steps(grid, at) === 0);
}

export function paralysingGazer(view: AgentView, monster: MonsterView): boolean {
  if (playerSnapshot(view).objectFlags.includes("FREE_ACT")) return false;
  if (/^floating eye$/i.test(monster.race)) return true;
  const memory = view.monsterRecall?.(monster.raceIndex)?.text ?? "";
  const paralysis = /\bparaly[sz]\w*/i.test(memory);
  return paralysis && (/\bgaze\b/i.test(memory) || monster.raceFlags.includes("NEVER_MOVE") || /\bdoes not deign to chase intruders\b/i.test(memory));
}

export function besideParalysingGazer(view: AgentView, at: Loc): boolean {
  return hazardsOf(view).gazers.some((grid) => steps(grid, at) <= 1);
}

/** Whether the character may actually walk into this grid on this decision. */
export function isWalkable(view: AgentView, terrain: Terrain, at: Loc): boolean {
  if (!isRoutable(view, terrain, at)) return false;
  const cell = cellAt(view, at);
  /* A positive id is a creature standing there; a negative one is the character
   * itself (the view reports the engine's own -1 for the player's grid), which
   * is not an obstruction. The cell reports the creature there whether or not
   * the player can see it, so only a creature in view blocks the way: an unseen
   * one is found by walking into it, as it is for the player. */
  if (cell === null) return false;
  if (cell.monster <= 0) return true;
  return !monsterSnapshot(view).some((m) => m.id === cell.monster && m.visible);
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
 *
 * A closed door with unknown grids beyond it is a frontier too. A room whose
 * only exits are doors would otherwise read as fully explored.
 */
export function frontiers(view: AgentView, terrain: Terrain): Loc[] {
  return snapshotList(view, terrain, "frontiers", () => findFrontiers(view, terrain));
}

function findFrontiers(view: AgentView, terrain: Terrain): Loc[] {
  const bounds = view.mapBounds();
  /* The character's own grid is ground it stands on, even before the game has
   * remembered it: arriving on a new level, the map can be blank until the
   * first step. */
  const me = playerSnapshot(view).grid;
  const found: Loc[] = [];
  const occupied = new Set(monsterSnapshot(view).filter((m) => m.visible).map((m) => key(m.grid)));
  for (let y = 0; y < bounds.height; y++) {
    for (let x = 0; x < bounds.width; x++) {
      const at: Loc = { x, y };
      if (!isKnownGround(view, terrain, at) && !isClosedDoor(view, terrain, at) && !(x === me.x && y === me.y)) continue;
      if (besideParalysingGazer(view, at) || besideStationaryThreat(view, at) || occupied.has(key(at))) continue;
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

/** Every staircase the character remembers, up and down. */
export function knownStairs(view: AgentView, terrain: Terrain): Loc[] {
  return snapshotList(view, terrain, "stairs", () => findStairs(view, terrain));
}

function findStairs(view: AgentView, terrain: Terrain): Loc[] {
  const bounds = view.mapBounds();
  const found: Loc[] = [];
  for (let y = 0; y < bounds.height; y++) {
    for (let x = 0; x < bounds.width; x++) {
      const cell = view.cell(x, y);
      if (cell === null || !cell.known) continue;
      if (terrain.isDownStair(cell.feat) || terrain.isUpStair(cell.feat)) found.push({ x, y });
    }
  }
  return found;
}

/** Every down staircase the character remembers. */
export function knownDownStairs(view: AgentView, terrain: Terrain): Loc[] {
  return snapshotList(view, terrain, "down-stairs", () => knownStairs(view, terrain).filter((grid) => terrain.isDownStair(view.cell(grid.x, grid.y)!.feat)));
}

/**
 * The objects the player remembers on a cell. Newer views report the count of
 * the player's own floor memory beside the older count; older views have only
 * the older one.
 */
export function knownCount(cell: CellView): number {
  const known = (cell as CellView & { readonly knownObjectCount?: number }).knownObjectCount;
  return typeof known === "number" ? known : cell.objectCount;
}

/** Whether there is something on this grid to pick up. */
export function hasFloorObject(view: AgentView, at: Loc): boolean {
  const cell = cellAt(view, at);
  return cell !== null && knownCount(cell) > 0;
}
