import { PARAMETERS } from "../persona/catalog.js";
import type { Persona } from "../persona/persona.js";
import { familyOf } from "./signature.js";
import type { Lesson } from "./lessons.js";
import { inheritCreeds } from "../orders/creed.js";
import type { Instruction } from "../orders/types.js";

export interface Ancestor {
  readonly name: string;
  readonly race: string;
  readonly cls: string;
  readonly generation: number;
  readonly died: { readonly depth: number; readonly cause: string; readonly turn: number } | null;
}

export interface Lineage {
  readonly name: string;
  readonly generation: number;
  readonly ancestors: readonly Ancestor[];
  readonly lore: readonly Lesson[];
  readonly grudges: readonly { readonly race: string; readonly family: string; readonly generation: number }[];
  /** Standing instructions the family holds as creeds. Orders are never kept here. */
  readonly creeds?: readonly Instruction[];
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

/** Carries character lore only; calibration and coaching remain outside lineage. */
export function inherit(parentLineage: Lineage, parentPersona: Persona, heirPersona: Persona, rng: () => number): { lineage: Lineage; persona: Persona } {
  const resemblance = fraction(parentPersona.sliders.resemblance);
  const sliders = { ...heirPersona.sliders };
  for (const parameter of PARAMETERS) {
    if (parameter.kind === "slider" && parameter.group !== "meta" && parameter.group !== "lineage") {
      const id = parameter.id;
      sliders[id] = Math.round(sliders[id] + (parentPersona.sliders[id] - sliders[id]) * resemblance);
    }
  }

  const lists = Object.fromEntries(Object.entries(heirPersona.lists).map(([key, values]) => [key, [...values]])) as Persona["lists"];
  const grudges = [...parentLineage.grudges];
  const death = parentLineage.died ?? null;
  if (parentPersona.toggles.grudges && death !== null) {
    const race = killerRace(death.cause);
    const family = familyOf(race);
    if (family !== "other") {
      grudges.push({ race, family, generation: parentLineage.generation });
      const target = sliders.boldness >= 50 ? lists.hated : lists.feared;
      if (!target.includes(family) && target.length < 12) target.push(family);
    }
  }

  const count = Math.min(12, Math.floor(12 * fraction(parentPersona.sliders.inheritance)));
  const lore = parentLineage.lore.map((lesson) => ({ lesson, tie: unit(rng) }))
    .sort((a, b) => b.lesson.weight - a.lesson.weight || a.tie - b.tie)
    .slice(0, count).map(({ lesson }) => ({ ...lesson, weight: lesson.weight / 2 }));
  const parent: Ancestor = {
    name: parentLineage.name, race: parentLineage.race ?? "unknown", cls: parentLineage.cls ?? "unknown",
    generation: parentLineage.generation, died: death,
  };
  return {
    lineage: {
      name: heirPersona.name, generation: parentLineage.generation + 1,
      ancestors: [...parentLineage.ancestors, parent], lore, grudges,
      creeds: inheritCreeds(parentLineage.creeds ?? [], parentPersona),
    },
    persona: { ...heirPersona, sliders, lists },
  };
}
