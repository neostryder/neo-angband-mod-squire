/**
 * The guard against manifest.json and the code drifting apart.
 *
 * Two failures this stops, and both are invisible in play. A rule the manifest
 * declares that nothing reads shows up in the mod manager as a labelled toggle,
 * survives every other test, and does nothing at all - the only way to discover
 * it is to watch an errand ignore it. A setting the code reads that no rule
 * declares can never be moved by the player, so it is a constant wearing a
 * setting's name.
 *
 * The defaults are checked in the same pass, because a rule whose manifest
 * default and code default disagree switches behaviour on or off the moment a
 * host resolves the flags, which is to say immediately and everywhere.
 */

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { RULE_CFG, cfgFromFlags, changedFrom, defaultCfg } from "./settings.js";

interface ManifestRule {
  flag: string;
  title: string;
  description: string;
  default: boolean;
}

interface Manifest {
  id: string;
  version: string;
  engine: string;
  capabilities: string[];
  rules: ManifestRule[];
}

const manifest = JSON.parse(
  readFileSync(new URL("../manifest.json", import.meta.url), "utf8"),
) as Manifest;

const pkg = JSON.parse(
  readFileSync(new URL("../package.json", import.meta.url), "utf8"),
) as { version: string };

describe("manifest.json", () => {
  it("declares exactly the rules the code reads", () => {
    const declared = manifest.rules.map((rule) => rule.flag).sort();
    expect(declared).toEqual(Object.keys(RULE_CFG).sort());
  });

  it("namespaces every rule under this mod's id", () => {
    for (const rule of manifest.rules) expect(rule.flag.startsWith("squire.")).toBe(true);
  });

  it("agrees with the code about every default", () => {
    const stock = defaultCfg();
    for (const rule of manifest.rules) {
      const field = RULE_CFG[rule.flag];
      expect(field, `${rule.flag} is not in RULE_CFG`).toBeDefined();
      expect(stock[field as keyof typeof stock], `${rule.flag} default`).toBe(rule.default);
    }
  });

  it("gives every rule a title and a description a player can act on", () => {
    for (const rule of manifest.rules) {
      expect(rule.title.length).toBeGreaterThan(0);
      expect(rule.description.length).toBeGreaterThan(40);
    }
  });

  it("asks for the one capability a controller cannot work without", () => {
    expect(manifest.capabilities).toContain("command:add");
  });

  it("asks for nothing it does not read", () => {
    /* Least privilege, checked rather than intended. Squire reads the character,
     * the creatures and the map, and acts. It never opens the message stream,
     * the pack, the stores or the spellbooks, so it must never ask to. */
    expect(manifest.capabilities.sort()).toEqual(
      [
        "command:add",
        "state:map.read",
        "state:monsters.read",
        "state:player.read",
      ].sort(),
    );
  });

  it("carries the same version as package.json", () => {
    expect(manifest.version).toBe(pkg.version);
  });
});

describe("cfgFromFlags", () => {
  it("takes what the host resolved", () => {
    const cfg = cfgFromFlags({ "squire.errandCampaign": true, "squire.collect": false });
    expect(cfg.errandCampaign).toBe(true);
    expect(cfg.collect).toBe(false);
  });

  it("leaves an unresolved flag on its default rather than reading it as false", () => {
    const cfg = cfgFromFlags({});
    expect(cfg).toEqual(defaultCfg());
    expect(cfg.stopOnLowHealth).toBe(true);
  });

  it("ignores a flag that is not one of this mod's", () => {
    const cfg = cfgFromFlags({ "someothermod.thing": true });
    expect(cfg).toEqual(defaultCfg());
  });
});

describe("changedFrom", () => {
  it("says nothing when everything is on its stock value", () => {
    expect(changedFrom(defaultCfg())).toEqual([]);
  });

  it("names each setting that moved, so an unattended run has a record", () => {
    expect(changedFrom({ ...defaultCfg(), errandCampaign: true, collect: false })).toEqual([
      "collect=false",
      "errandCampaign=true",
    ]);
  });
});
