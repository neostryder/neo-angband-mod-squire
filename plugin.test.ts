/**
 * The plugin ABI, checked at the seam the host actually calls.
 *
 * The context built here is a hand-made stand-in for the host's, and the casts
 * say so: `typeof Core` is the whole engine namespace and `CoreRegistries` is
 * every bound registry, while this plugin reads one constant table out of the
 * first and one registry out of the second. Building the real thing would mean
 * booting a game to ask whether an uninstalled mod declines politely.
 */

import { describe, expect, it } from "vitest";
import type * as Core from "@rpgm-tools/neo-angband-core";
import plugin from "./plugin.js";

const TF = {
  PASSABLE: 4,
  DOWNSTAIR: 28,
  UPSTAIR: 27,
  DOOR_CLOSED: 20,
  SHOP: 21,
  FIERY: 31,
};

const NOSCORE_BORG = 0x0020;

function features(): unknown {
  const make = (fidx: number, code: string, flags: readonly number[]): unknown => {
    const set = new Set(flags);
    return { fidx, code, flags: { has: (flag: number) => set.has(flag) } };
  };
  return {
    allFeatures: () => [
      make(1, "FLOOR", [TF.PASSABLE]),
      make(2, "GRANITE", []),
      make(4, "MORE", [TF.PASSABLE, TF.DOWNSTAIR]),
    ],
  };
}

interface Built {
  ctx: Parameters<typeof plugin.controller>[0];
  logged: string[];
}

function context(options: { noscore?: number; withRegistries?: boolean } = {}): Built {
  const logged: string[] = [];
  const registries = options.withRegistries === false ? {} : { features: features() };
  return {
    logged,
    ctx: {
      flags: {},
      core: { TF } as unknown as typeof Core,
      log: (message: string) => logged.push(message),
      registries: registries as unknown as Core.CoreRegistries,
      state: { actor: { player: { noscore: options.noscore ?? 0 } } },
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
    expect(typeof plugin.controller(ctx)).toBe("function");
  });

  it("declares api 1 and nothing else, because it changes no rule", () => {
    expect(plugin.api).toBe(1);
    expect(Object.keys(plugin).sort()).toEqual(["api", "controller"]);
  });

  it("says how much terrain it can read, so a diminished run is visible", () => {
    const { ctx, logged } = context({ noscore: NOSCORE_BORG });
    plugin.controller(ctx);
    expect(logged.join("\n")).toContain("3 terrain features");
  });

  it("keeps playing without a terrain registry, and says what it lost", () => {
    const { ctx, logged } = context({ noscore: NOSCORE_BORG, withRegistries: false });
    expect(typeof plugin.controller(ctx)).toBe("function");
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
