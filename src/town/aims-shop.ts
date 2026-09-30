/**
 * Buying the item an affordable aim wants, inside the shop that sells it.
 *
 * The strategy layer ranks aims and prices them from the stores; the town trip
 * already buys supplies. This picks the top aim the gold on hand covers and
 * returns the ware to buy from the entered store, so a trip home funds the aim
 * rather than only restocking.
 */

import type { StoreView } from "@rpgm-tools/neo-angband-core";
import { TV } from "../gear/compare.js";
import { affordable, type Aim } from "../strategy/aims.js";
import { shownName } from "./needs.js";
import { mightBeSpecial } from "./shop.js";

export interface AimPurchase {
  readonly index: number;
  readonly quantity: number;
  readonly name: string;
  readonly aim: string;
}

const ARMOUR: readonly number[] = [TV.BOOTS, TV.GLOVES, TV.HELM, TV.CROWN, TV.SHIELD, TV.CLOAK, TV.SOFT_ARMOR, TV.HARD_ARMOR, TV.DRAG_ARMOR];
const WEAPONS: readonly number[] = [TV.HAFTED, TV.POLEARM, TV.SWORD];

/** Whether a ware is the kind of thing this aim is after. */
function matchesAim(aim: Aim, name: string, tval: number): boolean {
  switch (aim.kind) {
    case "lantern": return /\bLantern\b/i.test(name);
    case "armour": return ARMOUR.includes(tval);
    case "weapon": return WEAPONS.includes(tval) && mightBeSpecial(name);
    case "free-action": return /Free Action/i.test(name);
    case "see-invisible": return /See Invisible|Seeing/i.test(name);
    case "spellbook": return /\bBook\b/i.test(name);
    case "preparation": return false;
    case "depth": return false;
    case "avenge": return false;
  }
}

/** The top affordable aim this store's own stock satisfies, or null. */
export function aimPurchase(aims: readonly Aim[], store: StoreView, gold: number): AimPurchase | null {
  if (store.isHome) return null;
  for (const aim of aims) {
    const protection = (aim.kind === "free-action" || aim.kind === "see-invisible") && aim.how === "hunt";
    if (!protection && (aim.price === null || !affordable(aim, gold))) continue;
    const ware = store.stock.find((item) => {
      const name = shownName(item);
      return name !== null && item.price !== undefined && item.price > 0 && item.price <= gold && matchesAim(aim, name, item.tval);
    });
    if (ware === undefined) continue;
    return { index: ware.index, quantity: 1, name: shownName(ware) ?? aim.label, aim: aim.label };
  }
  return null;
}

/** The shops a town trip may visit for this aim, guessed by kind and never by stock. */
export function aimStores(aim: Aim): readonly string[] {
  switch (aim.kind) {
    case "armour": return ["Armoury"];
    case "weapon": return ["Weapon Smiths"];
    case "lantern": return ["General Store"];
    case "free-action":
    case "see-invisible": return ["Alchemy Shop", "General Store", "Armoury"];
    default: return [];
  }
}
