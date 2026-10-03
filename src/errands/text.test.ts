import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { ERRAND_DONE, ERRAND_TEXT } from "./text.js";

/** Every string the table can produce, with a sample argument for the templates. */
function allStrings(value: unknown): string[] {
  if (typeof value === "string") return [value];
  if (typeof value === "function") return [String((value as (...args: string[]) => string)("&", "detail"))];
  if (value !== null && typeof value === "object") return Object.values(value).flatMap(allStrings);
  return [];
}

describe("the errand text table", () => {
  it("is plain ASCII throughout, with no dashes standing in for punctuation", () => {
    const strings = [...allStrings(ERRAND_TEXT), ...allStrings(ERRAND_DONE)];
    expect(strings.length).toBeGreaterThan(40);
    for (const text of strings) {
      expect(text).toMatch(/^[\x20-\x7e]*$/);
      expect(text).not.toContain(" - ");
      expect(text).not.toContain("--");
    }
  });

  it("matches the manifest's copy of the persona setting", () => {
    const manifest = JSON.parse(readFileSync(new URL("../../manifest.json", import.meta.url), "utf8")) as { rules: { flag: string; title: string; description: string; default: boolean }[] };
    const rule = manifest.rules.find((r) => r.flag === "squire.personaErrands");
    expect(rule).toMatchObject({ title: ERRAND_TEXT.colourTitle, description: ERRAND_TEXT.colourHelp, default: false });
  });
});
