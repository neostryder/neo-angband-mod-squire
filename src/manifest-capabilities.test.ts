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

  it("holds the four grants the game checks before it installs and calls a controller", () => {
    /* Without input:controller the game never offers Squire the keyboard: it installs a controller only for a mod the player consented to drive the game (input:controller and input:intent), and a character armed from the title row or a roll-on then stands in town with nobody playing it. Without state:interaction.read the game never calls the controller, and without the two other input grants every intent and prompt answer is refused. Nothing else says so: the SDK checker does not flag their absence, and the failure is a character that holds the keyboard and never moves. */
    for (const grant of ["input:controller", "state:interaction.read", "input:intent", "input:prompt.reply"]) expect(capabilities()).toContain(grant);
  });

  it("can read the save's autoplayer mark, so Ctrl-Z hands it the keyboard", () => {
    /* After the player confirms Ctrl-Z the game reloads, and for a mod that runs in the game's own process the controller context does not say it was armed. armed() then offers to play only if it can read NOSCORE_BORG on the save, which the game hands over only through the engine domain, and only with engine:access. */
    expect(capabilities()).toContain("engine:access");
  });

  it("holds ui:region.create, the grant the game checks before it hands over the panel host", () => {
    /* The game gives an in-process mod presentation.panels only with ui:region.create, so without it registerPanelKind never runs and the panel silently never appears. The SDK checker does not flag a missing grant, and nothing is logged, so this test is the only guard. */
    expect(capabilities()).toContain("ui:region.create");
  });

  it("lists each capability once", () => {
    expect(new Set(capabilities()).size).toBe(capabilities().length);
  });

  it("can read object knowledge to retire inherited class wariness", () => {
    expect(capabilities()).toContain("state:knowledge.read");
  });
});
