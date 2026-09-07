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
 * THIS COPY DIFFERS FROM THE OTHER MODS', because Squire has not had a first
 * release. Its changelog carries an Unreleased section and nothing else, and
 * the repository carries no tags, so the third site has nothing to compare
 * against yet. That is a real state rather than a check worth skipping, and the
 * branch below is written so it cannot stay quietly vacuous: the moment a
 * version is dated the ordinary assertion takes over, and until then the shape
 * of the heading itself is pinned. A section written as `## [0.1.0] - <date>`
 * rather than `## 0.1.0 - <date>` would otherwise leave the main pattern
 * matching nothing here forever, which is the same silence this file exists to
 * remove.
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

    if (newest === null) {
      /* No released section yet. Assert the changelog is actually in that state
       * rather than in a state this pattern cannot read: every `## ` heading
       * must be the Unreleased one, so a dated section in any other spelling
       * fails here instead of being silently invisible. */
      const headings = [...text.matchAll(/^## (.+)$/gmu)].map((m) => m[1]?.trim() ?? "");
      expect(headings, "the changelog has a section this test cannot read").toEqual(
        headings.filter((h) => /^\[?Unreleased\]?$/u.test(h)),
      );
      return;
    }

    expect(newest[1]).toBe(read("./manifest.json"));
  });
});
