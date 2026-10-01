/**
 * What a player can move for a fixed errand.
 *
 * Every boolean here is a manifest rule: a labelled toggle in the mod manager,
 * resolved per mod and handed to the plugin as `ctx.flags`. A rule is the right
 * shape for a yes-or-no, it needs no capability a player has to consent to, and
 * changing one re-composes the page - so an errand can never see a setting move
 * underneath it while it is running.
 *
 * ONLY SETTINGS THE CODE READS ARE DECLARED. A toggle nothing consults reads as
 * a feature, survives every test, and the only way to find it out is to watch an
 * errand ignore it. `src/manifest-rules.test.ts` is what stops this table and
 * manifest.json drifting apart in either direction.
 *
 * The Mods screen owns numeric settings, so their defaults and ranges live in
 * manifest.json and the resolved values enter here through ctx.settings.
 */

import type { ModSettingsRead } from "@rpgm-tools/neo-angband-core";

/** Squire's settings, at the point every decision reads them. */
export interface SquireCfg {
  /** Offer the fighting errand when a creature is in sight at handover. */
  errandAutofight: boolean;
  /** Offer the exploring errand when nothing is in sight at handover. */
  errandAutoexplore: boolean;
  /** Carry the character instead of running one short errand. */
  errandCampaign: boolean;
  /** Ask a model what to do when one is reachable, instead of running an errand. */
  useModel: boolean;
  /** End a short errand when hit points fall past `retreatFraction`. */
  stopOnLowHealth: boolean;
  /** End a short errand when a creature not already in sight comes into view. */
  stopOnNewCreature: boolean;
  /** Let the fighting errand pick a sleeping creature. */
  wakeSleepers: boolean;
  /** Pick up what is underfoot during the long errand. */
  collect: boolean;
  /** Take a known down staircase during the long errand. */
  descend: boolean;
  /**
   * The share of maximum hit points at or below which an errand breaks off.
   * Half, which is where a character stops being able to absorb one bad turn.
   */
  retreatFraction: number;
  /**
   * How many decisions a SHORT errand may make before it stops on its own.
   *
   * A bound rather than a safety net. An errand that has been walking for two
   * hundred decisions is no longer the short errand that was asked for, whatever
   * it thinks it is doing, and stopping is always a legal answer here. The long
   * errand is deliberately not bounded this way: it was asked to keep going.
   */
  errandSteps: number;
  /**
   * How many decisions in a row an errand may spend without the character
   * moving before it gives up and calls itself blocked. Three, so a single
   * failed step (a door that needed a second try, a bump into rubble) does not
   * end an errand while a genuine wedge still does.
   */
  idleSteps: number;
}

/** The stock settings: every rule on its manifest default. */
export function defaultCfg(): SquireCfg {
  return {
    errandAutofight: true,
    errandAutoexplore: true,
    errandCampaign: false,
    useModel: true,
    stopOnLowHealth: true,
    stopOnNewCreature: true,
    wakeSleepers: false,
    collect: true,
    descend: true,
    retreatFraction: DEFAULT_RETREAT_PERCENT / 100,
    errandSteps: DEFAULT_ERRAND_STEPS,
    idleSteps: 3,
  };
}

/** The boolean settings, and the manifest rule flag each one is. */
export const RULE_CFG: Readonly<Record<string, keyof SquireCfg>> = {
  "squire.errandAutofight": "errandAutofight",
  "squire.errandAutoexplore": "errandAutoexplore",
  "squire.errandCampaign": "errandCampaign",
  "squire.useModel": "useModel",
  "squire.stopOnLowHealth": "stopOnLowHealth",
  "squire.stopOnNewCreature": "stopOnNewCreature",
  "squire.wakeSleepers": "wakeSleepers",
  "squire.collect": "collect",
  "squire.descend": "descend",
};

export const RETREAT_PERCENT_SETTING = "squire.retreatPercent";
export const ERRAND_STEPS_SETTING = "squire.errandSteps";
export const DEFAULT_RETREAT_PERCENT = 50;
export const MIN_RETREAT_PERCENT = 10;
export const MAX_RETREAT_PERCENT = 90;
export const DEFAULT_ERRAND_STEPS = 200;
export const MIN_ERRAND_STEPS = 50;
export const MAX_ERRAND_STEPS = 500;

/**
 * Fold the host's resolved rule flags over the stock settings.
 *
 * A flag the host did not resolve is left on its default rather than read as
 * false. The host resolves every rule a mod's own manifest declares, so a
 * missing one means the manifest and RULE_CFG have drifted apart - and several
 * of these default to ON, so reading absence as false would quietly switch off
 * behaviour the mod ships enabled.
 */
export function cfgFromFlags(flags: Readonly<Record<string, boolean>>, settings?: Pick<ModSettingsRead, "get">): SquireCfg {
  const cfg = defaultCfg();
  for (const [flag, field] of Object.entries(RULE_CFG)) {
    const value = flags[flag];
    if (typeof value === "boolean") (cfg[field] as boolean) = value;
  }
  const retreatPercent = settings?.get(RETREAT_PERCENT_SETTING);
  const errandSteps = settings?.get(ERRAND_STEPS_SETTING);
  if (typeof retreatPercent === "number" && Number.isFinite(retreatPercent)) {
    cfg.retreatFraction = Math.min(MAX_RETREAT_PERCENT, Math.max(MIN_RETREAT_PERCENT, retreatPercent)) / 100;
  }
  if (typeof errandSteps === "number" && Number.isFinite(errandSteps)) {
    cfg.errandSteps = Math.round(Math.min(MAX_ERRAND_STEPS, Math.max(MIN_ERRAND_STEPS, errandSteps)));
  }
  return cfg;
}

/** The settings that are not on their stock value, named, for the log line. */
export function changedFrom(cfg: SquireCfg): string[] {
  const stock = defaultCfg();
  return [
    ...Object.values(RULE_CFG)
    .filter((field) => stock[field] !== cfg[field])
    .map((field) => `${field}=${String(cfg[field])}`),
    ...(stock.retreatFraction === cfg.retreatFraction ? [] : [`retreatPercent=${String(Math.round(cfg.retreatFraction * 100))}`]),
    ...(stock.errandSteps === cfg.errandSteps ? [] : [`errandSteps=${String(cfg.errandSteps)}`]),
  ].sort();
}
