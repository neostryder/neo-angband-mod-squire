/** Supplies for the next descent, counted only from names shown in the pack. */

import type { AgentView, ItemView } from "@rpgm-tools/neo-angband-core";
import { hungry, type Pack } from "../brain/pack.js";
import type { Persona } from "../persona/persona.js";

export type SupplyKind = "healing" | "phase" | "escape" | "recall" | "oil" | "food" | "light" | "ammo";

export interface SupplyNeed {
  readonly kind: SupplyKind;
  readonly want: number;
  readonly have: number;
  /** The food emergency applies only while the character is hungry. */
  readonly hungry?: boolean;
  /** Which visible ware satisfies this need. */
  readonly name: string;
}

export function shownName(item: ItemView): string | null {
  const name = (item as { readonly name?: unknown }).name;
  return typeof name === "string" && name.length > 0 ? name : null;
}

/** A stack may pluralize the visible item name. */
export function matchesSupplyName(shown: string, wanted: string): boolean {
  if (wanted === "Flask of Oil") return /\bFlasks? of Oil\b/i.test(shown);
  if (wanted === "Ration of Food") return /\bRations? of Food\b/i.test(shown);
  if (wanted === "Wooden Torch") return /\bWooden (Torch|Torches)\b/i.test(shown);
  return shown.toLowerCase().includes(wanted.toLowerCase());
}

export function supplyName(kind: SupplyKind, level: number, lantern: boolean, launcher: string | null): string {
  switch (kind) {
    case "healing": return level >= 15 ? "Cure Serious Wounds" : "Cure Light Wounds";
    case "phase": return "Phase Door";
    case "escape": return "Teleportation";
    case "recall": return "Word of Recall";
    case "oil": return "Flask of Oil";
    case "food": return "Ration of Food";
    case "light": return lantern ? "Flask of Oil" : "Wooden Torch";
    case "ammo": return launcher === "Sling" ? "Iron Shot" : launcher?.includes("Crossbow") ? "Bolt" : "Arrow";
  }
}

function count(items: readonly ItemView[], needle: string): number {
  return items.reduce((sum, item) => {
    const name = shownName(item);
    const matches = /Cure (Light|Serious) Wounds/.test(needle) ? /\bPotions? of Cure (Light|Serious|Critical) Wounds\b/i.test(name ?? "") : name !== null && matchesSupplyName(name, needle);
    return sum + (matches ? item.number : 0);
  }, 0);
}

/** The deepest level reached, in levels, before a recall scroll is worth buying. */
export const RECALL_FROM_DEPTH = 5;

function scale(base: number, slider: number, minimum: number): number {
  return Math.max(minimum, Math.round(base * (0.5 + slider / 100)));
}

/** Targets change with level, equipped light and launcher, and persona habits. */
export function supplyNeeds(view: AgentView, pack: Pack, persona: Persona | null): SupplyNeed[] {
  const items = view.inventory();
  const worn = view.equipment().map((item) => item === null ? null : shownName(item));
  const lantern = worn.some((name) => name !== null && /\bLantern\b/i.test(name));
  const launcher = worn.find((name) => name !== null && /\b(Sling|Short Bow|Long Bow|Light Crossbow|Heavy Crossbow)\b/i.test(name)) ?? null;
  const level = view.player().level;
  const destination = Math.max(view.player().depth + 1, view.player().maxDepth + 1);
  const consumables = persona?.sliders.consumables ?? 50;
  const escapes = persona?.sliders.escapes ?? 50;
  const healAt = persona?.sliders.healat ?? 50;
  const make = (kind: SupplyKind, want: number, extra: Pick<SupplyNeed, "hungry"> = {}): SupplyNeed => {
    const name = kind === "healing" && destination >= 10 ? "Cure Critical Wounds" : supplyName(kind, level, lantern, launcher);
    return { kind, want, have: count(items, name), name, ...extra };
  };
  const healingBase = view.player().cls === "Warrior" ? 6 : pack.healSpell.length > 0 ? 3 : 5;
  const healing = Math.max(2, scale(healingBase, consumables, 2) + Math.max(0, Math.round((healAt - 50) / 25)));
  /* Near the surface the stairs are close, and a recall scroll costs most of a
   * new character's gold, which healing potions need more. */
  const recall = destination >= RECALL_FROM_DEPTH ? scale(1, escapes, 1) : 0;
  return [
    make("healing", healing),
    make("phase", scale(5, escapes, 2)),
    ...(destination >= 10 ? [make("escape", destination > 25 ? 6 : 2)] : []),
    make("recall", recall),
    ...(level < 20 ? [make("oil", scale(10, consumables, 1))] : []),
    make("food", scale(5, consumables, 5), { hungry: hungry(view) }),
    ...(!view.player().objectFlags.includes("NO_FUEL") && !view.player().classFlags.includes("UNLIGHT") ? [make("light", scale(2, consumables, 2))] : []),
    ...(pack.launcher && launcher !== null ? [make("ammo", scale(40, consumables, 1))] : []),
  ];
}

/** A recall trip is useful only if a visible recall scroll can start it. */
export function lowOnSupplies(needs: readonly SupplyNeed[]): boolean {
  if ((needs.find((n) => n.kind === "recall")?.have ?? 0) < 1) return false;
  return (needs.find((n) => n.kind === "healing")?.have ?? 0) < 2 ||
    (needs.find((n) => n.kind === "phase")?.have ?? 0) < 1 ||
    needs.some((n) => n.kind === "food" && n.have === 0 && n.hungry === true);
}

/** A named scroll in inventory; unidentified scrolls are never guessed. */
export function recallItem(view: AgentView): ItemView | null {
  return view.inventory().find((item) => /\bScrolls? of Word of Recall\b/i.test(shownName(item) ?? "")) ?? null;
}
