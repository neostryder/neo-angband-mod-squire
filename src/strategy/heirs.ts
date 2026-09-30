/**
 * Which aims an heir inherits. A depth target and a family weapon can pass to a
 * successor; a lantern, empty armour slots and the next spellbook belong to the
 * old character's kit and class, and the protection aims follow the heir's own
 * gear, so those are never carried. The heir's persona can drop what clashes
 * with it, and what stays is ranked with every other candidate at the first
 * review.
 */

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

/** The deepest target an heir with this ambition keeps: 5 levels at none, 30 at full. */
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
 * the heir's persona then drops a depth target deeper than its ambition allows.
 */
export function inheritAims(aims: readonly InheritedAim[], parent: Persona, heir: Persona): InheritedAim[] {
  const s = share(parent);
  const ceiling = depthCeiling(heir.sliders.ambition);
  const kept: InheritedAim[] = [];
  for (const aim of aims) {
    if (!INHERITABLE.includes(aim.kind) || kept.some((k) => k.kind === aim.kind)) continue;
    if (aim.kind === "depth") {
      const depth = aim.depth === null ? 0 : Math.max(1, Math.round(aim.depth * s));
      if (depth < 1 || depth > ceiling) continue;
      kept.push({ kind: "depth", depth });
    } else {
      kept.push({ kind: "weapon", depth: null });
    }
  }
  return kept.slice(0, Math.floor(MAX_INHERITED_AIMS * s));
}

/**
 * Fold inherited aims into the heir's first candidates. A depth target only
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