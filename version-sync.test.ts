import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

/**
 * `package.json` and `manifest.json` must carry the same version.
 *
 * The game reads `manifest.json`, so that is the version a player installs and
 * the one a release tag matches. `package.json` is only what the build and the
 * toolchain see, which is exactly why it can drift without anything noticing:
 * in the qol mod it sat at 1.1.1 through the 1.2.0, 1.3.0 and 1.4.0 releases,
 * three tags out of date, and nothing failed.
 *
 * The changelog is the third site, and the one with the longest reach. A
 * version whose section is undated is a release nobody can read the notes for,
 * and The Ledger builds every entry from that version's own section at its tag,
 * so a missing one is a version that reaches the site as nothing at all.
 *
 * Released headings are spelled `## 1.0.0 - <date>`. One written with
 * brackets would not match, and the test fails rather than compare nothing.
 */
describe("the two version sites", () => {
  const read = (f: string): string =>
    (JSON.parse(readFileSync(new URL(f, import.meta.url), "utf8")) as { version: string }).version;

  const changelog = (): string => readFileSync(new URL("./CHANGELOG.md", import.meta.url), "utf8");

  it("agree", () => {
    expect(read("./package.json")).toBe(read("./manifest.json"));
  });

  it("are the version the changelog's newest released section names", () => {
    const text = changelog();
    const newest = /^## (\d+\.\d+\.\d+) - /mu.exec(text);

    expect(newest, "the changelog has no dated section this test can read").not.toBeNull();

    expect(newest?.[1]).toBe(read("./manifest.json"));
  });
});
