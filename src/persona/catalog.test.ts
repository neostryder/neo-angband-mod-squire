import { describe, expect, it } from "vitest";
import { GROUPS, PARAMETERS } from "./catalog.js";

describe("catalog", () => {
  it("has 65 unique ids in known groups", () => {
    expect(PARAMETERS).toHaveLength(65);
    expect(new Set(PARAMETERS.map((item) => item.id)).size).toBe(65);
    expect(PARAMETERS.every((item) => GROUPS.includes(item.group))).toBe(true);
  });
});
