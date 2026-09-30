/** Shop decisions use only names and prices displayed in the entered shop. */

import type { AgentView, StoreView } from "@rpgm-tools/neo-angband-core";
import type { Pack } from "../brain/pack.js";
import type { Persona } from "../persona/persona.js";
import { matchesSupplyName, shownName, type SupplyKind, type SupplyNeed } from "./needs.js";
import { gearCandidates, keepsCapacity, loadoutDamage, loadoutMissileDamage } from "../gear/compare.js";

export interface Purchase {
  readonly index: number;
  readonly quantity: number;
  readonly kind: SupplyKind;
  readonly name: string;
}

export interface Sale {
  readonly handle: number;
  readonly quantity: number;
  readonly name: string;
}

const PRIORITY: readonly SupplyKind[] = ["healing", "phase", "food", "light", "escape", "recall", "oil", "ammo"];

/** Fixed stock categories in Angband 4.2 store.txt. */
export function storesFor(kind: SupplyKind): readonly string[] {
  return kind === "healing" || kind === "phase" || kind === "escape" || kind === "recall" ? ["Alchemy Shop"] : ["General Store"];
}

/** A small survival reserve takes precedence over savings and larger supply stacks. */
export function shoppingList(needs: readonly SupplyNeed[], store: StoreView, gold: number, persona: Persona | null): Purchase[] {
  if (store.isHome) return [];
  const reserve = Math.floor(gold * Math.max(0, (persona?.sliders.savings ?? 50) - 50) / 200);
  let left = Math.max(0, gold);
  const out: Purchase[] = [];
  const starterBought = new Map<SupplyKind, number>();
  const stockBought = new Map<number, number>();
  /* Alternating small purchases leaves gold for both kinds when a full stack would consume it. */
  for (const target of [1, 2]) {
    for (const kind of ["healing", "phase", "food", "light"] as const) {
      const need = needs.find((entry) => entry.kind === kind);
      const already = starterBought.get(kind) ?? 0;
      if (need === undefined || need.have + already >= Math.min(target, need.want) || !storesFor(kind).includes(store.featName)) continue;
      const ware = store.stock.find((item) => {
        const name = shownName(item);
        return name !== null && matchesSupplyName(name, need.name) && item.number > (stockBought.get(item.index) ?? 0) &&
          item.price !== undefined && item.price > 0 && item.price <= left;
      });
      if (ware === undefined || ware.price === undefined) continue;
      out.push({ index: ware.index, quantity: 1, kind, name: shownName(ware) ?? need.name });
      left -= ware.price;
      starterBought.set(kind, already + 1);
      stockBought.set(ware.index, (stockBought.get(ware.index) ?? 0) + 1);
    }
  }
  if (out.length > 0) return out;
  const bought = new Set<number>();
  for (const kind of PRIORITY) {
    const need = needs.find((entry) => entry.kind === kind);
    if (need === undefined || need.have >= need.want || !storesFor(kind).includes(store.featName)) continue;
    const ware = store.stock.find((item) => {
      const name = shownName(item);
      return !bought.has(item.index) && name !== null && matchesSupplyName(name, need.name) &&
        item.price !== undefined && item.price > 0;
    });
    if (ware === undefined || ware.price === undefined) continue;
    const budget = kind === "recall" ? left : Math.max(0, left - reserve);
    /* Oil is also lantern fuel. One purchase serves both needs. */
    const sameFuel = kind === "light" && need.name === "Flask of Oil" ? needs.find((entry) => entry.kind === "oil") : undefined;
    const deficit = Math.max(need.want - need.have, sameFuel === undefined ? 0 : sameFuel.want - sameFuel.have);
    const quantity = Math.min(deficit, ware.number, Math.floor(budget / ware.price));
    if (quantity <= 0) continue;
    out.push({ index: ware.index, quantity, kind, name: shownName(ware) ?? need.name });
    left -= quantity * ware.price;
    bought.add(ware.index);
  }
  return out;
}

/**
 * Whether the shown name marks an item as more than plain: runes still unknown
 * ({??}), an ego's "of ..." suffix, or an artifact's quoted name. The view's own
 * ego and artifact fields are the item's truth, which the player may not know
 * yet, so the decision uses only what the name shows.
 */
export function mightBeSpecial(name: string): boolean {
  return /\{\?\?\}/.test(name) || /'[^']+'/.test(name) || /(?<!\b(?:Pair|Set))\s+of\s+/i.test(name);
}

/** Sell only an extra, named piece of gear after keeping the first spare. */
export function sellList(_pack: Pack, view: AgentView, persona: Persona | null, trophies: ReadonlySet<number> = new Set()): Sale[] {
  if (persona === null || persona.sliders.selling < 60) return [];
  const worn = new Set(view.equipment().filter((item) => item !== null).map((item) => item.handle));
  const seen = new Set<string>();
  const out: Sale[] = [];
  const upgrades = new Set(gearCandidates(view).filter((candidate) => !candidate.unknown).map((candidate) => candidate.handle));
  for (const item of view.inventory()) {
    const name = shownName(item);
    if (name === null || worn.has(item.handle) || mightBeSpecial(name) || upgrades.has(item.handle)) continue;
    const type = /\b(Sword|Dagger|Mace|Axe|Spear|Bow|Crossbow|Sling|Armour|Armor|Shield|Helm|Boots|Gloves|Cloak)s?\b/i.exec(name)?.[1];
    if (type === undefined) continue;
    if (persona.lists.weapons.some((favoured) => name.toLowerCase().includes(favoured.toLowerCase()))) continue;
    if (seen.has(type.toLowerCase())) {
      const result = view.simulateLoadout?.({ release: [{ handle: item.handle, number: item.number }] });
      if (result !== undefined && result !== null && (!keepsCapacity(view, result) || result.after.player.speed < result.before.player.speed || result.after.player.maxSp < result.before.player.maxSp || (loadoutDamage(result.after) ?? 0) < (loadoutDamage(result.before) ?? 0) || (loadoutMissileDamage(result.after, view) ?? 0) < (loadoutMissileDamage(result.before, view) ?? 0))) continue;
      const quantity = item.number - (trophies.has(item.handle) ? 1 : 0);
      if (quantity > 0) out.push({ handle: item.handle, quantity, name });
    }
    seen.add(type.toLowerCase());
  }
  return out;
}

/** The Armoury and Weapon Smiths buy only the corresponding surplus gear. */
export function saleFits(name: string, storeName: string): boolean {
  return storeName === "Armoury" ? /\b(Armour|Armor|Shield|Helm|Boots|Gloves|Cloak)s?\b/i.test(name) :
    storeName === "Weapon Smiths" && /\b(Sword|Dagger|Mace|Axe|Spear|Bow|Crossbow|Sling)s?\b/i.test(name);
}
