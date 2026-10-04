/**
 * What a terrain feature index means, read from the game's terrain records.
 *
 * The agent view reports a numeric `feat` for each square. The terrain records (`ctx.composedRecords.terrain` under API 1, `content.records("terrain")` under API 2) are in feature-index order, the order the game binds them in, and each one names its flags. That is enough to say what a feature index is.
 *
 * Terrain is classified by flag, not by code. Upstream's codes are a closed list, and a mod that adds a second kind of down staircase gives it a code nothing here would recognise; but it has to set DOWNSTAIR for the game's own stair handling to work at all. Reading the flag classifies the game's terrain and a mod's on the same terms, so a terrain Squire has never heard of is still walked onto, dug through or avoided correctly.
 */

/** The part of a bound feature this mod reads. */
export interface FeatureLike {
  readonly fidx: number;
  readonly code: string;
  readonly flags: { has(flag: number): boolean };
}

/** The terrain flag indices this mod asks about, as the host numbers them. */
export interface TerrainFlagIndex {
  readonly PASSABLE: number;
  readonly DOWNSTAIR: number;
  readonly UPSTAIR: number;
  readonly DOOR_CLOSED: number;
  readonly CLOSABLE?: number;
  readonly SHOP: number;
  readonly FIERY: number;
  /** ROCK and PERMANENT, when the host numbers them, tell diggable rubble from a permanent wall. */
  readonly ROCK?: number;
  readonly PERMANENT?: number;
}

/** Names in Angband 4.2 terrain.txt for the shops that stock travel supplies. */
const SHOP_NAMES: Readonly<Record<string, string>> = {
  STORE_GENERAL: "General Store",
  STORE_ALCHEMY: "Alchemy Shop",
  STORE_WEAPON: "Weapon Smiths",
  STORE_ARMOR: "Armoury",
  STORE_BOOK: "Bookseller",
  STORE_MAGIC: "Magic Shop",
  STORE_BLACK: "Black Market",
  HOME: "Home",
};

/** Terrain indices grouped by what an errand does about them. */
export interface Terrain {
  isDownStair(feat: number): boolean;
  isUpStair(feat: number): boolean;
  isClosedDoor(feat: number): boolean;
  isOpenDoor?(feat: number): boolean;
  isShopEntrance(feat: number): boolean;
  /** The mapped town shop, without reading any store stock. */
  shopName(feat: number): string | null;
  /** Passable and it hurts to stand there. Lava, and whatever a mod adds. */
  isHarmful(feat: number): boolean;
  /**
   * Rock the character can dig through, rubble among it. Optional because the
   * older host does not name the ROCK and PERMANENT flags; a caller treats its
   * absence as "nothing here can be dug".
   */
  isDiggable?(feat: number): boolean;
  /** How many features were classified. Zero means there were no terrain records. */
  readonly size: number;
}

/**
 * Read a terrain classification out of a list of features.
 *
 * Nothing is inferred from a feature this call was not given. An empty list produces a Terrain that answers false to everything, so an errand walks the floor without ever taking a staircase or opening a door. That is visibly diminished rather than wrong, and the plugin logs the count so the diminished case can be told apart from a Squire that is simply not finding any stairs.
 */
export function readTerrain(
  features: readonly FeatureLike[],
  tf: TerrainFlagIndex,
): Terrain {
  const down = new Set<number>();
  const up = new Set<number>();
  const closed = new Set<number>();
  const open = new Set<number>();
  const shops = new Set<number>();
  const shopNames = new Map<number, string>();
  const harmful = new Set<number>();
  const diggable = new Set<number>();

  for (const feature of features) {
    const has = (flag: number): boolean => flag > 0 && feature.flags.has(flag);
    if (has(tf.DOWNSTAIR)) down.add(feature.fidx);
    if (has(tf.UPSTAIR)) up.add(feature.fidx);
    if (has(tf.DOOR_CLOSED)) closed.add(feature.fidx);
    if (tf.CLOSABLE !== undefined && has(tf.CLOSABLE)) open.add(feature.fidx);
    if (has(tf.SHOP)) {
      shops.add(feature.fidx);
      const name = SHOP_NAMES[feature.code];
      if (name !== undefined) shopNames.set(feature.fidx, name);
    }
    /* Rubble is rock that is not permanent: the tunnel command can clear it. */
    if (tf.ROCK !== undefined && has(tf.ROCK) && !(tf.PERMANENT !== undefined && has(tf.PERMANENT))) diggable.add(feature.fidx);
    /* Harmful is PASSABLE AND FIERY together, deliberately. FIERY alone would
     * take in a wall of fire a mod might add, which is not somewhere an errand
     * could step anyway, and PASSABLE alone is most of the map. What this set
     * is for is the one dangerous case: ground the character can walk onto and
     * should not. */
    if (has(tf.PASSABLE) && has(tf.FIERY)) harmful.add(feature.fidx);
  }

  return {
    isDownStair: (feat) => down.has(feat),
    isUpStair: (feat) => up.has(feat),
    isClosedDoor: (feat) => closed.has(feat),
    isOpenDoor: (feat) => open.has(feat),
    isShopEntrance: (feat) => shops.has(feat),
    shopName: (feat) => shopNames.get(feat) ?? null,
    isHarmful: (feat) => harmful.has(feat),
    isDiggable: (feat) => diggable.has(feat),
    size: features.length,
  };
}

/** One terrain record: its feature index, its code and its flags by name. */
export interface TerrainRecord {
  readonly fidx: number;
  readonly code: string;
  readonly flags: ReadonlySet<string>;
}

/** The flag names in a record's `flags` field, which lists them as lines such as "LOS | PROJECT | PASSABLE". */
export function recordFlags(value: unknown): Set<string> {
  const lines: readonly unknown[] = Array.isArray(value) ? value : value === undefined ? [] : [value];
  const names = new Set<string>();
  for (const line of lines) {
    if (typeof line !== "string") continue;
    for (const name of line.split("|")) {
      const trimmed = name.trim();
      if (trimmed !== "") names.add(trimmed);
    }
  }
  return names;
}

/** The terrain records in feature-index order. */
export function terrainRecords(records: readonly Readonly<Record<string, unknown>>[]): TerrainRecord[] {
  return records.map((record, fidx) => ({ fidx, code: typeof record["code"] === "string" ? record["code"] : "", flags: recordFlags(record["flags"]) }));
}

/** Flag numbers for readTerrain, which asks a feature about a flag by number. Each number stands for the flag name beside it. */
const FLAG_NUMBERS = { PASSABLE: 1, DOWNSTAIR: 2, UPSTAIR: 3, DOOR_CLOSED: 4, CLOSABLE: 5, SHOP: 6, FIERY: 7, ROCK: 8, PERMANENT: 9 } as const satisfies TerrainFlagIndex;
const FLAG_NAMES: ReadonlyMap<number, string> = new Map(Object.entries(FLAG_NUMBERS).map(([name, n]) => [n, name]));

/** Classify terrain from the records. Null or an empty list gives a Terrain that answers false for every feature. */
export function terrainFromRecords(records: readonly TerrainRecord[] | null | undefined): Terrain {
  if (records === null || records === undefined) return noTerrain();
  return readTerrain(records.map((record) => ({ fidx: record.fidx, code: record.code, flags: { has: (n: number) => record.flags.has(FLAG_NAMES.get(n) ?? "") } })), FLAG_NUMBERS);
}

/** An empty Terrain for test harnesses and for hosts without terrain records. Every flag check on it returns false. */
export function noTerrain(): Terrain {
  return {
    isDownStair: () => false,
    isUpStair: () => false,
    isClosedDoor: () => false,
    isShopEntrance: () => false,
    shopName: () => null,
    isHarmful: () => false,
    isDiggable: () => false,
    size: 0,
  };
}
