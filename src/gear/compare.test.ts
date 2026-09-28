import { describe, expect, it } from "vitest";
import { TV as CORE_TV } from "@rpgm-tools/neo-angband-core";
import { TV } from "./compare.js";

describe("gear kinds", () => {
  it("numbers every item kind the way the engine does", () => {
    for (const [name, value] of Object.entries(TV)) expect(CORE_TV[name as keyof typeof CORE_TV]).toBe(value);
  });
});
