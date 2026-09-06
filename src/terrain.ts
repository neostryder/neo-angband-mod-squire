/**
 * What a terrain feature index MEANS, read from the live feature registry.
 *
 * The agent view reports a numeric `feat` per cell and nothing else about it:
 * the namespaced `featCode` field it can also carry needs a content resolver
 * that the host supplies to the debug agent seam and not to a mod's controller,
 * so a mod reading terrain has a number and no name. That is enough, because
 * the bound feature registry arrives separately as `ctx.registries.features`
 * and it holds the record behind every index.
 *
 * CLASSIFIED BY FLAG, NOT BY CODE, and the difference is whether a mod's
 * terrain works. Upstream's own codes are a closed list; a mod that adds a
 * second kind of down staircase gives it a code nothing here would recognise,
 * but it has to set DOWNSTAIR for the game's own stair handling to work at all.
 * Reading the flag therefore classifies core's terrain and a mod's on exactly
 * the same terms, and a terrain this mod has never heard of is still walked
 * onto, dug through, or avoided correctly.
 *
 * The flag INDICES come from the host rather than being written down here, for
 * the same reason: they are generated from upstream's list-terrain.h and this
 * repository holds no copy of that list. A second copy is a copy that can be
 * wrong.
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
  readonly SHOP: number;
  readonly FIERY: number;
}

/** Terrain indices grouped by what an errand does about them. */
export interface Terrain {
  isDownStair(feat: number): boolean;
  isUpStair(feat: number): boolean;
  isClosedDoor(feat: number): boolean;
  isShopEntrance(feat: number): boolean;
  /** Passable and it hurts to stand there. Lava, and whatever a mod adds. */
  isHarmful(feat: number): boolean;
  /** How many features were classified. Zero means the registry was empty. */
  readonly size: number;
}

/**
 * Read a terrain classification out of the bound features.
 *
 * Nothing is inferred from a feature this call was not given. A registry that
 * arrives empty produces a Terrain that answers false to everything, which
 * makes an errand walk the floor without ever taking a staircase or opening a
 * door - visibly diminished rather than wrong, and the plugin logs the count so
 * the diminished case can be told apart from a Squire that is simply not
 * finding any stairs.
 */
export function readTerrain(
  features: readonly FeatureLike[],
  tf: TerrainFlagIndex,
): Terrain {
  const down = new Set<number>();
  const up = new Set<number>();
  const closed = new Set<number>();
  const shops = new Set<number>();
  const harmful = new Set<number>();

  for (const feature of features) {
    const has = (flag: number): boolean => flag > 0 && feature.flags.has(flag);
    if (has(tf.DOWNSTAIR)) down.add(feature.fidx);
    if (has(tf.UPSTAIR)) up.add(feature.fidx);
    if (has(tf.DOOR_CLOSED)) closed.add(feature.fidx);
    if (has(tf.SHOP)) shops.add(feature.fidx);
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
    isShopEntrance: (feat) => shops.has(feat),
    isHarmful: (feat) => harmful.has(feat),
    size: features.length,
  };
}

/** A terrain that knows nothing, for a harness that has no registry to give. */
export function noTerrain(): Terrain {
  return {
    isDownStair: () => false,
    isUpStair: () => false,
    isClosedDoor: () => false,
    isShopEntrance: () => false,
    isHarmful: () => false,
    size: 0,
  };
}
