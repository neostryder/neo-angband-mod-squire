/** Shop decisions use only names and prices displayed in the entered shop. */

import type { AgentView, StoreView } from "@rpgm-tools/neo-angband-core";
import type { Pack } from "../brain/pack.js";
import type { Persona } from "../persona/persona.js";
import { matchesSupplyName, shownName, type SupplyKind, type SupplyNeed } from "./needs.js";

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

const PRIORITY: readonly SupplyKind[] = ["recall", "healing", "phase", "food", "light", "oil", "ammo"];

/** Fixed stock categories in Angband 4.2 store.txt. */
export function storesFor(kind: SupplyKind): readonly string[] {
  return kind === "healing" || kind === "phase" || kind === "recall" ? ["Alchemy Shop"] : ["General Store"];
}

/** Keep high-savings gold in reserve, but let essential recall break the reserve. */
export function shoppingList(needs: readonly SupplyNeed[], store: StoreView, gold: number, persona: Persona | null): Purchase[] {
  if (store.isHome) return [];
  const reserve = Math.floor(gold * Math.max(0, (persona?.sliders.savings ?? 50) - 50) / 200);
  let left = Math.max(0, gold);
  const out: Purchase[] = [];
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

/** Sell only an extra, named piece of gear after keeping the first spare. */
export function sellList(_pack: Pack, view: AgentView, persona: Persona | null): Sale[] {
  if (persona === null || persona.sliders.selling < 60) return [];
  const worn = new Set(view.equipment().filter((item) => item !== null).map((item) => item.handle));
  const seen = new Set<string>();
  const out: Sale[] = [];
  for (const item of view.inventory()) {
    const name = shownName(item);
    if (name === null || worn.has(item.handle) || item.artifact || item.ego) continue;
    const type = /\b(Sword|Dagger|Mace|Axe|Spear|Bow|Crossbow|Sling|Armour|Armor|Shield|Helm|Boots|Gloves|Cloak)\b/i.exec(name)?.[1];
    if (type === undefined) continue;
    if (persona.lists.weapons.some((favoured) => name.toLowerCase().includes(favoured.toLowerCase()))) continue;
    if (seen.has(type.toLowerCase())) out.push({ handle: item.handle, quantity: item.number, name });
    seen.add(type.toLowerCase());
  }
  return out;
}

/** The Armoury and Weapon Smiths buy only the corresponding surplus gear. */
export function saleFits(name: string, storeName: string): boolean {
  return storeName === "Armoury" ? /\b(Armour|Armor|Shield|Helm|Boots|Gloves|Cloak)\b/i.test(name) :
    storeName === "Weapon Smiths" && /\b(Sword|Dagger|Mace|Axe|Spear|Bow|Crossbow|Sling)\b/i.test(name);
}
