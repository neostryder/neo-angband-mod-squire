import { describe, expect, it } from "vitest";
import { world } from "../harness.js";
import { studyable } from "./pack.js";

const ROOM = ["#####", "#.@.#", "#####"];

describe("studyable", () => {
  const spells = [{ name: "Magic Missile", sidx: 0, learned: false }, { name: "Detect Monsters", sidx: 1, learned: false }];

  it("offers the next unlearned spell in a carried book", () => {
    const w = world({ map: ROOM, pack: ["a Magic for Beginners"], spells });
    expect(studyable(w.view)?.sidx).toBe(0);
  });

  it("offers nothing more at a level where a study was refused", () => {
    const w = world({ map: ROOM, pack: ["a Magic for Beginners"], spells });
    expect(studyable(w.view, new Set(["5:0"]))).toBeNull();
    expect(studyable(w.view, new Set(["4:0"]))?.sidx).toBe(0);
  });
});
