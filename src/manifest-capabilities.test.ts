/**
 * The manifest must declare every perceive domain the mod actually reads.
 *
 * WHY THIS NEEDS A TEST. The frozen AgentView is capability-gated per DOMAIN: a
 * view built for a mod is wrapped so that `view.target()` throws
 * `AgentCapabilityError` unless the manifest declared `state:target.read`. A
 * manifest missing one domain installs cleanly, passes every other test, and
 * only throws on the first turn that reaches the ungated accessor.
 *
 * That is what shipped before this mod's first tag (neostryder/neo-angband#188):
 * `state:target.read` was missing from the manifest, and nothing here caught it,
 * because every test drives the mod through `src/harness.ts`, whose fake view
 * has no capability gate at all - it is built to let a test describe a world in
 * one string, not to reproduce the real host's enforcement.
 *
 * `manifest-rules.test.ts`'s "asks for nothing it does not read" check is a
 * hand-maintained literal list, which is exactly the shape that let the gap
 * through: the list has to already be correct for the test to pass, so it
 * verifies agreement with itself rather than with the source. This file
 * replaces that verification with one derived from the source instead: scan for
 * the accessors the mod calls, map each to the domain the engine gates it on,
 * and require the manifest to declare exactly that set. Reading a new domain
 * now fails here instead of on somebody's first turn, and a domain that stops
 * being read has to be dropped from the manifest rather than lingering as a
 * permission nobody uses.
 *
 * neo-angband-mod-borg hit the identical failure mode in its own 0.6.1 and
 * fixed it the same way; this file is that pattern ported here.
 */

import { describe, expect, it } from "vitest";
import { AGENT_STATE_DOMAINS } from "@rpgm-tools/neo-angband-core";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { world } from "./harness.js";

const srcRoot = dirname(fileURLToPath(import.meta.url));
const repoRoot = dirname(srcRoot);

/**
 * Which perceive domain each AgentView accessor is gated on, from the engine's
 * own binding table (`packages/core/src/agent/perceive.ts`). Two of these are
 * not one-to-one and are the reason this map is written out rather than
 * derived from the accessor name:
 *
 *   - `cell` and `mapBounds` share the `map` domain.
 *   - `equipment` is read under `inventory`, not a domain of its own.
 *   - `spellbooks` is read under `spells`.
 */
const ACCESSOR_DOMAIN: Readonly<Record<string, string>> = {
  turn: "turn",
  player: "player",
  monsters: "monsters",
  cell: "map",
  mapBounds: "map",
  inventory: "inventory",
  equipment: "inventory",
  floorItems: "floor",
  target: "target",
  messages: "messages",
  stores: "stores",
  spellbooks: "spells",
  constants: "constants",
};

/** Capabilities that are not perceive domains. `command:add` is the only one. */
const ACTION_CAPABILITIES = ["command:add"] as const;

interface Manifest {
  readonly capabilities: readonly string[];
}

function manifest(): Manifest {
  return JSON.parse(readFileSync(join(repoRoot, "manifest.json"), "utf8")) as Manifest;
}

/** Every shipped .ts file in the mod, plus the plugin entry point. */
function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) sourceFiles(p, out);
    else if (name.endsWith(".ts") && !name.endsWith(".test.ts") && name !== "harness.ts") {
      out.push(p);
    }
  }
  return out;
}

/**
 * The accessors the mod calls on the live view.
 *
 * `harness.ts` is excluded above, because it BUILDS a fake view rather than
 * reading one: its `player: () => ...` would otherwise read as a call. The
 * scan matches `.<accessor>(` on any expression, not just `view.` or
 * `ctx.view.`, so a view held under another name is still counted; the cost is
 * that an unrelated method with one of these names would be counted too, which
 * over-declares rather than under-declares and is the safer direction here.
 */
function accessorsUsed(): Set<string> {
  const names = Object.keys(ACCESSOR_DOMAIN);
  const re = new RegExp(`\\.(${names.join("|")})\\s*[(?]`, "gu");
  const used = new Set<string>();
  for (const file of [...sourceFiles(srcRoot), join(repoRoot, "plugin.ts")]) {
    const text = readFileSync(file, "utf8");
    for (const m of text.matchAll(re)) {
      const name = m[1];
      if (name !== undefined) used.add(name);
    }
  }
  return used;
}

describe("manifest capabilities", () => {
  it("names a real engine domain for every accessor in the map", () => {
    /* The map above is a copy of the engine's binding table, so it can drift. A
       domain that was renamed or removed fails here rather than turning into a
       capability string the gate will never match. */
    const domains = new Set<string>(Object.values(AGENT_STATE_DOMAINS));
    for (const [accessor, domain] of Object.entries(ACCESSOR_DOMAIN)) {
      expect(domains, `${accessor} -> ${domain}`).toContain(domain);
    }
  });

  it("classifies every accessor the frozen view offers", () => {
    /* A new accessor in a newer engine is a new domain to declare, and the way
       to find out is not to wait for it to throw. Every function on a real view
       has to be in the map above. */
    const view = world({ map: ["@"] }).view as unknown as Record<string, unknown>;
    for (const [key, value] of Object.entries(view)) {
      if (typeof value !== "function") continue;
      expect(ACCESSOR_DOMAIN, `view.${key} is not classified`).toHaveProperty(key);
    }
  });

  it("declares exactly the domains the mod reads, and no others", () => {
    const used = accessorsUsed();
    /* Non-vacuity: the scan has to be finding things. The mod reads the player
       and the monsters on every single think. */
    expect(used).toContain("player");
    expect(used).toContain("monsters");

    const wanted = new Set<string>(ACTION_CAPABILITIES);
    for (const accessor of used) {
      const domain = ACCESSOR_DOMAIN[accessor];
      if (domain !== undefined) wanted.add(`state:${domain}.read`);
    }

    expect([...manifest().capabilities].sort()).toEqual([...wanted].sort());
  });

  it("asks for no wildcard read", () => {
    /* `state:*.read` would cover every domain in one line and would have made
       this mod's own missing-capability defect impossible - and it would also
       grant a domain the mod does not read today and any domain a newer engine
       adds. The consent screen a player reads before handing over a character
       lists these, so the list is worth keeping honest. */
    expect(manifest().capabilities).not.toContain("state:*.read");
  });
});
