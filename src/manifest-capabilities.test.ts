/**
 * The manifest's capability list.
 *
 * Which capabilities the code needs is the SDK checker's job (`pnpm
 * capabilities`, which runs `neo-angband-mod-check --first-party` over the
 * built plugin and this manifest), because API 2 gates each domain call on a
 * grant and the checker holds the table that says which. What the checker
 * cannot say is that a grant is wider than it needs to be, so this file keeps
 * the two promises about the list that are Squire's own.
 */

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));

function capabilities(): readonly string[] {
  return (JSON.parse(readFileSync(join(repoRoot, "manifest.json"), "utf8")) as { data: { capabilities: readonly string[] } }).data.capabilities;
}

describe("manifest capabilities", () => {
  it("asks for no wildcard read", () => {
    /* `state:*.read` would cover every domain in one line and would grant a
       domain the mod does not read today and any domain a newer engine adds.
       The consent screen a player reads before handing over a character lists
       these, so the list is worth keeping honest. */
    expect(capabilities()).not.toContain("state:*.read");
  });

  it("holds the three grants the game checks before it calls a controller", () => {
    /* Without state:interaction.read the game never calls the controller, and without the two input grants every intent and prompt answer is refused. Nothing else says so: the SDK checker does not flag their absence, and the failure is a character that holds the keyboard and never moves. */
    for (const grant of ["state:interaction.read", "input:intent", "input:prompt.reply"]) expect(capabilities()).toContain(grant);
  });

  it("lists each capability once", () => {
    expect(new Set(capabilities()).size).toBe(capabilities().length);
  });
});
