/**
 * A world described in one string, for the tests.
 *
 * WHY THIS EXISTS RATHER THAN A BOOTED GAME. Every interesting case in an errand
 * is a shape of world: a corridor with one frontier left in it, a sleeping
 * creature the errand must walk past, a door standing between the character and
 * the rest of the floor, a hit that lands while the character is walking. A
 * generated level cannot be asked for one of those on demand, and a test that
 * waits for one to turn up is a test that passes for the wrong reason. A map
 * drawn in a string can be asked for exactly one, and the test then reads as the
 * sentence it is checking.
 *
 * WHAT IT DOES NOT PROVE. That the real view reports what this one reports. That
 * guarantee comes from the other direction: the objects built here are typed as
 * the engine's own `AgentView` and `AgentActions`, so a field the errands read
 * that changes shape in the engine fails this repository's typecheck rather than
 * quietly diverging.
 *
 * THE ALPHABET:
 *
 *   `#`  wall the character remembers
 *   `.`  floor the character remembers
 *   ` `  a grid the character has never seen
 *   `@`  the character, standing on floor
 *   `+`  a closed door the character remembers
 *   `>`  a down staircase the character remembers
 *   `~`  ground that burns, which the character remembers
 *   `*`  floor with something lying on it
 */

import type {
  AgentActions,
  AgentCommand,
  AgentView,
  CellView,
  GameConstants,
  ItemView,
  MonsterView,
  PlayerView,
  StoreView,
  SpellbookView,
  TargetView,
} from "@rpgm-tools/neo-angband-core";
import type { Loc } from "./grid.js";
import type { Terrain } from "./terrain.js";
import type { SquireContext } from "./context.js";
import type { Decision, Mission, Stop } from "./mission.js";
import { defaultCfg, type SquireCfg } from "./settings.js";
import { newProgress, type Progress } from "./progress.js";

/** Feature indices this harness uses. Arbitrary, and local to the harness. */
export const FEAT = {
  WALL: 1,
  FLOOR: 2,
  DOOR_CLOSED: 3,
  DOWN_STAIR: 4,
  LAVA: 5,
} as const;

/** The terrain classification matching FEAT. */
export function harnessTerrain(): Terrain {
  return {
    isDownStair: (feat) => feat === FEAT.DOWN_STAIR,
    isUpStair: () => false,
    isClosedDoor: (feat) => feat === FEAT.DOOR_CLOSED,
    isShopEntrance: () => false,
    isHarmful: (feat) => feat === FEAT.LAVA,
    size: Object.keys(FEAT).length,
  };
}

interface Square {
  feat: number;
  passable: boolean;
  known: boolean;
  objectCount: number;
}

function squareFor(glyph: string): Square {
  switch (glyph) {
    case "#":
      return { feat: FEAT.WALL, passable: false, known: true, objectCount: 0 };
    case " ":
      return { feat: FEAT.WALL, passable: false, known: false, objectCount: 0 };
    case "+":
      return { feat: FEAT.DOOR_CLOSED, passable: false, known: true, objectCount: 0 };
    case ">":
      return { feat: FEAT.DOWN_STAIR, passable: true, known: true, objectCount: 0 };
    case "~":
      return { feat: FEAT.LAVA, passable: true, known: true, objectCount: 0 };
    case "*":
      return { feat: FEAT.FLOOR, passable: true, known: true, objectCount: 1 };
    default:
      return { feat: FEAT.FLOOR, passable: true, known: true, objectCount: 0 };
  }
}

/** Everything a test may say about the character. */
export type PlayerSpec = Partial<Omit<PlayerView, "grid" | "status">> & {
  readonly status?: Partial<PlayerView["status"]>;
};

/** Everything a test may say about one creature. */
export type MonsterSpec = Partial<Omit<MonsterView, "grid">> & { readonly grid: Loc };

/** A described world. */
export interface WorldSpec {
  readonly map: readonly string[];
  readonly player?: PlayerSpec;
  readonly monsters?: readonly MonsterSpec[];
  readonly target?: TargetView | null;
}

/** A built world, plus what the errands did to it. */
export interface World {
  readonly view: AgentView;
  readonly act: AgentActions;
  readonly terrain: Terrain;
  /** Every command the act facade was asked to build, in order. */
  readonly issued: AgentCommand[];
  /** Move the character. */
  moveTo(at: Loc): void;
  /** Change the character. */
  setPlayer(patch: PlayerSpec): void;
  /** Replace the creatures. */
  setMonsters(monsters: readonly MonsterSpec[]): void;
  /** Reveal a grid the character had not seen. */
  reveal(at: Loc): void;
  /** The character's grid. */
  at(): Loc;
}

function fullPlayer(spec: PlayerSpec, grid: Loc): PlayerView {
  const status = {
    blind: 0,
    confused: 0,
    afraid: 0,
    poisoned: 0,
    cut: 0,
    stun: 0,
    paralyzed: 0,
    food: 5000,
    ...(spec.status ?? {}),
  };
  return {
    race: "Human",
    cls: "Warrior",
    level: 5,
    maxLevel: 5,
    exp: 100,
    maxExp: 100,
    gold: 100,
    depth: 1,
    maxDepth: 1,
    hp: 40,
    maxHp: 40,
    sp: 0,
    maxSp: 0,
    speed: 110,
    ac: 10,
    toHit: 5,
    toDam: 5,
    stats: [10, 10, 10, 10, 10],
    light: 2,
    dead: false,
    winner: false,
    skills: [],
    shape: null,
    objectFlags: [],
    classFlags: [],
    seeInfra: 0,
    blows: 1,
    shots: 1,
    ...spec,
    status,
    grid,
  } as PlayerView;
}

function fullMonster(spec: MonsterSpec, index: number): MonsterView {
  return {
    id: index + 1,
    race: "white jelly",
    raceIndex: 10,
    visible: true,
    hp: 20,
    maxHp: 20,
    speed: 110,
    asleep: false,
    afraid: false,
    confused: false,
    stunned: false,
    poisoned: false,
    level: 5,
    raceFlags: [],
    spellFlags: [],
    ...spec,
    grid: { x: spec.grid.x, y: spec.grid.y },
  } as MonsterView;
}

/**
 * Build a world.
 *
 * The two casts above and the one below are the harness admitting what it is.
 * `PlayerView`, `MonsterView` and `GameConstants` are large records describing a
 * real character, a real creature and the whole of z_info; a test that had to
 * fill every field of all three to ask whether an errand stops when it is hit
 * would be a test nobody writes. The fields the errands actually read are all
 * given real values, and the typecheck still fails if one of them changes shape.
 */
export function world(spec: WorldSpec): World {
  const rows = spec.map;
  const height = rows.length;
  const width = rows.reduce((widest, row) => Math.max(widest, row.length), 0);

  const squares: Square[][] = rows.map((row) => {
    const built: Square[] = [];
    for (let x = 0; x < width; x++) built.push(squareFor(row[x] ?? " "));
    return built;
  });

  let where: Loc = { x: 0, y: 0 };
  for (let y = 0; y < height; y++) {
    const index = (rows[y] ?? "").indexOf("@");
    if (index >= 0) where = { x: index, y };
  }

  let playerSpec: PlayerSpec = spec.player ?? {};
  let monsterSpecs: readonly MonsterSpec[] = spec.monsters ?? [];
  const issued: AgentCommand[] = [];

  const monsters = (): MonsterView[] => monsterSpecs.map(fullMonster);

  const view: AgentView = {
    apiVersion: "1.3.0",
    turn: () => 1,
    player: () => fullPlayer(playerSpec, where),
    monsters,
    cell: (x, y): CellView | null => {
      if (x < 0 || y < 0 || y >= height || x >= width) return null;
      const square = squares[y]?.[x];
      if (square === undefined) return null;
      const occupant = monsters().find((m) => m.grid.x === x && m.grid.y === y);
      const monster = where.x === x && where.y === y ? -1 : (occupant?.id ?? 0);
      return {
        x,
        y,
        feat: square.feat,
        passable: square.passable,
        inView: square.known,
        known: square.known,
        monster,
        objectCount: square.objectCount,
        glow: false,
        trap: false,
      };
    },
    mapBounds: () => ({ width, height }),
    inventory: (): ItemView[] => [],
    equipment: (): Array<ItemView | null> => [],
    floorItems: (): ItemView[] => [],
    target: (): TargetView | null => spec.target ?? null,
    messages: (): string[] => [],
    stores: (): StoreView[] => [],
    spellbooks: (): SpellbookView[] => [],
    constants: (): GameConstants => ({}) as GameConstants,
  };

  const record = (command: AgentCommand): AgentCommand => {
    issued.push(command);
    return command;
  };
  const simple =
    (code: string) =>
    (): AgentCommand =>
      record({ code });
  const directed =
    (code: string) =>
    (dir: number): AgentCommand =>
      record({ code, dir });
  const handled =
    (code: string) =>
    (handle: number): AgentCommand =>
      record({ code, args: { handle } });

  const act: AgentActions = {
    move: directed("walk"),
    melee: directed("melee"),
    hold: simple("hold"),
    rest: (count?: number): AgentCommand =>
      record(count === undefined ? { code: "rest" } : { code: "rest", args: { count } }),
    descend: simple("descend"),
    ascend: simple("ascend"),
    tunnel: directed("tunnel"),
    open: directed("open"),
    close: directed("close"),
    disarm: directed("disarm"),
    quaff: handled("quaff"),
    read: handled("read"),
    eat: handled("eat"),
    wear: handled("wear"),
    takeoff: handled("takeoff"),
    drop: (handle: number): AgentCommand => record({ code: "drop", args: { handle } }),
    pickup: simple("pickup"),
    destroy: handled("destroy"),
    aimWand: handled("aim"),
    zapRod: handled("zap"),
    useStaff: handled("use"),
    activate: handled("activate"),
    fire: handled("fire"),
    throw: handled("throw"),
    cast: (spell: number): AgentCommand => record({ code: "cast", args: { spell } }),
    setTargetMonster: () => true,
    setTargetLocation: () => undefined,
    shopBuy: (index: number): AgentCommand => record({ code: "shop-buy", args: { index } }),
    shopSell: (handle: number): AgentCommand => record({ code: "shop-sell", args: { handle } }),
    shopExit: simple("shop-exit"),
    raw: (code: string, args?: Record<string, unknown>): AgentCommand =>
      record(args === undefined ? { code } : { code, args }),
  };

  return {
    view,
    act,
    terrain: harnessTerrain(),
    issued,
    at: () => where,
    moveTo(to: Loc): void {
      where = to;
    },
    setPlayer(patch: PlayerSpec): void {
      playerSpec = { ...playerSpec, ...patch, status: { ...playerSpec.status, ...patch.status } };
    },
    setMonsters(next: readonly MonsterSpec[]): void {
      monsterSpecs = next;
    },
    reveal(at: Loc): void {
      const square = squares[at.y]?.[at.x];
      if (square !== undefined) square.known = true;
    },
  };
}

/** One errand under test, with the progress it accumulates across decisions. */
export interface Runner {
  readonly progress: Progress;
  readonly cfg: SquireCfg;
  /** The context as it stands right now. Rebuilt per call, as the host does. */
  context(): SquireContext;
  begin(): Stop | null;
  step(): Decision;
  /** Every line the errand logged. */
  readonly logged: string[];
}

/**
 * Drive one errand against a world.
 *
 * The context is rebuilt on every call rather than held, because that is what
 * the host does: the view and the act facade are arguments to each decision, and
 * an errand that cached either would be reading a world one decision out of date.
 */
export function run(w: World, mission: Mission, overrides: Partial<SquireCfg> = {}): Runner {
  const cfg: SquireCfg = { ...defaultCfg(), ...overrides };
  const progress = newProgress(w.view.player().depth);
  const logged: string[] = [];
  const context = (): SquireContext => ({
    view: w.view,
    act: w.act,
    terrain: w.terrain,
    cfg,
    progress,
    log: (message) => logged.push(message),
  });
  return {
    progress,
    cfg,
    context,
    logged,
    begin: () => mission.begin(context()),
    step: () => mission.step(context()),
  };
}
