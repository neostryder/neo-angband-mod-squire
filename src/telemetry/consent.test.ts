import { expect, it } from "vitest";
import { describeLevel } from "./consent.js";

it("explains each consent level in one sentence", () => {
  for (const level of ["off", "summary", "decisions", "full"] as const) {
    expect(describeLevel(level).split(".")).toHaveLength(2);
  }
  expect(describeLevel("off")).toContain("nothing");
});
