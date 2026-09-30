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
 *   `G`  General Store entrance
 *   `A`  Alchemy Shop entrance
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
import { TV } from "@rpgm-tools/neo-angband-core";
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
  GENERAL: 6,
  ALCHEMY: 7,
  WEAPON: 8,
  ARMOUR: 9,
  UP_STAIR: 10,
} as const;

/** The terrain classification matching FEAT. */
export function harnessTerrain(): Terrain {
  return {
    isDownStair: (feat) => feat === FEAT.DOWN_STAIR,
    isUpStair: (feat) => feat === FEAT.UP_STAIR,
    isClosedDoor: (feat) => feat === FEAT.DOOR_CLOSED,
    isShopEntrance: (feat) => feat >= FEAT.GENERAL && feat <= FEAT.ARMOUR,
    shopName: (feat) => ({ [FEAT.GENERAL]: "General Store", [FEAT.ALCHEMY]: "Alchemy Shop", [FEAT.WEAPON]: "Weapon Smiths", [FEAT.ARMOUR]: "Armoury" })[feat] ?? null,
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
    case "<":
      return { feat: FEAT.UP_STAIR, passable: true, known: true, objectCount: 0 };
    case "~":
      return { feat: FEAT.LAVA, passable: true, known: true, objectCount: 0 };
    case "*":
      return { feat: FEAT.FLOOR, passable: true, known: true, objectCount: 1 };
    case "G":
      return { feat: FEAT.GENERAL, passable: true, known: true, objectCount: 0 };
    case "A":
      return { feat: FEAT.ALCHEMY, passable: true, known: true, objectCount: 0 };
    case "W":
      return { feat: FEAT.WEAPON, passable: true, known: true, objectCount: 0 };
    case "U":
      return { feat: FEAT.ARMOUR, passable: true, known: true, objectCount: 0 };
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
  /** Carried items, by the name the inventory shows. Handles count up from 1. */
  readonly pack?: readonly string[];
  /** Item names in the quiver, in slot order. */
  readonly quiver?: readonly string[];
  /** Worn items, by shown name. */
  readonly worn?: readonly string[];
  /** Castable spells: name, index, mana and failure chance. */
  readonly spells?: readonly { readonly name: string; readonly sidx: number; readonly mana?: number; readonly fail?: number; readonly learned?: boolean }[];
  readonly stores?: readonly StoreView[];
  /** The engine's own line of fire to a grid, for tests of volleys. Absent keeps the single shot. */
  readonly projectionPath?: (to: Loc) => readonly Loc[];
  /** The engine's own walking route to a grid, for tests of engine travel. Absent keeps Squire's steps. */
  readonly travelPath?: (to: Loc) => readonly Loc[] | null;
}

/** An item as the inventory would show it, with only the fields the tests read. */
export function itemNamed(name: string, handle: number): ItemView {
  const kinds: readonly [RegExp, number][] = [
    [/\b(Arrows?|Seeker Arrows?)\b/i, TV.ARROW], [/\b(Bolts?|Seeker Bolts?)\b/i, TV.BOLT],
    [/\b(Shots?|Pebbles?)\b/i, TV.SHOT],
    [/\b(Sling|Bow|Crossbow)\b/i, TV.BOW], [/\b(Sword|Dagger|Blade)\b/i, TV.SWORD],
    [/\b(Axe|Spear|Pike|Halberd)\b/i, TV.POLEARM], [/\b(Mace|Whip|Hammer)\b/i, TV.HAFTED],
    [/\bBoots\b/i, TV.BOOTS], [/\bGloves\b/i, TV.GLOVES], [/\b(Helm|Helmet)\b/i, TV.HELM],
    [/\bCrown\b/i, TV.CROWN], [/\bShield\b/i, TV.SHIELD], [/\bCloak\b/i, TV.CLOAK],
    [/\b(Soft|Leather) Armour\b/i, TV.SOFT_ARMOR], [/\b(Hard|Metal|Chain|Plate) Armour\b/i, TV.HARD_ARMOR],
    [/\b(Lanterns?|Torch(?:es)?)\b/i, TV.LIGHT], [/\bAmulet\b/i, TV.AMULET], [/\bRing\b/i, TV.RING],
    [/\bRod\b/i, TV.ROD], [/\bScroll\b/i, TV.SCROLL],
  ];
  const tval = kinds.find(([pattern]) => pattern.test(name))?.[1] ?? 0;
  return { handle, name, label: name, tval, sval: 0, pval: 0, number: Number(/^(\d+)\s/.exec(name)?.[1] ?? 1), weight: 0, ac: 0, toA: 0, toH: 0, toD: 0, dd: 0, ds: 0, ego: false, artifact: false, flags: [], modifiers: [], brands: [], slays: [], resists: [], curses: [], egoName: null, artifactName: null, activation: false, timeout: 0, inscription: null } as unknown as ItemView;
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
  setPack(items: readonly string[]): void;
  setStores(stores: readonly StoreView[]): void;
  /** Reveal a grid the character had not seen. */
  reveal(at: Loc): void;
  /** The character's grid. */
  at(): Loc;
  /** Let game time pass. The turn starts at 1 and stays there unless a test moves it. */
  advance(turns: number): void;
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
  let packSpec: readonly string[] = spec.pack ?? [];
  let storeSpec: readonly StoreView[] = spec.stores ?? [];
  const issued: AgentCommand[] = [];
  let turn = 1;

  const monsters = (): MonsterView[] => monsterSpecs.map(fullMonster);

  const view: AgentView = {
    apiVersion: "1.3.0",
    turn: () => turn,
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
    inventory: (): ItemView[] => packSpec.map((name, i) => itemNamed(name, i + 1)),
    equipment: (): Array<ItemView | null> => (spec.worn ?? []).map((name, i) => itemNamed(name, 100 + i)),
    floorItems: (): ItemView[] => [],
    target: (): TargetView | null => spec.target ?? null,
    messages: (): string[] => [],
    stores: (): StoreView[] => [...storeSpec],
    spellbooks: (): SpellbookView[] =>
      spec.spells === undefined
        ? []
        : [
            {
              tval: 0,
              name: "Magic for Beginners",
              realm: "arcane",
              spells: spec.spells.map((sp) => ({
                name: sp.name,
                sidx: sp.sidx,
                bidx: 0,
                level: 1,
                mana: sp.mana ?? 1,
                fail: sp.fail ?? 20,
                learned: sp.learned ?? true,
                worked: true,
                forgotten: false,
              })),
            } as unknown as SpellbookView,
          ],
    constants: (): GameConstants => ({}) as GameConstants,
  };
  /* Newer games also show the quiver; older ones do not have the read at all. */
  if (spec.quiver !== undefined) {
    const quiver = spec.quiver;
    Object.assign(view, { quiver: (): ItemView[] => quiver.map((name, i) => itemNamed(name, 200 + i)) });
  }
  /* The engine's own route reads are optional on the real view too. */
  if (spec.projectionPath !== undefined) {
    const line = spec.projectionPath;
    Object.assign(view, { projectionPath: (to: Loc) => ({ token: { epoch: 0, revision: 0 }, grids: line(to) }) });
  }
  if (spec.travelPath !== undefined) {
    const route = spec.travelPath;
    Object.assign(view, {
      travelPath: (to: Loc) => {
        const grids = route(to);
        return grids === null ? null : { token: { epoch: 0, revision: 0 }, grids };
      },
    });
  }

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
    wear: handled("wield"),
    takeoff: handled("takeoff"),
    drop: (handle: number): AgentCommand => record({ code: "drop", args: { handle } }),
    pickup: simple("pickup"),
    destroy: handled("destroy"),
    aimWand: handled("aim"),
    zapRod: handled("zap-rod"),
    useStaff: handled("use"),
    activate: handled("activate"),
    fire: handled("fire"),
    throw: handled("throw"),
    cast: (spell: number): AgentCommand => record({ code: "cast", args: { spell } }),
    setTargetMonster: () => true,
    setTargetLocation: () => undefined,
    shopBuy: (index: number, quantity?: number): AgentCommand => record({ code: "shop-buy", args: quantity === undefined ? { index } : { index, quantity } }),
    shopSell: (handle: number, quantity?: number): AgentCommand => record({ code: "shop-sell", args: quantity === undefined ? { handle } : { handle, quantity } }),
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
    advance(turns: number): void {
      turn += turns;
    },
    moveTo(to: Loc): void {
      where = to;
    },
    setPlayer(patch: PlayerSpec): void {
      playerSpec = { ...playerSpec, ...patch, status: { ...playerSpec.status, ...patch.status } };
    },
    setMonsters(next: readonly MonsterSpec[]): void {
      monsterSpecs = next;
    },
    setPack(next: readonly string[]): void {
      packSpec = next;
    },
    setStores(next: readonly StoreView[]): void {
      storeSpec = next;
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
