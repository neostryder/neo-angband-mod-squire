import { describe, expect, it } from "vitest";
import { GROUPS, PARAMETERS } from "./catalog.js";

describe("catalog", () => {
  it("has 61 unique ids in known groups", () => {
    expect(PARAMETERS).toHaveLength(61);
    expect(new Set(PARAMETERS.map((item) => item.id)).size).toBe(61);
    expect(PARAMETERS.every((item) => GROUPS.includes(item.group))).toBe(true);
  });
});
