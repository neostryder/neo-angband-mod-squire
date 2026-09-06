import { describe, expect, it } from "vitest";
import { noTerrain, readTerrain, type FeatureLike, type TerrainFlagIndex } from "./terrain.js";

/** The indices the engine happens to use, near enough for a table test. */
const TF: TerrainFlagIndex = {
  PASSABLE: 4,
  DOWNSTAIR: 28,
  UPSTAIR: 27,
  DOOR_CLOSED: 20,
  SHOP: 21,
  FIERY: 31,
};

function feature(fidx: number, code: string, flags: readonly number[]): FeatureLike {
  const set = new Set(flags);
  return { fidx, code, flags: { has: (flag) => set.has(flag) } };
}

describe("readTerrain", () => {
  const features = [
    feature(1, "FLOOR", [TF.PASSABLE]),
    feature(2, "GRANITE", []),
    feature(3, "CLOSED", [TF.DOOR_CLOSED]),
    feature(4, "MORE", [TF.PASSABLE, TF.DOWNSTAIR]),
    feature(5, "LESS", [TF.PASSABLE, TF.UPSTAIR]),
    feature(6, "LAVA", [TF.PASSABLE, TF.FIERY]),
    feature(7, "STORE_GENERAL", [TF.PASSABLE, TF.SHOP]),
  ];
  const terrain = readTerrain(features, TF);

  it("classifies stairs, doors and shops by their flags", () => {
    expect(terrain.isDownStair(4)).toBe(true);
    expect(terrain.isUpStair(5)).toBe(true);
    expect(terrain.isClosedDoor(3)).toBe(true);
    expect(terrain.isShopEntrance(7)).toBe(true);
  });

  it("calls ground harmful only when it is both walkable and burning", () => {
    expect(terrain.isHarmful(6)).toBe(true);
    expect(terrain.isHarmful(1)).toBe(false);
    const wallOfFire = readTerrain([feature(9, "FIREWALL", [TF.FIERY])], TF);
    expect(wallOfFire.isHarmful(9)).toBe(false);
  });

  it("classifies a terrain it has never heard of, because it reads the flag", () => {
    const modded = readTerrain(
      [feature(40, "MOD_TRAPDOOR", [TF.PASSABLE, TF.DOWNSTAIR])],
      TF,
    );
    expect(modded.isDownStair(40)).toBe(true);
  });

  it("says nothing about an index it was never given", () => {
    expect(terrain.isDownStair(99)).toBe(false);
    expect(terrain.isClosedDoor(99)).toBe(false);
  });

  it("counts what it classified, so an empty registry is visible", () => {
    expect(terrain.size).toBe(features.length);
    expect(readTerrain([], TF).size).toBe(0);
  });
});

describe("noTerrain", () => {
  it("answers false to everything and reports its own emptiness", () => {
    const terrain = noTerrain();
    expect(terrain.size).toBe(0);
    expect(terrain.isDownStair(4)).toBe(false);
    expect(terrain.isHarmful(6)).toBe(false);
  });
});
