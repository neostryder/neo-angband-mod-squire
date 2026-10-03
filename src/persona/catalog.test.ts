import { describe, expect, it } from "vitest";
import { GROUPS, PARAMETERS } from "./catalog.js";

describe("catalog", () => {
  it("has 73 unique ids in known groups", () => {
    expect(PARAMETERS).toHaveLength(73);
    expect(new Set(PARAMETERS.map((item) => item.id)).size).toBe(73);
    expect(PARAMETERS.every((item) => GROUPS.includes(item.group))).toBe(true);
  });

  it("places Law to Chaos in temperament and Good to Evil in values, both neutral at 50", () => {
    expect(PARAMETERS.find((item) => item.id === "lawchaos")).toMatchObject({ group: "temperament", kind: "slider", name: "Law to Chaos", scale: "lawful to chaotic" });
    expect(PARAMETERS.find((item) => item.id === "goodevil")).toMatchObject({ group: "values", kind: "slider", name: "Good to Evil", scale: "good to evil" });
    for (const id of ["lawchaos", "goodevil"]) expect("default" in PARAMETERS.find((item) => item.id === id)!).toBe(false);
  });

  it("gives every slider a scale with exactly two ends, so trait words and sheet labels split it in one place", () => {
    for (const item of PARAMETERS.filter((parameter) => parameter.kind === "slider")) expect(item.scale.split(" to "), item.id).toHaveLength(2);
  });
});
