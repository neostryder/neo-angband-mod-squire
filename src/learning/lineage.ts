import { PARAMETERS } from "../persona/catalog.js";
import type { ListId, SliderId } from "../persona/catalog.js";
import { randomPersona, type Persona } from "../persona/persona.js";
import { familyOf } from "./signature.js";
import type { Lesson } from "./lessons.js";
import { inheritCreeds } from "../orders/creed.js";
import type { Instruction } from "../orders/types.js";
import { inheritAims, type InheritedAim } from "../strategy/heirs.js";
import { feelingKind, feelingsFor, remembered, type Feeling, type Killer } from "./grudges.js";
import { inheritFlourishes, type Epitaph, type Milestone } from "./flourishes.js";
import { emptyFamilyFlourishes, inheritWays, mayReplaceMotto, mottoForPersona, type FamilyFlourishes, type Flourishes } from "./family-ways.js";

export interface Ancestor {
  readonly name: string;
  readonly race: string;
  readonly cls: string;
  readonly generation: number;
  readonly died: { readonly depth: number; readonly cause: string; readonly turn: number } | null;
  readonly deepest?: number;
  readonly turns?: number;
}

export interface Lineage {
  readonly name: string;
  readonly generation: number;
  readonly ancestors: readonly Ancestor[];
  readonly lore: readonly Lesson[];
  readonly grudges: readonly { readonly race: string; readonly family: string; readonly generation: number }[];
  /** Standing instructions the family holds as creeds. Orders are never kept here. */
  readonly creeds?: readonly Instruction[];
  /** Aims the last character held that can pass on: at death they are the parent's, then the heir's inherited set. */
  readonly aims?: readonly InheritedAim[];
  /** The family's record of the creatures that killed its characters, kept across every generation. */
  readonly killers?: readonly Killer[];
  /** The current heir's hatred or fear toward those killers, set when it is born. */
  readonly feelings?: readonly Feeling[];
  readonly epitaphs?: readonly Epitaph[];
  readonly milestones?: readonly Milestone[];
  readonly inheritedEpitaphs?: readonly Epitaph[];
  readonly inheritedMilestones?: readonly Milestone[];
  readonly mentionedMilestones?: readonly string[];
  readonly deepest?: number;
  readonly turns?: number;
  readonly flourishRecord?: FamilyFlourishes;
  readonly flourishes?: Flourishes;
  /** Current-character facts are optional until a run has supplied them. */
  readonly race?: string;
  readonly cls?: string;
  readonly died?: Ancestor["died"];
}

function unit(rng: () => number): number {
  const value = rng();
  return Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 0;
}

function fraction(value: number): number { return Math.max(0, Math.min(1, value / 100)); }

function killerRace(cause: string): string {
  return cause.replace(/^killed by\s+/i, "").replace(/^(?:an?|the)\s+/i, "").trim();
}

/**
 * The levers an heir inherits, pulled toward its parent by the parent's Family
 * resemblance. They are what a family stands for: its values, loyalties and
 * enmities, its relations with a patron, and its household habits. Every
 * other trait, list and quirk is rolled fresh for each heir.
 */
export const FAMILY_LEVERS = [
  "mercy", "glory", "goodevil", "hated", "greed", "devotion", "superstitions", "honour",
  "gratitude", "distrusted", "home", "hoarding", "lawchaos", "feared", "resentment", "ambition",
] as const satisfies readonly (SliderId | ListId)[];

const FAMILY: ReadonlySet<string> = new Set(FAMILY_LEVERS);

export type HeirTreatment = "inherited" | "rolled" | "kept";

/**
 * How an heir gets one persona lever. Lineage and meta settings are the
 * player's configuration and come from the persona the heir starts from, as
 * does the backstory cap. Patron sliders pass from the parent, listed or not.
 * Favoured weapons are rolled here; the Favoured weapon kinds toggle carries
 * the family's weapon preference separately.
 */
export function heirTreatment(parameter: (typeof PARAMETERS)[number]): HeirTreatment {
  if (FAMILY.has(parameter.id)) return "inherited";
  if (parameter.kind === "toggle" || parameter.kind === "number" || parameter.group === "lineage" || parameter.group === "meta") return "kept";
  if (parameter.group === "patron" && parameter.kind === "slider") return "inherited";
  return "rolled";
}

/** The first share of the parent's entries, in its order, joined to the heir's own. */
function inheritedList(parent: readonly string[], own: readonly string[], resemblance: number): string[] {
  const out = [...own];
  for (const item of parent.slice(0, Math.round(parent.length * resemblance))) if (!out.includes(item)) out.push(item);
  return out.slice(0, 12);
}

/**
 * Carries character lore only; calibration and coaching remain outside lineage.
 *
 * The heir's name, backstory, lineage toggles and Squire's own dials come from
 * `heirPersona`. Its traits, lists and quirks are rolled with `rng`, and the
 * family levers are then pulled toward the parent.
 */
export function inherit(parentLineage: Lineage, parentPersona: Persona, heirPersona: Persona, rng: () => number): { lineage: Lineage; persona: Persona } {
  const resemblance = fraction(parentPersona.sliders.resemblance);
  const rolled = randomPersona(rng, heirPersona.name);
  const sliders = { ...heirPersona.sliders };
  const lists = Object.fromEntries(Object.entries(heirPersona.lists).map(([key, values]) => [key, [...values]])) as Persona["lists"];
  for (const parameter of PARAMETERS) {
    const treatment = heirTreatment(parameter);
    if (treatment === "kept") continue;
    if (parameter.kind === "slider") {
      const id = parameter.id;
      const own = rolled.sliders[id];
      sliders[id] = treatment === "rolled" ? own : Math.round(own + (parentPersona.sliders[id] - own) * resemblance);
    } else if (parameter.kind === "list") {
      const id = parameter.id;
      lists[id] = treatment === "rolled" ? [...rolled.lists[id]] : inheritedList(parentPersona.lists[id], rolled.lists[id], resemblance);
    }
  }
  const quirks = rolled.quirks;

  const grudges = [...parentLineage.grudges];
  const death = parentLineage.died ?? null;
  const killers = parentLineage.killers ?? [];
  const heirGeneration = parentLineage.generation + 1;
  /* An heir's traits are rolled, so a style preset's rule no longer describes it. */
  const shaped: Persona = { ...heirPersona, sliders, lists, quirks, preset: null };
  const bloodGrudges = parentPersona.sliders.inheritance > 0 && parentPersona.toggles.grudges && heirPersona.toggles.grudges;
  if (bloodGrudges && death !== null) {
    const race = killerRace(death.cause);
    const family = familyOf(race);
    if (family !== "other") {
      grudges.push({ race, family, generation: parentLineage.generation });
      const known = killers.find((k) => k.name.toLowerCase() === race.toLowerCase());
      const count = known === undefined ? 1 : Math.max(1, remembered(known, heirGeneration));
      const target = feelingKind(shaped, count) === "hatred" ? lists.hated : lists.feared;
      if (!target.includes(family) && target.length < 12) target.push(family);
    }
  }
  const feelings = bloodGrudges ? feelingsFor(killers, heirGeneration, shaped, parentPersona.sliders.inheritance) : [];

  const count = Math.min(12, Math.floor(12 * fraction(parentPersona.sliders.inheritance)));
  const lore = parentLineage.lore.map((lesson) => ({ lesson, tie: unit(rng) }))
    .sort((a, b) => b.lesson.weight - a.lesson.weight || a.tie - b.tie)
    .slice(0, count).map(({ lesson }) => ({ ...lesson, weight: lesson.weight / 2 }));
  const parent: Ancestor = {
    name: parentLineage.name, race: parentLineage.race ?? "unknown", cls: parentLineage.cls ?? "unknown",
    generation: parentLineage.generation, died: death,
    ...(parentLineage.deepest === undefined ? {} : { deepest: parentLineage.deepest }),
    ...(parentLineage.turns === undefined ? {} : { turns: parentLineage.turns }),
  };
  const family = parentLineage.flourishRecord ?? emptyFamilyFlourishes();
  const replaced = shaped.toggles.familyMotto && mayReplaceMotto(parentPersona, shaped, family.motto, rng);
  const nextMotto = replaced && family.motto !== null ? { text: mottoForPersona(shaped, rng), generation: heirGeneration } : family.motto;
  return {
    lineage: {
      name: heirPersona.name, generation: heirGeneration,
      ancestors: [...parentLineage.ancestors, parent], lore, grudges,
      creeds: inheritCreeds(parentLineage.creeds ?? [], parentPersona),
      aims: inheritAims(parentLineage.aims ?? [], parentPersona, shaped),
      killers, feelings,
      ...inheritFlourishes(parentLineage, parentPersona, shaped),
      flourishRecord: { ...family, motto: nextMotto },
      flourishes: inheritWays(family, parentPersona, shaped, rng),
    },
    persona: shaped,
  };
}
