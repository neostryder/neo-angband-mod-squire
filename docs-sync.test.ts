import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

/**
 * `docs/README.md`'s settings table and `manifest.json` must agree.
 *
 * The table is the quick reference the game's own README links a player at, so
 * a switch that is renamed, removed, or flipped from on to off in the manifest
 * and left alone here does not read as out of date. It reads as fact, and the
 * player who follows it goes looking for a toggle that is not there.
 *
 * A toggle lives under EITHER `rules` or `sections`, and both render the same
 * way on the Mods screen. That is the specific trap this file exists for: the
 * first draft of the page was built from `rules` alone and silently lost two of
 * the four switches in this mod family's bug-fixes mod, and one of the five in
 * upstream-catchup, without anything failing. A section may also carry no flag
 * of its own, in which case its id is what identifies it.
 *
 * The description cell is deliberately NOT checked. It is the manifest's own
 * first sentence, and pinning prose here would fail on an ordinary reword and
 * teach the next person to delete the check rather than fix the page.
 */
describe("the settings table and the manifest", () => {
  interface Toggle {
    flag?: string;
    id?: string;
    title?: string;
    default?: unknown;
  }

  const manifest = (): { rules?: Toggle[]; sections?: Toggle[] } =>
    JSON.parse(readFileSync(new URL("./manifest.json", import.meta.url), "utf8")) as {
      rules?: Toggle[];
      sections?: Toggle[];
    };

  const toggles = (): Toggle[] => {
    const read = manifest();
    /* A section that carries neither a flag nor a default is a grouping
     * heading rather than a switch, and is not a row. */
    const sections = (read.sections ?? []).filter(
      (s) => s.flag !== undefined || s.default !== undefined,
    );
    return [...(read.rules ?? []), ...sections];
  };

  const identify = (t: Toggle): string => t.flag ?? t.id ?? "";

  const rows = (): { title: string; identifier: string; default: string }[] => {
    const text = readFileSync(new URL("./docs/README.md", import.meta.url), "utf8");
    return text
      .split("\n")
      .filter((line) => line.startsWith("| "))
      .map((line) =>
        line
          .split("|")
          .slice(1, -1)
          .map((cell) => cell.trim()),
      )
      .filter((cells) => cells.length === 4 && cells[0] !== "Setting" && cells[0] !== "---")
      .map((cells) => ({
        title: cells[0] ?? "",
        identifier: (cells[1] ?? "").replace(/`/gu, ""),
        default: cells[2] ?? "",
      }));
  };

  it("cover exactly the same switches", () => {
    expect(rows().map((r) => r.identifier).sort()).toEqual(
      toggles().map(identify).sort(),
    );
  });

  it("agree on every title and default", () => {
    const table = new Map(rows().map((r) => [r.identifier, r]));

    for (const toggle of toggles()) {
      const row = table.get(identify(toggle));
      expect(row, `${identify(toggle)} is missing from docs/README.md`).toBeDefined();
      expect(row?.title).toBe(toggle.title);
      expect(row?.default, `${identify(toggle)} disagrees on its default`).toBe(
        toggle.default === true ? "on" : "off",
      );
    }
  });
});
