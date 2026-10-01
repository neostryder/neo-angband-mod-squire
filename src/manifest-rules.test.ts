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
import { DEFAULT_ERRAND_STEPS, DEFAULT_RETREAT_PERCENT, ERRAND_STEPS_SETTING, MAX_ERRAND_STEPS, MAX_RETREAT_PERCENT, MIN_ERRAND_STEPS, MIN_RETREAT_PERCENT, RETREAT_PERCENT_SETTING, RULE_CFG, cfgFromFlags, changedFrom, defaultCfg } from "./settings.js";
import { autofight } from "./missions/autofight.js";
import { isStop, type Decision } from "./mission.js";
import { run, world } from "./harness.js";

function stopOf(decision: Decision): { reason: string; detail: string } {
  if (!isStop(decision)) throw new Error("expected the errand to stop");
  return decision.stop;
}

function commandOf(decision: Decision): { code: string; dir?: number } {
  if (isStop(decision)) throw new Error(`expected a command, got ${decision.stop.reason}`);
  return decision.command;
}

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
  rules: ManifestRule[];
  settings: { id: string; title: string; description: string; min: number; max: number; step: number; default: number }[];
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

  it("declares the errand numbers with their code defaults and bounds", () => {
    expect(manifest.settings).toEqual([
      expect.objectContaining({ id: RETREAT_PERCENT_SETTING, min: MIN_RETREAT_PERCENT, max: MAX_RETREAT_PERCENT, default: DEFAULT_RETREAT_PERCENT }),
      expect.objectContaining({ id: ERRAND_STEPS_SETTING, min: MIN_ERRAND_STEPS, max: MAX_ERRAND_STEPS, default: DEFAULT_ERRAND_STEPS }),
    ]);
    expect(defaultCfg().retreatFraction).toBe(DEFAULT_RETREAT_PERCENT / 100);
    expect(defaultCfg().errandSteps).toBe(DEFAULT_ERRAND_STEPS);
  });

  it("gives every rule a title and a description a player can act on", () => {
    for (const rule of manifest.rules) {
      expect(rule.title.length).toBeGreaterThan(0);
      expect(rule.description.length).toBeGreaterThan(40);
    }
  });

  it("carries the same version as package.json", () => {
    expect(manifest.version).toBe(pkg.version);
  });
});

describe("cfgFromFlags", () => {
  const settings = (values: Readonly<Record<string, number>>) => ({ get: (id: string) => values[id] });

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

  it("reads the retreat line and short errand decision limit", () => {
    const cfg = cfgFromFlags({}, settings({ [RETREAT_PERCENT_SETTING]: 30, [ERRAND_STEPS_SETTING]: 50 }));
    expect(cfg.retreatFraction).toBe(0.3);
    expect(cfg.errandSteps).toBe(50);

    const w = world({ map: ["#########", "#.......#", "#.@.....#", "#.......#", "#########"], player: { hp: 40, maxHp: 40 }, monsters: [{ grid: { x: 3, y: 2 }, hp: 1000, maxHp: 1000 }] });
    const fight = run(w, autofight(), cfg);
    fight.begin();
    w.setPlayer({ hp: 12 });
    expect(stopOf(fight.step()).reason).toBe("hurt");

    const longWorld = world({ map: ["#########", "#.......#", "#.@.....#", "#.......#", "#########"], monsters: [{ grid: { x: 3, y: 2 }, hp: 1000, maxHp: 1000 }] });
    const longFight = run(longWorld, autofight(), cfg);
    longFight.begin();
    for (let i = 0; i < 50; i += 1) expect(commandOf(longFight.step()).code).toBe("melee");
    expect(stopOf(longFight.step()).reason).toBe("budget");
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

  it("records changed numeric errand settings", () => {
    expect(changedFrom({ ...defaultCfg(), retreatFraction: 0.35, errandSteps: 250 })).toEqual([
      "errandSteps=250",
      "retreatPercent=35",
    ]);
  });
});
