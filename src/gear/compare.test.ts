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
