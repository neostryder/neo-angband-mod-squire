import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { InputSnapshot } from "@rpgm-tools/neo-angband-core";
import { world } from "./harness.js";
import { autoplayedBefore, birthOptions, contentTerrain, viewInput, viewWorld, type HostReads } from "./host-adapter.js";
import { readTerrain } from "./terrain.js";
import { GAME_TERRAIN } from "./terrain-records.fixture.js";

function snapshotWith(inventory: readonly unknown[], equipment: readonly unknown[]): InputSnapshot {
  return { token: { epoch: 1, revision: 7 }, core: { inventory, equipment } } as unknown as InputSnapshot;
}

describe("viewWorld", () => {
  const w = world({ map: ["###", "#@#", "###"] });
  const core = { createAgentView: () => w.view } as unknown as NonNullable<HostReads["core"]>;
  const state = {} as NonNullable<HostReads["state"]>;

  it("needs both the view builder and the game state", () => {
    expect(viewWorld({})).toBeNull();
    expect(viewWorld({ core })).toBeNull();
    expect(viewWorld({ state })).toBeNull();
  });

  it("takes the pack and the worn gear from the input snapshot", () => {
    const pack = [{ name: "a Flask of Oil" }];
    const worn = [{ name: "a Dagger" }];
    const view = viewWorld({ core, state, snapshot: () => snapshotWith(pack, worn) });
    expect(view?.inventory()).toEqual(pack);
    expect(view?.equipment()).toEqual(worn);
    expect(view?.turn()).toBe(w.view.turn());
  });

  it("gives an empty pack when there is no snapshot", () => {
    const view = viewWorld({ core, state, snapshot: () => null });
    expect(view?.inventory()).toEqual([]);
    expect(view?.equipment()).toEqual([]);
  });
});

describe("viewInput", () => {
  it("passes the input wait through, or null without one", () => {
    const snap = snapshotWith([], []);
    expect(viewInput({ snapshot: () => snap })?.token).toEqual({ epoch: 1, revision: 7 });
    expect(viewInput({ snapshot: () => null })).toBeNull();
    expect(viewInput({})).toBeNull();
  });
});

describe("contentTerrain", () => {
  const composedRecords = { terrain: GAME_TERRAIN } as unknown as NonNullable<HostReads["composedRecords"]>;

  it("classifies the game's terrain records by flag", () => {
    const terrain = contentTerrain({ composedRecords });
    expect(terrain.size).toBe(GAME_TERRAIN.length);
    expect(terrain.isDownStair(6)).toBe(true);
    expect(terrain.isUpStair(5)).toBe(true);
    expect(terrain.isClosedDoor(2)).toBe(true);
    expect(terrain.shopName(14)).toBe("Home");
    expect(terrain.isHarmful(23)).toBe(true);
    expect(terrain.isDiggable?.(16)).toBe(true);
    expect(terrain.isDiggable?.(22)).toBe(false);
  });

  /* Earlier versions read the bound feature registry and the engine's flag numbers. Reading the records instead must classify every feature the same way. */
  it("classifies every feature the way the bound feature registry did", () => {
    const TF = { PASSABLE: 4, DOWNSTAIR: 28, UPSTAIR: 27, DOOR_CLOSED: 20, CLOSABLE: 22, SHOP: 21, FIERY: 31, ROCK: 2, PERMANENT: 10 };
    const nameOf = new Map(Object.entries(TF).map(([name, n]) => [n, name]));
    const bound = readTerrain(
      GAME_TERRAIN.map((record, fidx) => ({ fidx, code: record.code, flags: { has: (n: number) => (record.flags ?? []).some((line) => line.split("|").map((f) => f.trim()).includes(nameOf.get(n) ?? "")) } })),
      TF,
    );
    const terrain = contentTerrain({ composedRecords });
    expect(terrain.size).toBe(bound.size);
    for (let feat = 0; feat < GAME_TERRAIN.length; feat++) {
      const answers = (t: typeof bound): unknown[] => [t.isDownStair(feat), t.isUpStair(feat), t.isClosedDoor(feat), t.isOpenDoor?.(feat), t.isShopEntrance(feat), t.shopName(feat), t.isHarmful(feat), t.isDiggable?.(feat)];
      expect(answers(terrain), GAME_TERRAIN[feat]?.code).toEqual(answers(bound));
    }
  });

  it("classifies nothing without the terrain records", () => {
    expect(contentTerrain({}).size).toBe(0);
    expect(contentTerrain({ composedRecords: {} as NonNullable<HostReads["composedRecords"]> }).size).toBe(0);
  });
});

describe("the other reads", () => {
  it("reads the autoplayer mark from the save", () => {
    expect(autoplayedBefore({ state: { actor: { player: { noscore: 0x0020 } } } })).toBe(true);
    expect(autoplayedBefore({ state: { actor: { player: { noscore: 0x0001 } } } })).toBe(false);
    expect(autoplayedBefore({})).toBe(false);
  });

  it("keeps only the birth options", () => {
    const entries = [{ page: "birth", id: "birth_ironman" }, { page: "interface", id: "use_sound" }];
    const options = { get: () => ({ entries }) } as unknown as NonNullable<HostReads["options"]>;
    expect(birthOptions({ options }).map((e) => (e as unknown as { id: string }).id)).toEqual(["birth_ironman"]);
    expect(birthOptions({})).toEqual([]);
  });
});

/*
 * Mod API 2 gives Squire no core namespace, no game state and no registries,
 * so a read of any of them outside the adapter is a read the port would miss.
 */
describe("host reads stay in the adapter", () => {
  const root = fileURLToPath(new URL("..", import.meta.url));
  const READS: readonly RegExp[] = [
    /\b(?:ctx|host)\s*\??\.\s*(?:core|state|registries|snapshot|options)\b/,
    /\??\.\s*(?:core|registries)\b/,
    /\b(?:ctx|host)\s*(?:\?\.)?\s*\[\s*["'`](?:core|state|registries|snapshot|options)["'`]\s*\]/,
    /\{[^}]*\b(?:core|state|registries|snapshot|options)\b[^}]*\}\s*=\s*(?:ctx|host)\b/,
  ];

  function sources(dir: string): string[] {
    return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) return sources(path);
      return entry.name.endsWith(".ts") && !entry.name.endsWith(".test.ts") && entry.name !== "host-adapter.ts" ? [path] : [];
    });
  }

  function code(text: string): string {
    return text.replace(/\/\*[\s\S]*?\*\//g, (block) => block.replace(/[^\n]/g, " ")).replace(/(^|[^:"'`])\/\/.*$/gm, "$1");
  }

  it("finds no core, state, registries, snapshot or options read in any other source file", () => {
    const files = [join(root, "plugin.ts"), ...sources(join(root, "src"))];
    const found: string[] = [];
    for (const file of files) {
      code(readFileSync(file, "utf8")).split("\n").forEach((line, index) => {
        if (READS.some((pattern) => pattern.test(line))) found.push(`${relative(root, file)}:${String(index + 1)}: ${line.trim()}`);
      });
    }
    expect(found).toEqual([]);
  });

  it("catches a read when one is written", () => {
    const sample = code("const a = ctx.state;\nconst b = host.core?.TF;\nconst c = ctx[\"registries\"];\nconst { core } = ctx;\nconst { snapshot } = host;\nconst d = host[\"options\"];\nconst e = ctx.options?.get();\n// ctx.state in a comment\n");
    const hits = sample.split("\n").filter((line) => READS.some((pattern) => pattern.test(line)));
    expect(hits).toHaveLength(7);
  });
});
