/**
 * The plugin definition, checked at the seam the game actually calls.
 *
 * These tests build the mod object by hand. The game passes every domain; Squire reads the terrain records, its stored settings and the world, and answers an input wait, so a fake that refuses what it is not asked for fills in the rest. Checking that an uninstalled mod declines should not need a booted game.
 */

import { afterEach, describe, expect, it } from "vitest";
import type { Api2ControllerContext, Api2InputState, ModApi2 } from "@rpgm-tools/neo-angband-mod-sdk";
import plugin from "./plugin.js";

const NOSCORE_BORG = 0x0020;

const ok = <T,>(value: T) => Promise.resolve({ ok: true as const, value });
const refused = () => Promise.resolve({ ok: false as const, reason: "unavailable" as const, message: "no game" });

/** Three terrain records, in the shape the game composes them. */
function terrain(): unknown[] {
  return [
    { code: "FLOOR", flags: ["LOS | PROJECT | PASSABLE"] },
    { code: "GRANITE", flags: ["WALL | ROCK | GRANITE"] },
    { code: "MORE", flags: ["LOS | PROJECT | PASSABLE | STAIR | DOWNSTAIR"] },
  ];
}

interface Built {
  mod: ModApi2;
  logged: string[];
  registered: string[];
  submitted: unknown[];
}

function build(options: { withRecords?: boolean; flags?: Record<string, boolean>; input?: Api2InputState } = {}): Built {
  const logged: string[] = [];
  const registered: string[] = [];
  const submitted: unknown[] = [];
  const mod = {
    meta: {
      id: "squire",
      flags: options.flags ?? {},
      controllerArmed: false,
      log: (message: string) => logged.push(message),
      settings: () => ok({}),
    },
    view: {
      character: refused,
      options: refused,
      player: refused,
      world: refused,
      input: () => (options.input === undefined ? refused() : ok(options.input)),
    },
    content: { records: (file: string) => (file === "terrain" && options.withRecords !== false ? ok(terrain()) : refused()) },
    events: { on: () => ok({ id: "s" }), off: () => ok(null) },
    store: {
      prefs: { get: () => ok(null), set: () => ok(null) },
      character: { get: () => ok(null), set: () => ok(null) },
    },
    act: {
      submit: (_token: string, intent: unknown) => { submitted.push(intent); return ok(null); },
      answer: () => ok(null),
      controller: { setStatus: () => ok(null), markNondeterministic: () => ok(null), release: () => ok(null) },
    },
    ui: { commands: { register: (code: string) => { registered.push(code); return ok(null); } } },
    presentation: { panels: { openPanel: () => { throw new Error("no document"); } } },
  } as unknown as ModApi2;
  return { mod, logged, registered, submitted };
}

function context(overrides: Partial<Api2ControllerContext> & { noscore?: number } = {}): Api2ControllerContext {
  const { noscore, ...rest } = overrides;
  return { id: "squire", flags: {}, armed: false, engine: { state: { actor: { player: { noscore: noscore ?? 0 } } } }, ...rest } as unknown as Api2ControllerContext;
}

let started: Built | undefined;
afterEach(() => {
  plugin.stop?.();
  started = undefined;
});

async function start(options: Parameters<typeof build>[0] = {}): Promise<Built> {
  started = build(options);
  await plugin.start?.(started.mod);
  return started;
}

describe("the Squire plugin", () => {
  it("declines the keyboard on a character that has never handed it over", () => {
    expect(plugin.armed?.(context({ noscore: 0 }))).toBe(false);
  });

  it("offers to play once the character carries the autoplayer mark", () => {
    expect(plugin.armed?.(context({ noscore: NOSCORE_BORG }))).toBe(true);
  });

  it("offers to play on a new character started with Squire armed", () => {
    expect(plugin.armed?.(context({ armed: true }))).toBe(true);
    expect(plugin.armed?.(context({ armed: false }))).toBe(false);
  });

  it("is an API 2 definition that declares no hooks, because it changes no rule", () => {
    expect(plugin.api).toBe(">=2.0.0 <3.0.0");
    expect(Object.keys(plugin).sort()).toEqual(["api", "armed", "birth", "controller", "prefs", "start", "stop"]);
  });

  it("says how much terrain it can read, so a diminished run is visible", async () => {
    const { logged } = await start();
    expect(logged.join("\n")).toContain("3 terrain features");
  });

  it("keeps running without terrain records, and says what it lost", async () => {
    const { logged } = await start({ withRecords: false });
    expect(logged.join("\n")).toContain("will not take stairs or open doors");
  });

  it("reports settings that are not on their stock value", async () => {
    const { logged } = await start({ flags: { "squire.errandCampaign": true } });
    expect(logged.join("\n")).toContain("errandCampaign=true");
  });

  it("reports a stock configuration as stock", async () => {
    const { logged } = await start();
    expect(logged.join("\n")).toContain("stock settings");
  });

  it("registers its order command", async () => {
    const { registered } = await start();
    expect(registered).toContain("squire:order");
  });

  it("submits nothing at an input wait when the game shows no character", async () => {
    const input = { token: "t", phase: "play", prompt: null, driver: null } as unknown as Api2InputState;
    const { mod, submitted } = await start({ input });
    await plugin.controller?.(mod, input);
    expect(submitted).toEqual([]);
  });

  it("does nothing at an input wait before it has started", async () => {
    const { mod, submitted } = build();
    await plugin.controller?.(mod, { token: "t", phase: "play", prompt: null, driver: null } as unknown as Api2InputState);
    expect(submitted).toEqual([]);
  });
});
