/**
 * Which aims an heir inherits. A depth target and a family weapon can pass to a
 * successor; a lantern, empty armour slots and the next spellbook belong to the
 * old character's kit and class, and the protection aims follow the heir's own
 * gear, so those are never carried. The heir's persona can drop what clashes
 * with it, and what stays is ranked with every other candidate at each review
 * until it is achieved or the heir's own aim of that kind replaces it.
 */

import type { Feeling } from "../learning/grudges.js";
import type { Persona } from "../persona/persona.js";
import type { Aim, AimKind } from "./aims.js";

export type InheritedAimKind = Extract<AimKind, "depth" | "weapon">;

export interface InheritedAim {
  readonly kind: InheritedAimKind;
  /** Dungeon level to reach, for the depth aim. */
  readonly depth: number | null;
}

const INHERITABLE: readonly AimKind[] = ["depth", "weapon"];

/** The most aims one line hands on, before the Inheritance slider trims them. */
export const MAX_INHERITED_AIMS = INHERITABLE.length;

/**
 * How deep an inherited target an heir takes on at once: 5 levels at no
 * ambition, 30 at full. It sets the pace of the inherited target only; the win
 * is the heir's own aim and has no ceiling.
 */
export function depthCeiling(ambition: number): number {
  return 5 + Math.floor(Math.max(0, Math.min(100, ambition)) / 4);
}

function share(persona: Persona): number {
  return Math.max(0, Math.min(1, persona.sliders.inheritance / 100));
}

/** The passable part of a dead character's ranked aims, best first. */
export function passableAims(aims: readonly Aim[]): InheritedAim[] {
  return aims.flatMap((aim): InheritedAim[] =>
    aim.kind === "depth" ? [{ kind: "depth", depth: aim.depth }] : aim.kind === "weapon" ? [{ kind: "weapon", depth: null }] : []);
}

/**
 * The aims an heir starts with. The parent's Inheritance slider sets how many
 * pass (as it sets how much lore does) and how much of a depth target carries;
 * the heir's persona then shortens a depth target deeper than its ambition
 * takes on at once.
 */
export function inheritAims(aims: readonly InheritedAim[], parent: Persona, heir: Persona): InheritedAim[] {
  const s = share(parent);
  const ceiling = depthCeiling(heir.sliders.ambition);
  const kept: InheritedAim[] = [];
  for (const aim of aims) {
    if (!INHERITABLE.includes(aim.kind) || kept.some((k) => k.kind === aim.kind)) continue;
    if (aim.kind === "depth") {
      const depth = aim.depth === null ? 0 : Math.max(1, Math.round(aim.depth * s));
      if (depth < 1) continue;
      kept.push({ kind: "depth", depth: Math.min(depth, ceiling) });
    } else {
      kept.push({ kind: "weapon", depth: null });
    }
  }
  return kept.slice(0, Math.floor(MAX_INHERITED_AIMS * s));
}

/**
 * Fold inherited aims into the heir's candidates. A depth target only
 * raises the code's own target, and a weapon aim is added when the heir has no
 * weapon aim of its own.
 */
export function withInherited(candidates: readonly Aim[], inherited: readonly InheritedAim[]): Aim[] {
  const out = [...candidates];
  for (const aim of inherited) {
    const at = out.findIndex((c) => c.kind === aim.kind);
    if (aim.kind === "depth" && aim.depth !== null) {
      const target = aim.depth;
      const own = at === -1 ? null : out[at]!;
      if (own !== null && (own.depth ?? 0) >= target) continue;
      const made: Aim = {
        kind: "depth", label: "depth target",
        detail: `Reach dungeon level ${String(target)} (${String(target * 50)} ft), the depth the family line was aiming for.`,
        how: "dive", price: null, depth: target,
      };
      if (at === -1) out.push(made); else out[at] = made;
    } else if (aim.kind === "weapon" && at === -1) {
      out.push({
        kind: "weapon", label: "magic weapon",
        detail: "The family line was hunting a magical or ego weapon. Look for one in the dungeon.",
        how: "hunt", price: null, depth: null,
      });
    }
  }
  return out;
}

/**
 * The inherited aims still worth carrying into this review: a depth target
 * stays until the heir reaches it or its own target reaches as deep, and a
 * weapon aim stays until the heir wields a magical weapon or finds one to
 * pursue of its own.
 */
export function stillInherited(inherited: readonly InheritedAim[], own: readonly Aim[], maxDepth: number, wieldsMagic: boolean): InheritedAim[] {
  return inherited.filter((aim) => {
    if (aim.kind === "depth") {
      if (aim.depth === null || maxDepth >= aim.depth) return false;
      return !own.some((c) => c.kind === "depth" && (c.depth ?? 0) >= aim.depth!);
    }
    return !wieldsMagic && !own.some((c) => c.kind === "weapon");
  });
}

/**
 * The avenge aim for the hated unique that killed the most of the family, if
 * the heir hates one. It is ranked with the other aims, and it only adds weight
 * to fighting that unique within the risk the persona accepts.
 */
export function avengeAim(feelings: readonly Feeling[]): Aim | null {
  const hated = feelings.filter((f) => f.unique && f.kind === "hatred").sort((a, b) => b.count - a.count)[0];
  if (hated === undefined) return null;
  return {
    kind: "avenge", label: `avenge the family on ${hated.name}`,
    detail: `${hated.name} killed ${hated.count === 1 ? "one" : String(hated.count)} of the family line. Kill it when it can be fought without too much risk.`,
    how: "hunt", price: null, depth: null, target: hated.name,
  };
}

/** Add the avenge aim to the candidates, when the heir holds one. */
export function withAvenge(candidates: readonly Aim[], feelings: readonly Feeling[]): Aim[] {
  const aim = avengeAim(feelings);
  return aim === null ? [...candidates] : [...candidates, aim];
}
