/**
 * The API 2 form of host-adapter.ts: the same reads, made through `view`, `content` and `events` on a ModApi2 object. Squire gets no `truth`, so everything here is what the character knows.
 *
 * Nothing imports this file. The game builds a ModApi2 object only for an API 2 mod, and an API 2 mod cannot hold the controller, so Squire stays on API 1 until Core adds one. Then the entry point swaps its import from host-adapter.ts to this file. Two API 1 reads have no API 2 counterpart and are left out: the autoplayer mark on the save and the birth options. docs/API2-MIGRATION.md lists the Core request each one waits on.
 *
 * Every call is asynchronous, because each API 2 call answers with a result. viewWorld reads the known world once and returns an AgentView over that one reading, so the decision code keeps its synchronous view.
 *
 * Where the known world says less than the API 1 view did, this file fills the gap from what the player can know:
 *
 * - A monster's hit points come from its look-command health band and the average hit points in its race record. The API 1 view gave exact numbers.
 * - A monster's speed is its race speed. Its flags and spells are the ones the player's lore has learned.
 * - A square the character has never seen is not passable, has no feature and holds no trap. The API 1 view read the real map there.
 * - A trap the character has disabled still reads as a trap, because a remembered trap carries no timeout. The API 1 view reads it as no trap.
 * - No square glows, because the known level does not say which squares are lit.
 * - floorItems answers only for the character's own square.
 * - A timed effect is the lowest duration in the grade the status line names, so a check against a grade boundary (a cut worse than a bad cut) answers as API 1 does, and a check inside a grade does not. Food is the status line's percentage times 100, which loses less than one percent.
 * - Recall and Deep Descent read 1 while active and 0 otherwise, because the known player does not say when they fire.
 * - An item's timeout is the number its name says are charging. A light's fuel is not in the known item, so a torch or lantern reads as out of fuel.
 */

import type { Api2InputState, Api2Subscription, JsonRecord, KnownItem, KnownMonster, KnownPlayer, KnownStoreItem, KnownWorldData, ModApi2 } from "@rpgm-tools/neo-angband-mod-sdk";
import type { AgentView, CellView, GameConstants, ItemView, MonsterView, PlayerView, StoreItemView, StoreView } from "@rpgm-tools/neo-angband-core";
import { recordFlags, terrainFromRecords, terrainRecords as readTerrainRecords, type Terrain, type TerrainRecord } from "./terrain.js";

/** The parts of API 2 these reads use. */
export type Api2Reads = Pick<ModApi2, "view" | "content" | "events">;

/** The API 2 input wait: its token, driver, phase, pending message and open prompt. */
export type HostInput = Api2InputState;

/** Removes `readonly` all the way down, so known-world data can stand in for the API 1 view types. */
type Writable<T> = T extends (...args: never[]) => unknown
  ? T
  : T extends readonly (infer U)[]
    ? Writable<U>[]
    : T extends object
      ? { -readonly [K in keyof T]: Writable<T[K]> }
      : T;

function writable<T>(value: T): Writable<T> {
  return structuredClone(value) as Writable<T>;
}

/** The value of a successful call, or null for any failure. */
async function valueOf<T>(call: Promise<{ readonly ok: true; readonly value: T } | { readonly ok: false }>): Promise<T | null> {
  const result = await call;
  return result.ok ? result.value : null;
}

/** Messages the game printed since the last decision, collected from the `message` event. */
export interface MessageFeed {
  /** Return every message printed since the previous call, oldest first, and empty the feed. */
  drain(): string[];
  /** Stop listening. */
  stop(): Promise<void>;
}

/** Start collecting messages. Without the event grant the feed stays empty. */
export async function watchMessages(api: Pick<ModApi2, "events">): Promise<MessageFeed> {
  let batch: string[] = [];
  const subscription: Api2Subscription | null = await valueOf(api.events.on("message", (event) => {
    batch.push(event.text);
  }));
  return {
    drain: () => {
      const out = batch;
      batch = [];
      return out;
    },
    stop: async () => {
      if (subscription !== null) await api.events.off(subscription);
    },
  };
}

/* Terrain. */

async function terrainRecords(api: Pick<ModApi2, "content">): Promise<readonly TerrainRecord[] | null> {
  const records = await valueOf(api.content.records("terrain"));
  return records === null ? null : readTerrainRecords(records);
}

/** Terrain sorted by what an errand does with it, for `content.records("terrain")`. Without the records, nothing is classified. */
export async function contentTerrain(api: Pick<ModApi2, "content">): Promise<Terrain> {
  return terrainFromRecords(await terrainRecords(api));
}

/* Monsters. */

/** A health band's middle, as a share of full health, inside the band the look command draws. */
const BAND_SHARE: Readonly<Record<KnownMonster["health"], number>> = { unhurt: 1, somewhat: 0.8, wounded: 0.42, badly: 0.17, almost: 0.05 };

/** Hit points inside the monster's band, out of its race's average. */
function hitPoints(monster: KnownMonster, average: number | undefined): { hp: number; maxHp: number } {
  const maxHp = average !== undefined && average > 0 ? average : 100;
  if (monster.health === "unhurt") return { hp: maxHp, maxHp };
  return { hp: Math.min(maxHp - 1, Math.max(1, Math.round(maxHp * BAND_SHARE[monster.health]))), maxHp };
}

function monsterView(monster: KnownMonster, average: number | undefined): MonsterView {
  const has = (status: KnownMonster["status"][number]): boolean => monster.status.includes(status);
  const view: MonsterView = {
    id: monster.id,
    race: monster.race,
    raceIndex: monster.raceIndex,
    grid: { x: monster.grid.x, y: monster.grid.y },
    visible: monster.visible,
    ...hitPoints(monster, average),
    speed: monster.raceSpeed,
    asleep: has("asleep"),
    afraid: has("afraid"),
    confused: has("confused"),
    stunned: has("stunned"),
    level: monster.raceLevel,
    poisoned: false,
    raceFlags: [...monster.knownFlags],
    unique: monster.unique,
    questGuardian: monster.questGuardian,
    finalGuardian: monster.finalGuardian,
    spellFlags: [...monster.knownSpells],
    knownSpellFlags: [...monster.knownSpells],
  };
  if (monster.raceId !== undefined) view.raceId = monster.raceId;
  if (monster.glyph !== undefined) view.glyph = monster.glyph;
  return view;
}

/** Average hit points by race index, from the monster records. A record whose name differs from the monster's race is not used. */
async function raceAverages(api: Pick<ModApi2, "content">): Promise<(monster: KnownMonster) => number | undefined> {
  const records = (await valueOf(api.content.records("monster"))) ?? [];
  return (monster) => {
    const record: JsonRecord | undefined = records[monster.raceIndex];
    const hp = record?.["hit-points"];
    return record?.["name"] === monster.race && typeof hp === "number" ? hp : undefined;
  };
}

/* Constants. */

/** The constants the game reads from its constants records; every other one keeps its built-in value (DEFAULT_GAME_CONSTANTS). */
const DEFAULT_CONSTANTS: GameConstants = {
  moveEnergy: 100,
  maxSight: 20,
  maxRange: 20,
  fleeRange: 5,
  turnRange: 5,
  reproMonsterMax: 100,
  reproMonsterRate: 8,
  glyphHardness: 550,
  dayLength: 10000,
  foodValue: 100,
  foodStarve: 100,
  foodFaint: 400,
  foodWeak: 800,
  foodHungry: 1500,
  allocMonsterChance: 500,
  storeTurns: 1000,
  lifeDrainPercent: 2,
  levelMonsterMax: 1024,
  floorSize: 23,
  maxDepth: 128,
  stairSkip: 1,
};

/** Section and label of each constant the game takes from its records. */
const CONSTANT_SOURCES: Readonly<Partial<Record<keyof GameConstants, readonly [string, string]>>> = {
  maxSight: ["player", "max-sight"],
  maxRange: ["player", "max-range"],
  floorSize: ["carry-cap", "floor-size"],
  maxDepth: ["world", "max-depth"],
  stairSkip: ["world", "stair-skip"],
  dayLength: ["world", "day-length"],
  foodValue: ["player", "food-value"],
  allocMonsterChance: ["mon-gen", "chance"],
  storeTurns: ["store", "turns"],
  lifeDrainPercent: ["mon-play", "life-drain"],
  levelMonsterMax: ["level-max", "monsters"],
};

async function gameConstants(api: Pick<ModApi2, "content">): Promise<GameConstants> {
  const records = (await valueOf(api.content.records("constants"))) ?? [];
  const lookup = (section: string, label: string): number | undefined => {
    for (const record of records) {
      const entries = record[section];
      if (!Array.isArray(entries)) continue;
      for (const entry of entries) {
        if (entry !== null && typeof entry === "object" && !Array.isArray(entry) && entry["label"] === label && typeof entry["value"] === "number") return entry["value"];
      }
    }
    return undefined;
  };
  const out: GameConstants = { ...DEFAULT_CONSTANTS };
  for (const [field, source] of Object.entries(CONSTANT_SOURCES) as [keyof GameConstants, readonly [string, string]][]) {
    const value = lookup(source[0], source[1]);
    if (value !== undefined) out[field] = value;
  }
  return out;
}

/* The player. */

/** The timed effect record behind each status field, by its name in the game's player_timed file. */
const TIMED_RECORDS: Readonly<Record<Exclude<keyof KnownPlayer["status"], "food" | "foodGrade" | "fearful">, string>> = {
  blind: "BLIND",
  confused: "CONFUSED",
  afraid: "AFRAID",
  poisoned: "POISONED",
  cut: "CUT",
  stun: "STUN",
  paralyzed: "PARALYZED",
  fast: "FAST",
  sprint: "SPRINT",
  protEvil: "PROTEVIL",
  hero: "HERO",
  shero: "SHERO",
  shield: "SHIELD",
  stoneskin: "STONESKIN",
  blessed: "BLESSED",
  fastcast: "FASTCAST",
  resAcid: "OPP_ACID",
  resElec: "OPP_ELEC",
  resFire: "OPP_FIRE",
  resCold: "OPP_COLD",
  resPois: "OPP_POIS",
  terror: "TERROR",
  amnesia: "AMNESIA",
  image: "IMAGE",
};

/** The lowest duration in each named grade of each timed effect, from the player_timed records. */
type GradeFloors = ReadonlyMap<string, ReadonlyMap<string, number>>;

async function gradeFloors(api: Pick<ModApi2, "content">): Promise<GradeFloors> {
  const records = (await valueOf(api.content.records("player_timed"))) ?? [];
  const out = new Map<string, Map<string, number>>();
  for (const record of records) {
    const name = record["name"];
    const grades = record["grade"];
    if (typeof name !== "string" || !Array.isArray(grades)) continue;
    const floors = new Map<string, number>();
    let floor = 1;
    for (const grade of grades) {
      if (grade === null || typeof grade !== "object" || Array.isArray(grade)) continue;
      const label = grade["name"];
      if (typeof label === "string" && label !== "" && !floors.has(label)) floors.set(label, floor);
      if (typeof grade["max"] === "number") floor = grade["max"] + 1;
    }
    out.set(name, floors);
  }
  return out;
}

/** A known player as the API 1 player view, with each timed effect at the floor of its named grade. */
function playerView(known: KnownPlayer, floors: GradeFloors): PlayerView {
  const { status, recall, descent, ...rest } = writable(known);
  const timed = {} as Record<keyof typeof TIMED_RECORDS, number>;
  for (const [field, record] of Object.entries(TIMED_RECORDS) as [keyof typeof TIMED_RECORDS, string][]) {
    const grade = status[field];
    /* A grade the records do not name (an older or patched file) still says the effect is on. */
    timed[field] = grade === null ? 0 : (floors.get(record)?.get(grade) ?? 1);
  }
  return { ...rest, status: { ...timed, food: status.food * 100, fearful: status.fearful }, recall: recall ? 1 : 0, descent: descent ? 1 : 0 };
}

/* The view. */

function itemView(item: KnownItem): ItemView {
  const { charging, unknownRunes: _unknownRunes, ...rest } = writable(item);
  return { ...rest, timeout: charging };
}

function storeItemView(item: KnownStoreItem): StoreItemView {
  const { index, price } = item;
  return { ...itemView(item), index, ...(price === undefined ? {} : { price }) };
}

/** What viewWorld needs besides the API: the message feed, when the mod keeps one. */
export interface WorldReads {
  readonly messages?: MessageFeed;
}

/**
 * The game as the player knows it, for `view.world()`, as the AgentView the decision code is written against. Null when the known world or the player cannot be read.
 */
export async function viewWorld(api: Api2Reads, reads: WorldReads = {}): Promise<AgentView | null> {
  const known: KnownWorldData | null = await valueOf(api.view.world());
  if (known === null || known.player === null) return null;
  const [terrain, average, constants, floors] = await Promise.all([terrainRecords(api), raceAverages(api), gameConstants(api), gradeFloors(api)]);
  const trapKinds = (await valueOf(api.content.records("trap"))) ?? [];

  const player = playerView(known.player, floors);
  const monsters = (known.monsters ?? []).map((monster) => monsterView(monster, average(monster)));
  const width = known.level?.width ?? 0;
  const height = known.level?.height ?? 0;
  const cells = new Map<number, NonNullable<KnownWorldData["level"]>["cells"][number]>();
  for (const cell of known.level?.cells ?? []) cells.set(cell.y * width + cell.x, cell);
  const passable = (feat: number): boolean => terrain?.[feat]?.flags.has("PASSABLE") ?? false;
  /* Under API 1, CellView.trap is the check the disarm command makes before it spends a turn: a visible trap whose kind carries TRAP and that is not disabled. The known world lists only visible traps, so the kind's TRAP flag decides here. A door lock, a web, a glyph of warding and a decoy carry no TRAP, so none of them counts. */
  const playerTrap = (index: number): boolean => recordFlags(trapKinds[index]?.["flags"]).has("TRAP");
  const inventory = (known.inventory ?? []).map(itemView);
  const equipment = (known.equipment ?? []).map((item) => (item === null ? null : itemView(item)));
  const quiver = (known.quiver ?? []).map(itemView);
  const floorHere = (known.floorHere ?? []).map(itemView);

  const cell = (x: number, y: number): CellView | null => {
    if (x < 0 || y < 0 || x >= width || y >= height) return null;
    const occupant = player.grid.x === x && player.grid.y === y ? -1 : (monsters.find((m) => m.grid.x === x && m.grid.y === y)?.id ?? 0);
    const remembered = cells.get(y * width + x);
    if (remembered === undefined) {
      return { x, y, feat: 0, passable: false, inView: false, known: false, monster: occupant, objectCount: 0, knownObjectCount: 0, glow: false, trap: false };
    }
    const view: CellView = {
      x,
      y,
      feat: remembered.remembered.feat,
      passable: passable(remembered.remembered.feat),
      inView: remembered.visible,
      known: true,
      monster: occupant,
      objectCount: remembered.remembered.objects.length,
      knownObjectCount: remembered.remembered.objects.length,
      glow: false,
      trap: remembered.remembered.traps.some((trap) => playerTrap(trap.index)),
    };
    if (remembered.remembered.featCode !== undefined) view.featCode = remembered.remembered.featCode;
    return view;
  };

  const view: AgentView = {
    apiVersion: "2.0.0",
    turn: () => known.turn ?? 0,
    player: () => writable(player),
    monsters: () => monsters.map((m) => writable(m)),
    cell,
    mapBounds: () => ({ width, height }),
    inventory: () => [...inventory],
    quiver: () => [...quiver],
    equipment: () => [...equipment],
    floorItems: (x, y) => (x === player.grid.x && y === player.grid.y ? [...floorHere] : []),
    target: () => (known.target === null ? null : { midx: known.target.monster ?? 0, grid: { x: known.target.grid.x, y: known.target.grid.y } }),
    messages: () => reads.messages?.drain() ?? [],
    stores: () => (known.stores ?? []).map((store): StoreView => ({ ...writable(store), stock: store.stock.map(storeItemView) })),
    spellbooks: () => (known.spellbooks ?? []).map((book) => writable(book)),
    constants: () => ({ ...constants }),
    inputToken: () => ({ epoch: known.token.epoch, revision: known.token.revision }),
  };
  return view;
}

/** The current input wait, for `view.input()`. */
export async function viewInput(api: Pick<ModApi2, "view">): Promise<HostInput | null> {
  return valueOf(api.view.input());
}
