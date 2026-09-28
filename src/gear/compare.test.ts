import { describe, expect, it } from "vitest";
import { TV as CORE_TV } from "@rpgm-tools/neo-angband-core";
import { sameKind, TV } from "./compare.js";

describe("gear kinds", () => {
  it("numbers every item kind the way the engine does", () => {
    for (const [name, value] of Object.entries(TV)) expect(CORE_TV[name as keyof typeof CORE_TV]).toBe(value);
  });
});

describe("sameKind", () => {
  it("ignores count, article and fuel", () => {
    expect(sameKind("a Wooden Torch (4989 turns)", "2 Wooden Torches (4990 turns)")).toBe(true);
    expect(sameKind("a Wooden Torch (5000 turns)", "a Lantern (7500 turns)")).toBe(false);
  });
});

describe("an empty light slot", () => {
  it("lights a plain torch at once, whatever the persona's curiosity", async () => {
    const { world } = await import("../harness.js");
    const { gearCandidates } = await import("./compare.js");
    const dark = world({ map: ["#####", "#.@.#", "#####"], pack: ["2 Wooden Torches (5000 turns)"] });
    expect(gearCandidates(dark.view)[0]).toMatchObject({ handle: 1, unknown: false });
    const lit = world({ map: ["#####", "#.@.#", "#####"], pack: ["2 Wooden Torches (5000 turns)"], worn: ["a Wooden Torch (2000 turns)"] });
    expect(gearCandidates(lit.view)).toEqual([]);
  });
});

describe("a light running out", () => {
  it("swaps a burnt-out or nearly empty torch for a full one", async () => {
    const { world } = await import("../harness.js");
    const { gearCandidates } = await import("./compare.js");
    const out = world({ map: ["#####", "#.@.#", "#####"], pack: ["2 Wooden Torches (5000 turns)"], worn: ["a Wooden Torch (0 turns)"] });
    expect(gearCandidates(out.view)[0]).toMatchObject({ handle: 1, unknown: false });
    const low = world({ map: ["#####", "#.@.#", "#####"], pack: ["2 Wooden Torches (5000 turns)"], worn: ["a Wooden Torch (90 turns)"] });
    expect(gearCandidates(low.view)[0]?.criteria).toContain("nearly out of fuel");
  });
});
