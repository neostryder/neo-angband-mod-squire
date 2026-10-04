/**
 * The plugin ABI, checked at the seam the host actually calls.
 *
 * These tests build the plugin context by hand. The game passes the whole engine namespace and every composed record file, but the plugin reads only the terrain records and the save's autoplayer mark, so casts fill in the rest. Checking that an uninstalled mod declines should not need a booted game.
 */

import { describe, expect, it } from "vitest";
import type * as Core from "@rpgm-tools/neo-angband-core";
import plugin from "./plugin.js";

const NOSCORE_BORG = 0x0020;

/** Three terrain records, in the shape the game composes them. */
function terrain(): unknown[] {
  return [
    { code: "FLOOR", flags: ["LOS | PROJECT | PASSABLE"] },
    { code: "GRANITE", flags: ["WALL | ROCK | GRANITE"] },
    { code: "MORE", flags: ["LOS | PROJECT | PASSABLE | STAIR | DOWNSTAIR"] },
  ];
}

interface Built {
  ctx: Parameters<typeof plugin.controller>[0];
  logged: string[];
}

function context(options: { noscore?: number; withRecords?: boolean } = {}): Built {
  const logged: string[] = [];
  const records = options.withRecords === false ? {} : { terrain: terrain() };
  return {
    logged,
    ctx: {
      flags: {},
      core: {} as unknown as typeof Core,
      log: (message: string) => logged.push(message),
      composedRecords: records as unknown as NonNullable<Parameters<typeof plugin.controller>[0]["composedRecords"]>,
      state: { actor: { player: { noscore: options.noscore ?? 0 } } } as unknown as { readonly actor: { readonly player: Pick<Core.Player, "noscore"> } },
    },
  };
}

describe("the Squire plugin", () => {
  it("declines the keyboard on a character that has never handed it over", () => {
    const { ctx, logged } = context({ noscore: 0 });
    expect(plugin.controller(ctx)).toBeUndefined();
    expect(logged).toHaveLength(0);
  });

  it("offers a controller once the character carries the autoplayer mark", () => {
    const { ctx } = context({ noscore: NOSCORE_BORG });
    const installed = plugin.controller(ctx);
    expect(installed).toMatchObject({ controller: expect.any(Function), onDeath: "end" });
  });

  it("offers a controller to a new character started with Squire armed", () => {
    const { ctx } = context({ noscore: 0 });
    expect(plugin.controller({ ...ctx, controllerArmed: true })).toMatchObject({ controller: expect.any(Function) });
    expect(plugin.controller({ ...ctx, controllerArmed: false })).toBeUndefined();
  });

  it("declares no hooks, because it changes no rule", () => {
    /* register adds the panel and listens to events, and birth only accepts a
     * roll-on creation Squire asked for; neither overrides a rule. */
    expect(plugin.api).toBe(1);
    expect(Object.keys(plugin).sort()).toEqual(["api", "birth", "controller", "register"]);
  });

  it("says how much terrain it can read, so a diminished run is visible", () => {
    const { ctx, logged } = context({ noscore: NOSCORE_BORG });
    plugin.controller(ctx);
    expect(logged.join("\n")).toContain("3 terrain features");
  });

  it("keeps playing without terrain records, and says what it lost", () => {
    const { ctx, logged } = context({ noscore: NOSCORE_BORG, withRecords: false });
    const installed = plugin.controller(ctx);
    expect(installed).toMatchObject({ controller: expect.any(Function), onDeath: "end" });
    expect(logged.join("\n")).toContain("will not take stairs or open doors");
  });

  it("reports settings that are not on their stock value", () => {
    const { ctx, logged } = context({ noscore: NOSCORE_BORG });
    const withFlag = { ...ctx, flags: { "squire.errandCampaign": true } };
    plugin.controller(withFlag);
    expect(logged.join("\n")).toContain("errandCampaign=true");
  });

  it("reports a stock configuration as stock", () => {
    const { ctx, logged } = context({ noscore: NOSCORE_BORG });
    plugin.controller(ctx);
    expect(logged.join("\n")).toContain("stock settings");
  });
});
