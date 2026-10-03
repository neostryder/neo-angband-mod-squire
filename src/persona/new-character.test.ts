import { describe, expect, it } from "vitest";
import { readConfig, writeConfig, type SquireConfig } from "../config.js";
import { suppliedWorld } from "../harness.js";
import { memoryStore } from "../memory/kv.js";
import { createRuntime, type SquireHost } from "../runtime.js";
import { defaultCfg } from "../settings.js";
import { archetype, neutralPersona } from "./persona.js";

function flush(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

/** A host whose model never answers, with settings and a character store kept in memory. */
function host(config: SquireConfig, character?: unknown): { host: SquireHost; config: () => SquireConfig } {
  let saved: unknown = writeConfig(config);
  let stored = character;
  return {
    config: () => readConfig(saved),
    host: {
      log: () => {},
      prefs: { get: () => saved, set: (next) => { saved = next; } },
      characterStore: { get: () => stored, set: (next) => { stored = next; } },
      controller: { setStatus: () => {}, markNondeterministic: () => {} } as unknown as NonNullable<SquireHost["controller"]>,
      net: {
        transport: "page",
        request: async () => ({ ok: false, code: "unreachable", problem: "The test has no server." }),
        secrets: {
          storage: "page", has: async () => ({ present: true }),
          fromEnv: async () => ({ ok: false, problem: "The test has no environment." }),
          set: async () => ({ ok: true, storage: "page" }), delete: async () => ({ ok: true }),
        },
      },
    },
  };
}

async function handOver(h: SquireHost): Promise<ReturnType<typeof createRuntime>> {
  const rt = createRuntime(h, { store: memoryStore() });
  const w = suppliedWorld({ map: ["########", "#.@..>.#", "########"], player: { depth: 1, level: 1, maxLevel: 1 } });
  const controller = rt.controllerFor(defaultCfg(), w.terrain, () => () => null);
  await flush();
  controller(w.view, w.act);
  return rt;
}

describe("a character the player makes", () => {
  it("starts from the neutral base on a new install", () => {
    const config = readConfig(undefined);
    expect(config.personas).toEqual([neutralPersona("Squire")]);
    expect(config.activePersona).toBe(0);
  });

  it("is met for the first time with no Squire data, and plays as the neutral persona at its first handover", async () => {
    const h = host(readConfig(undefined));
    const rt = await handOver(h.host);
    expect(rt.firstMeeting()).toBe(true);
    expect(rt.character().persona).toEqual(neutralPersona("Squire"));
    expect(h.config().pendingHeir).toBeNull();
  });

  it("plays as the style the player chose, play rule included", async () => {
    const h = host({ ...readConfig(undefined), personas: [archetype("diver")], activePersona: 0 });
    const rt = await handOver(h.host);
    expect(rt.character().persona?.preset).toBe("diver");
  });

  it("is not met for the first time once Squire has saved data for it", () => {
    const first = host(readConfig(undefined));
    const rt = createRuntime(first.host, { store: memoryStore() });
    rt.saveCharacter({ ...rt.character(), kills: { jackal: 1 } });
    const saved = first.host.characterStore?.get();
    expect(createRuntime(host(readConfig(undefined), saved).host, { store: memoryStore() }).firstMeeting()).toBe(false);
  });
});

describe("an heir Squire starts", () => {
  it("rolls its traits and takes the family levers from its parent", async () => {
    const parent = neutralPersona("Mira");
    parent.sliders.resemblance = 100;
    parent.sliders.goodevil = 5;
    parent.sliders.boldness = 5;
    const line = { name: "Mira", generation: 1, ancestors: [], lore: [], grudges: [] };
    const h = host({ ...readConfig(undefined), personas: [archetype("diver")], activePersona: 0, rollOn: "random", lineages: { Mira: line }, pendingHeir: { lineage: "Mira", parent, name: "Mira the Second" } });
    const rt = await handOver(h.host);
    const heir = rt.character().persona!;
    expect(heir.name).toBe("Mira the Second");
    expect(heir.sliders.goodevil).toBe(5);
    expect(heir.sliders.boldness).toBeGreaterThanOrEqual(20);
    expect(Object.values(heir.quirks).some((q) => q.on)).toBe(true);
    expect(heir.preset).toBeNull();
    expect(h.config().pendingHeir).toBeNull();
  });
});
