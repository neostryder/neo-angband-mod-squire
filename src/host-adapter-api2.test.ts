import { describe, expect, it } from "vitest";
import type { Api2EventMap, Api2InputState, Api2Subscription, JsonRecord, KnownMonster, KnownWorldData } from "@rpgm-tools/neo-angband-mod-sdk";
import { squareIsDisarmableTrap, TRF, type InputSnapshot } from "@rpgm-tools/neo-angband-core";
import { FEAT, world, type World } from "./harness.js";
import { GAME_TERRAIN } from "./terrain-records.fixture.js";
import { recordFlags } from "./terrain.js";
import { contentTerrain as contentTerrain1, viewInput as viewInput1, viewWorld as viewWorld1, type HostReads } from "./host-adapter.js";
import { contentTerrain, viewInput, viewWorld, watchMessages, type Api2Reads } from "./host-adapter-api2.js";

/*
 * Each test states one set of game facts twice: once as the API 1 host hands it over (an AgentView and an input snapshot), and once as API 2 hands it over (the known world Core builds from the same game, and the content records). The two adapters must then give the same answer wherever the known world carries the fact.
 */

const ok = <T>(value: T) => Promise.resolve({ ok: true as const, value });
const refused = () => Promise.resolve({ ok: false as const, reason: "unavailable" as const, message: "no game" });

interface FakeSpec {
  readonly world?: KnownWorldData | null;
  readonly input?: Api2InputState | null;
  readonly records?: Readonly<Record<string, readonly JsonRecord[]>>;
}

interface Fake {
  readonly api: Api2Reads;
  emit(text: string): void;
  readonly listening: () => number;
}

function fakeApi(spec: FakeSpec): Fake {
  const listeners = new Map<string, (payload: Api2EventMap["message"]) => void>();
  let next = 0;
  const api = {
    view: {
      world: () => (spec.world === undefined || spec.world === null ? refused() : ok(spec.world)),
      input: () => (spec.input === undefined || spec.input === null ? refused() : ok(spec.input)),
    },
    content: {
      records: (file: string) => {
        const records = spec.records?.[file];
        return records === undefined ? refused() : ok(records);
      },
    },
    events: {
      on: (name: string, listener: (payload: Api2EventMap["message"]) => void) => {
        if (name !== "message") return refused();
        const subscription: Api2Subscription = { id: `s${String(++next)}` };
        listeners.set(subscription.id, listener);
        return ok(subscription);
      },
      off: (subscription: Api2Subscription) => {
        listeners.delete(subscription.id);
        return ok(null);
      },
    },
  } as unknown as Api2Reads;
  return {
    api,
    emit: (text) => {
      for (const listener of listeners.values()) listener({ text, type: 0 });
    },
    listening: () => listeners.size,
  };
}

/** The look command's health bands (look_mon_desc), as Core's known world applies them. */
function bandOf(hp: number, maxHp: number): KnownMonster["health"] {
  if (hp >= maxHp) return "unhurt";
  const perc = Math.trunc((100 * hp) / maxHp);
  if (perc >= 60) return "somewhat";
  if (perc >= 25) return "wounded";
  if (perc >= 10) return "badly";
  return "almost";
}

/** Terrain records indexed by the harness's feature numbers, with PASSABLE where the harness map lets the character walk. */
function harnessTerrainRecords(): JsonRecord[] {
  const passable = new Set<number>([FEAT.FLOOR, FEAT.DOWN_STAIR, FEAT.LAVA, FEAT.GENERAL, FEAT.ALCHEMY, FEAT.WEAPON, FEAT.ARMOUR, FEAT.UP_STAIR, FEAT.OPEN_DOOR, FEAT.HOME]);
  const size = Math.max(...Object.values(FEAT)) + 1;
  return Array.from({ length: size }, (_, feat) => ({ code: `F${String(feat)}`, flags: passable.has(feat) ? ["LOS | PASSABLE"] : ["WALL"] }));
}

/** The first seven trap kinds, numbered and flagged as in the game's trap records. Only the trap door and the pit carry TRAP. */
const TRAP_RECORDS: JsonRecord[] = [
  { name: { name: "no trap" } },
  { name: { name: "glyph of warding" }, flags: ["GLYPH | VISIBLE | FLOOR"] },
  { name: { name: "decoy" }, flags: ["GLYPH | VISIBLE | FLOOR"] },
  { name: { name: "door lock" }, flags: ["LOCK | INVISIBLE"] },
  { name: { name: "web" }, flags: ["WEB | VISIBLE"] },
  { name: { name: "trap door" }, flags: ["TRAP | FLOOR | DOWN"] },
  { name: { name: "pit" }, flags: ["TRAP | FLOOR | PIT"] },
];

/** A trap on the live map: its kind, whether the character has found it, and how many turns it stays disabled. */
interface LiveTrap {
  readonly x: number;
  readonly y: number;
  readonly kind: number;
  readonly found: boolean;
  readonly timeout?: number;
}

/** The trap's live flags: its kind's flags, plus VISIBLE once the character has found it. */
function liveFlags(trap: LiveTrap): Set<number> {
  const names = recordFlags(TRAP_RECORDS[trap.kind]?.["flags"]);
  if (trap.found) names.add("VISIBLE");
  return new Set([...names].map((name) => TRF[name as keyof typeof TRF]));
}

/** The trap kind's name, as the known world reports it. */
function kindName(kind: number): string {
  const name = TRAP_RECORDS[kind]?.["name"];
  return name !== null && typeof name === "object" && !Array.isArray(name) && typeof name["name"] === "string" ? name["name"] : "";
}

/** Whether the API 1 view reports a trap on the trap's square, asked of the game's own CellView.trap predicate over the same live traps. */
function api1Trap(traps: readonly LiveTrap[], at: LiveTrap): boolean {
  const width = 64;
  const live = new Map<number, unknown[]>();
  for (const trap of traps) {
    const index = trap.y * width + trap.x;
    live.set(index, [...(live.get(index) ?? []), { tidx: trap.kind, kind: { tidx: trap.kind, name: kindName(trap.kind) }, grid: { x: trap.x, y: trap.y }, power: 0, timeout: trap.timeout ?? 0, flags: liveFlags(trap) }]);
  }
  const state = { chunk: { width }, traps: live } as unknown as Parameters<typeof squareIsDisarmableTrap>[0];
  return squareIsDisarmableTrap(state, { x: at.x, y: at.y });
}

/** The traps on a square as the known world remembers them: the visible ones, by kind index and name, as Core's known level lists them. */
function rememberedTraps(traps: readonly LiveTrap[], x: number, y: number): { index: number; name: string }[] {
  return traps.filter((trap) => trap.x === x && trap.y === y && liveFlags(trap).has(TRF.VISIBLE)).map((trap) => ({ index: trap.kind, name: kindName(trap.kind) }));
}

/** The harness world over these live traps, its API 1 view showing a trap wherever the game's predicate does. */
function worldWithTraps(spec: Parameters<typeof world>[0], traps: readonly LiveTrap[]): World {
  return world({ ...spec, traps: traps.filter((trap) => api1Trap(traps, trap)).map((trap) => ({ x: trap.x, y: trap.y })) });
}

/** The flags the character's monster lore has learned, for the known world. */
const LEARNED = new Set(["ANIMAL", "EVIL"]);

/** The known world Core builds from the same game the API 1 view shows, holding these live traps. */
function knownFrom(w: World, traps: readonly LiveTrap[] = SCENE_TRAPS): KnownWorldData {
  const view = w.view;
  const { width, height } = view.mapBounds();
  const cells: NonNullable<KnownWorldData["level"]>["cells"][number][] = [];
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const cell = view.cell(x, y);
      if (cell === null || !cell.known) continue;
      cells.push({
        x,
        y,
        visible: cell.inView,
        remembered: {
          feat: cell.feat,
          traps: rememberedTraps(traps, x, y),
          objects: Array.from({ length: cell.objectCount }, () => ({ sensed: true as const, money: false })),
        },
      });
    }
  }
  const token = { epoch: 1, revision: 7 };
  const player = view.player();
  return {
    version: 1,
    token,
    turn: view.turn(),
    player,
    inventory: view.inventory(),
    equipment: view.equipment(),
    quiver: view.quiver?.() ?? [],
    floorHere: view.floorItems(player.grid.x, player.grid.y),
    monsters: view.monsters().map((m): KnownMonster => ({
      id: m.id,
      race: m.race,
      raceIndex: m.raceIndex,
      grid: m.grid,
      visible: m.visible,
      health: bandOf(m.hp, m.maxHp),
      living: true,
      status: [...(m.asleep ? ["asleep" as const] : []), ...(m.confused ? ["confused" as const] : []), ...(m.afraid ? ["afraid" as const] : []), ...(m.stunned ? ["stunned" as const] : [])],
      look: "",
      raceLevel: m.level,
      raceSpeed: m.speed,
      knownFlags: m.raceFlags.filter((flag) => LEARNED.has(flag)),
      knownSpells: [...(m.knownSpellFlags ?? [])],
      unique: m.unique,
      questGuardian: m.questGuardian ?? false,
      finalGuardian: m.finalGuardian ?? false,
    })),
    target: view.target(),
    targetReadable: true,
    stores: view.stores(),
    spellbooks: view.spellbooks(),
    level: { token, levelId: 1, depth: player.depth, width, height, cells },
  };
}

/** The API 1 host for the same world: the view builder, a state, and an input snapshot carrying the pack and the worn gear. */
function api1Host(w: World): Pick<HostReads, "core" | "state" | "snapshot"> {
  const snapshot = { token: { epoch: 1, revision: 7 }, core: { inventory: w.view.inventory(), equipment: w.view.equipment() } } as unknown as InputSnapshot;
  return {
    core: { createAgentView: () => w.view } as unknown as NonNullable<HostReads["core"]>,
    state: {} as NonNullable<HostReads["state"]>,
    snapshot: () => snapshot,
  };
}

/** The scene's one trap: a trap door the character has found. */
const SCENE_TRAPS: readonly LiveTrap[] = [{ x: 2, y: 2, kind: 5, found: true }];

function scene(): World {
  return worldWithTraps({
    map: [
      "##########",
      "#@..*..>.#",
      "#..r.....#",
      "#...,,,..#",
      "#+########",
    ],
    player: { hp: 30, maxHp: 40, depth: 3 },
    monsters: [
      { grid: { x: 3, y: 2 }, race: "jackal", raceIndex: 12, hp: 7, maxHp: 8, level: 1, raceFlags: ["ANIMAL", "GROUP_AI"], asleep: true },
      { grid: { x: 6, y: 1 }, race: "white jelly", raceIndex: 10, hp: 3, maxHp: 20, level: 5, raceFlags: ["NEVER_MOVE", "EVIL"], afraid: true, stunned: true },
    ],
    target: { midx: 2, grid: { x: 6, y: 1 } },
    pack: ["3 Flasks of Oil", "2 Potions of Cure Light Wounds"],
    quiver: ["12 Arrows"],
    worn: ["a Dagger"],
    spells: [{ name: "Magic Missile", sidx: 0, mana: 1, fail: 22 }],
    floor: [{ x: 1, y: 1, name: "a Scroll of Phase Door" }],
  }, SCENE_TRAPS);
}

/*
 * One square for each trap kind. The door lock sits on a closed door, where the game puts one. The hidden pit has not been found, and the disabled pit has been found and switched off for three turns.
 */
const KIND_TRAPS: readonly LiveTrap[] = [
  { x: 2, y: 1, kind: 1, found: false },
  { x: 3, y: 1, kind: 2, found: false },
  { x: 4, y: 1, kind: 3, found: false },
  { x: 5, y: 1, kind: 4, found: false },
  { x: 6, y: 1, kind: 5, found: true },
  { x: 7, y: 1, kind: 6, found: true },
  { x: 8, y: 1, kind: 6, found: false },
];
const DISABLED_PIT: LiveTrap = { x: 2, y: 2, kind: 6, found: true, timeout: 3 };

function trapScene(traps: readonly LiveTrap[]): World {
  return worldWithTraps({
    map: [
      "##########",
      "#@..+....#",
      "#........#",
      "##########",
    ],
  }, traps);
}

function records(): Record<string, readonly JsonRecord[]> {
  const monsters: JsonRecord[] = [];
  monsters[10] = { name: "white jelly", "hit-points": 20 };
  monsters[12] = { name: "jackal", "hit-points": 8 };
  return {
    terrain: harnessTerrainRecords(),
    trap: TRAP_RECORDS,
    monster: Array.from({ length: 13 }, (_, i) => monsters[i] ?? { name: `race ${String(i)}` }),
    constants: [{ store: [{ label: "turns", value: 1000 }], player: [{ label: "max-sight", value: 20 }] }],
  };
}

describe("viewWorld under API 2", () => {
  it("gives the same player, gear, target, shops, spells, turn and map size as API 1", async () => {
    const w = scene();
    const one = viewWorld1(api1Host(w));
    const two = await viewWorld(fakeApi({ world: knownFrom(w), records: records() }).api);
    expect(one).not.toBeNull();
    expect(two).not.toBeNull();
    if (one === null || two === null) return;
    expect(two.player()).toEqual(one.player());
    expect(two.inventory()).toEqual(one.inventory());
    expect(two.equipment()).toEqual(one.equipment());
    expect(two.quiver?.()).toEqual(one.quiver?.());
    expect(two.target()).toEqual(one.target());
    expect(two.stores()).toEqual(one.stores());
    expect(two.spellbooks()).toEqual(one.spellbooks());
    expect(two.turn()).toBe(one.turn());
    expect(two.mapBounds()).toEqual(one.mapBounds());
    expect(two.floorItems(1, 1)).toEqual(one.floorItems(1, 1));
    expect(two.inputToken?.()).toEqual({ epoch: 1, revision: 7 });
  });

  it("gives the same answer for every square the character knows", async () => {
    const w = scene();
    const one = viewWorld1(api1Host(w));
    const two = await viewWorld(fakeApi({ world: knownFrom(w), records: records() }).api);
    if (one === null || two === null) throw new Error("no view");
    const { width, height } = one.mapBounds();
    let compared = 0;
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const a = one.cell(x, y);
        if (a === null || !a.known) continue;
        const b = two.cell(x, y);
        expect(b, `${String(x)},${String(y)}`).toMatchObject({ x, y, feat: a.feat, passable: a.passable, inView: a.inView, known: true, monster: a.monster, objectCount: a.objectCount, trap: a.trap });
        compared++;
      }
    }
    expect(compared).toBeGreaterThan(30);
    expect(two.cell(-1, 0)).toBeNull();
    expect(two.cell(width, 0)).toBeNull();
  });

  it("reads a trap on the same squares as API 1 for every trap kind", async () => {
    const w = trapScene(KIND_TRAPS);
    const known = knownFrom(w, KIND_TRAPS);
    const one = viewWorld1(api1Host(w));
    const two = await viewWorld(fakeApi({ world: known, records: records() }).api);
    if (one === null || two === null) throw new Error("no view");
    /* Every kind the character can see reaches the API 2 adapter as a remembered trap. The door lock is invisible and the hidden pit not yet found, so the known world leaves both out. */
    const remembered = new Map(known.level?.cells.map((c) => [`${String(c.x)},${String(c.y)}`, c.remembered.traps.map((t) => t.index)]));
    for (const trap of KIND_TRAPS) expect(remembered.get(`${String(trap.x)},${String(trap.y)}`), kindName(trap.kind)).toEqual(trap.kind === 3 || (trap.kind === 6 && !trap.found) ? [] : [trap.kind]);
    for (const trap of KIND_TRAPS) {
      const label = `${kindName(trap.kind)} at ${String(trap.x)},${String(trap.y)}`;
      expect(two.cell(trap.x, trap.y)?.trap, label).toBe(one.cell(trap.x, trap.y)?.trap);
    }
    /* API 1 reports only a found trap that carries TRAP: the found trap door and pit. A glyph, a decoy, a door lock and a web do not count. */
    expect(KIND_TRAPS.filter((trap) => one.cell(trap.x, trap.y)?.trap === true).map((trap) => trap.x)).toEqual([6, 7]);
  });

  it("still reads a trap the character has disabled as a trap, which API 1 does not", async () => {
    /* A remembered trap carries no timeout, so the API 2 adapter cannot tell a disabled trap from a live one (docs/API2-MIGRATION.md, request 25). */
    const w = trapScene([DISABLED_PIT]);
    const one = viewWorld1(api1Host(w));
    const two = await viewWorld(fakeApi({ world: knownFrom(w, [DISABLED_PIT]), records: records() }).api);
    expect(one?.cell(DISABLED_PIT.x, DISABLED_PIT.y)?.trap).toBe(false);
    expect(two?.cell(DISABLED_PIT.x, DISABLED_PIT.y)?.trap).toBe(true);
  });

  it("reads no trap from a remembered entry whose kind lacks TRAP, the door lock included", async () => {
    /* Core leaves the invisible door lock out of the known world. If a remembered entry ever names one, it still reads as no trap. */
    const w = trapScene([]);
    const known = knownFrom(w, []);
    const cells = (known.level?.cells ?? []).map((c) => (c.y === 1 && c.x >= 2 && c.x <= 7 ? { ...c, remembered: { ...c.remembered, traps: [{ index: c.x - 1, name: kindName(c.x - 1) }] } } : c));
    const two = await viewWorld(fakeApi({ world: { ...known, level: known.level === null ? null : { ...known.level, cells } }, records: records() }).api);
    for (let kind = 1; kind <= 6; kind++) {
      const found: LiveTrap = { x: kind + 1, y: 1, kind, found: true };
      expect(two?.cell(found.x, 1)?.trap, kindName(kind)).toBe(api1Trap([found], found));
    }
    expect([1, 2, 3, 4, 5, 6].map((kind) => two?.cell(kind + 1, 1)?.trap)).toEqual([false, false, false, false, true, true]);
  });

  it("shows nothing of a square the character has never seen", async () => {
    const w = scene();
    const one = viewWorld1(api1Host(w));
    const two = await viewWorld(fakeApi({ world: knownFrom(w), records: records() }).api);
    if (one === null || two === null) throw new Error("no view");
    /* The API 1 view reads the real map: the unseen floor at 4,3 shows as walkable. */
    expect(one.cell(4, 3)).toMatchObject({ known: false, passable: true, feat: FEAT.FLOOR });
    expect(two.cell(4, 3)).toMatchObject({ known: false, passable: false, feat: 0, trap: false, objectCount: 0 });
  });

  it("gives the same monsters, with hit points in the same health band and only the flags the lore has learned", async () => {
    const w = scene();
    const one = viewWorld1(api1Host(w));
    const two = await viewWorld(fakeApi({ world: knownFrom(w), records: records() }).api);
    if (one === null || two === null) throw new Error("no view");
    const a = one.monsters();
    const b = two.monsters();
    expect(b.map((m) => m.id)).toEqual(a.map((m) => m.id));
    for (const [i, m] of a.entries()) {
      const n = b[i];
      if (n === undefined) throw new Error("missing monster");
      expect(n).toMatchObject({ id: m.id, race: m.race, raceIndex: m.raceIndex, grid: m.grid, visible: m.visible, asleep: m.asleep, afraid: m.afraid, confused: m.confused, stunned: m.stunned, level: m.level, unique: m.unique });
      expect(n.maxHp).toBe(m.maxHp);
      expect(bandOf(n.hp, n.maxHp)).toBe(bandOf(m.hp, m.maxHp));
      expect(n.raceFlags).toEqual(m.raceFlags.filter((flag) => LEARNED.has(flag)));
    }
  });

  it("drains the messages the game printed since the last decision", async () => {
    const w = scene();
    const fake = fakeApi({ world: knownFrom(w), records: records() });
    const feed = await watchMessages(fake.api);
    fake.emit("You hit the jackal.");
    fake.emit("The jackal dies.");
    const two = await viewWorld(fake.api, { messages: feed });
    expect(two?.messages()).toEqual(["You hit the jackal.", "The jackal dies."]);
    expect(two?.messages()).toEqual([]);
    await feed.stop();
    expect(fake.listening()).toBe(0);
    expect(await viewWorld(fake.api).then((v) => v?.messages())).toEqual([]);
  });

  it("reads the store day from the constants records", async () => {
    const w = scene();
    const stock = await viewWorld(fakeApi({ world: knownFrom(w), records: records() }).api);
    expect(stock?.constants().storeTurns).toBe(1000);
    const changed = await viewWorld(fakeApi({ world: knownFrom(w), records: { ...records(), constants: [{ store: [{ label: "turns", value: 500 }] }] } }).api);
    expect(changed?.constants().storeTurns).toBe(500);
    const none = await viewWorld(fakeApi({ world: knownFrom(w), records: { terrain: harnessTerrainRecords() } }).api);
    expect(none?.constants().storeTurns).toBe(1000);
  });

  it("is null when the known world or the player cannot be read, as API 1 is without a game", async () => {
    expect(viewWorld1({})).toBeNull();
    expect(await viewWorld(fakeApi({ world: null }).api)).toBeNull();
    const w = scene();
    expect(await viewWorld(fakeApi({ world: { ...knownFrom(w), player: null } }).api)).toBeNull();
  });
});

describe("viewInput under API 2", () => {
  it("gives the same input wait as API 1", async () => {
    const input: Api2InputState = { token: { epoch: 2, revision: 9 }, driver: { kind: "controller", owner: "squire" }, phase: "play", messagePending: false, prompt: null };
    const snapshot = { ...input, core: {} } as unknown as InputSnapshot;
    const one = viewInput1({ snapshot: () => snapshot });
    const two = await viewInput(fakeApi({ input }).api);
    expect(two).toEqual({ token: one?.token, driver: one?.driver, phase: one?.phase, messagePending: one?.messagePending, prompt: one?.prompt });
    expect(viewInput1({ snapshot: () => null })).toBeNull();
    expect(await viewInput(fakeApi({ input: null }).api)).toBeNull();
  });
});

describe("contentTerrain under API 2", () => {
  it("classifies every feature the same way API 1 does", async () => {
    const one = contentTerrain1({ composedRecords: { terrain: GAME_TERRAIN } as unknown as NonNullable<HostReads["composedRecords"]> });
    const two = await contentTerrain(fakeApi({ records: { terrain: GAME_TERRAIN as unknown as JsonRecord[] } }).api);
    expect(two.size).toBe(one.size);
    for (let feat = 0; feat < GAME_TERRAIN.length; feat++) {
      const answers = (t: typeof one): unknown[] => [t.isDownStair(feat), t.isUpStair(feat), t.isClosedDoor(feat), t.isOpenDoor?.(feat), t.isShopEntrance(feat), t.shopName(feat), t.isHarmful(feat), t.isDiggable?.(feat)];
      expect(answers(two), GAME_TERRAIN[feat]?.code).toEqual(answers(one));
    }
    expect(two.isDownStair(6)).toBe(true);
  });

  it("classifies nothing without the terrain records", async () => {
    expect((await contentTerrain(fakeApi({}).api)).size).toBe(0);
  });
});

/* The API 2 adapter is held to the API 2 boundary: it imports nothing from the game at run time and never names the members API 2 takes away. */
describe("the API 2 adapter's own boundary", () => {
  it("imports only types from the game and the SDK", async () => {
    const { readFileSync } = await import("node:fs");
    const text = readFileSync(new URL("./host-adapter-api2.ts", import.meta.url), "utf8");
    const imports = text.split("\n").filter((line) => line.startsWith("import "));
    for (const line of imports.filter((l) => l.includes("@rpgm-tools/"))) expect(line.startsWith("import type ")).toBe(true);
    expect(text).not.toMatch(/\.\s*(?:core|state|registries|truth|snapshot)\b/);
  });
});
