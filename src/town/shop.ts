/** Shop decisions use only names and prices displayed in the entered shop. */

import type { AgentView, StoreView } from "@rpgm-tools/neo-angband-core";
import { readPack, type Pack } from "../brain/pack.js";
import type { Persona } from "../persona/persona.js";
import { basketWants } from "../strategy/readiness.js";
import { matchesSupplyName, shownName, supplyNeeds, type SupplyKind, type SupplyNeed } from "./needs.js";
import { gearCandidates, keepsCapacity, loadoutDamage, loadoutMissileDamage, TV } from "../gear/compare.js";
import type { HomeStock } from "./home.js";

/** Magic tvals, as Angband 4.2 numbers them. Copied here so the shopping rules don't import brain/items. */
const TV_MAGIC = { STAFF: 22, WAND: 23, ROD: 24, SCROLL: 25, POTION: 26 } as const;
/** The remaining trade tvals, copied for the same reason. */
const TV_TRADE = { FLASK: 27, FOOD: 28, MUSHROOM: 29, MAGIC_BOOK: 30, PRAYER_BOOK: 31, NATURE_BOOK: 32, SHADOW_BOOK: 33 } as const;

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
  /** The item kind, so a route can match the store's own buy list. */
  readonly tval: number;
}

export type { SupplyKind } from "./needs.js";

const PRIORITY: readonly SupplyKind[] = ["healing", "phase", "food", "light", "escape", "recall", "oil", "ammo"];

/** Fixed stock categories in Angband 4.2 store.txt. */
export function storesFor(kind: SupplyKind): readonly string[] {
  return kind === "healing" || kind === "phase" || kind === "escape" || kind === "recall" ? ["Alchemy Shop"] : ["General Store"];
}

/**
 * A small survival reserve takes precedence over savings and larger supply
 * stacks. Beyond it, `order` is the buying order the persona chose for this
 * visit; kinds it ranks below keeping the gold are not bought.
 */
export function shoppingList(needs: readonly SupplyNeed[], store: StoreView, gold: number, persona: Persona | null, order: readonly string[] | null = null): Purchase[] {
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
  const saveAt = order === null ? -1 : order.indexOf("save");
  const kinds = order === null ? PRIORITY : [...PRIORITY].filter((kind) => saveAt === -1 || !order.includes(kind) || order.indexOf(kind) < saveAt)
    .sort((a, b) => (order.includes(a) ? order.indexOf(a) : order.length) - (order.includes(b) ? order.indexOf(b) : order.length));
  for (const kind of kinds) {
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

/**
 * How many of each supply kind the character keeps before any can sell. The
 * figure is the same one the town buy path uses: the supply wants, raised to
 * the persona's basket, so a sell and the buy that follows it never disagree.
 */
function keepTargets(view: AgentView, persona: Persona | null, darkLesson: boolean): Map<SupplyKind, number> {
  const targets = new Map<SupplyKind, number>();
  for (const need of supplyNeeds(view, readPack(view), persona, darkLesson)) targets.set(need.kind, need.want);
  const basket = basketWants(persona);
  targets.set("healing", Math.max(targets.get("healing") ?? 0, basket.healing));
  targets.set("phase", Math.max(targets.get("phase") ?? 0, basket.phase));
  targets.set("food", Math.max(targets.get("food") ?? 0, basket.food));
  targets.set("light", Math.max(targets.get("light") ?? 0, basket.light));
  /* Escapes and Word of Recall are never shed: below the depth where the need
   * asks for them the want is 0, and the only Teleportation would go. */
  targets.set("escape", Infinity);
  targets.set("recall", Infinity);
  return targets;
}

/** Total stock by supply kind across the whole pack, so excess is a per-kind figure. */
function countByKind(view: AgentView): Map<SupplyKind, number> {
  const totals = new Map<SupplyKind, number>();
  const classify = (name: string): SupplyKind | null => {
    if (/\bPotions? of Cure (Light|Serious|Critical) Wounds\b/i.test(name)) return "healing";
    if (/\bScrolls? of Phase Door\b/i.test(name)) return "phase";
    if (/\bScrolls? of (Teleportation|Teleport Level)\b/i.test(name)) return "escape";
    if (/\bScrolls? of Word of Recall\b/i.test(name)) return "recall";
    if (/\bWooden (Torch|Torches)\b/i.test(name)) return "light";
    if (/\bFlasks? of Oil\b/i.test(name)) return "oil";
    if (/\bRations? of Food\b/i.test(name)) return "food";
    return null;
  };
  for (const item of view.inventory()) {
    const name = shownName(item);
    const kind = name === null ? null : classify(name);
    if (kind === null) continue;
    totals.set(kind, (totals.get(kind) ?? 0) + item.number);
  }
  return totals;
}

/** A share of the kind's remaining excess to take from this stack. */
function spareFromBudget(item: { readonly name?: string | null; readonly number: number }, remainingByKind: ReadonlyMap<SupplyKind, number>): { readonly kind: SupplyKind | null; readonly quantity: number } {
  const name = shownName(item as unknown as Parameters<typeof shownName>[0]);
  if (name === null) return { kind: null, quantity: 0 };
  const pick = (kind: SupplyKind): { kind: SupplyKind; quantity: number } => ({ kind, quantity: Math.min(item.number, remainingByKind.get(kind) ?? 0) });
  if (/\bPotions? of Cure (Light|Serious|Critical) Wounds\b/i.test(name)) return pick("healing");
  if (/\bScrolls? of Phase Door\b/i.test(name)) return pick("phase");
  if (/\bScrolls? of (Teleportation|Teleport Level)\b/i.test(name)) return pick("escape");
  if (/\bScrolls? of Word of Recall\b/i.test(name)) return pick("recall");
  if (/\bWooden (Torch|Torches)\b/i.test(name)) return pick("light");
  if (/\bFlasks? of Oil\b/i.test(name)) return pick("oil");
  if (/\bRations? of Food\b/i.test(name)) return pick("food");
  return { kind: null, quantity: 0 };
}

/**
 * Selling threshold by category. Plain spare weapons and armour always sell at
 * selling >= 60. Wands, rods, rings and amulets need a more permissive persona;
 * consumable excess needs even more. A hoarding slider keeps spares in the pack.
 */
function sellingThreshold(category: "gear" | "magic" | "consumable", selling: number, hoarding: number): boolean {
  if (hoarding >= 60) return category === "gear" && selling >= 60;
  if (category === "gear") return selling >= 60;
  if (category === "magic") return selling >= 70;
  return selling >= 80;
}

/**
 * An item is quest-bound when its shown name is a named artifact or still
 * carries unknown runes. Only the name the player can read is consulted, so a
 * plain item the player knows is plain can be sold and an unknown one is kept.
 */
function isQuestItem(name: string): boolean {
  return /'[^']+'/.test(name) || /\{\?\?\}/.test(name);
}

/** Devices kept beyond one of their kind: rods that heal recharge, so a few are worth carrying. */
const DEVICE_KEEP: Readonly<Record<string, number>> = { curing: 3, healing: 3 };

/** The effect behind a device's shown name, so one of each kind can be kept. */
function magicFamily(name: string): string {
  const effect = /\bof\s+(.+?)(?:\s*\(|$)/i.exec(name)?.[1] ?? name;
  return effect.toLowerCase().replace(/\s+/g, " ").trim();
}

/**
 * Sell spares: plain duplicate weapons/armour at the threshold above, plus
 * duplicate wands, rods and staves while one of each kind and the best attack
 * wand stay, plus rings, amulets and excess consumables, with stricter
 * thresholds and guards on the survival basket, the last light, the equipped
 * slot and quest items.
 */
export function sellList(pack: Pack, view: AgentView, persona: Persona | null, trophies: ReadonlySet<number> = new Set(), darkLesson = false): Sale[] {
  if (persona === null) return [];
  const selling = persona.sliders.selling;
  const hoarding = persona.sliders.hoarding;
  const worn = new Set(view.equipment().filter((item) => item !== null).map((item) => item.handle));
  const fuelNames = /\b(Wooden (?:Torch|Torches)|Flasks? of Oil|Lanterns?)\b/i;
  const lastFuelHandle = lastFuelCandidate(view, fuelNames, worn);
  const attackWand = pack.attackWand[0]?.handle ?? null;
  const out: Sale[] = [];
  const seen = new Set<string>();
  const keptDevice = new Map<string, number>();
  const upgrades = new Set(gearCandidates(view).filter((candidate) => !candidate.unknown).map((candidate) => candidate.handle));
  const remainingByKind = new Map<SupplyKind, number>();
  const keep = keepTargets(view, persona, darkLesson);
  for (const [kind, total] of countByKind(view)) remainingByKind.set(kind, Math.max(0, total - (keep.get(kind) ?? 0)));
  for (const item of view.inventory()) {
    const name = shownName(item);
    if (name === null) continue;
    if (worn.has(item.handle)) continue;
    if (upgrades.has(item.handle)) continue;
    if (isQuestItem(name)) continue;
    if (lastFuelHandle !== null && item.handle === lastFuelHandle) continue;
    const type = /\b(Sword|Dagger|Mace|Axe|Spear|Bow|Crossbow|Sling|Armour|Armor|Shield|Helm|Boots|Gloves|Cloak)s?\b/i.exec(name)?.[1];
    if (type !== undefined) {
      /* The ego and rune markers belong to weapons and armour; a wand's "of" is
       * its plain kind, and a potion's "of" is its effect, so the check stops at
       * the gear branch. */
      if (mightBeSpecial(name)) continue;
      if (persona.lists.weapons.some((favoured) => name.toLowerCase().includes(favoured.toLowerCase()))) continue;
      if (seen.has(type.toLowerCase())) {
        const result = view.simulateLoadout?.({ release: [{ handle: item.handle, number: item.number }] });
        if (result !== undefined && result !== null && (!keepsCapacity(view, result) || result.after.player.speed < result.before.player.speed || result.after.player.maxSp < result.before.player.maxSp || (loadoutDamage(result.after) ?? 0) < (loadoutDamage(result.before) ?? 0) || (loadoutMissileDamage(result.after, view) ?? 0) < (loadoutMissileDamage(result.before, view) ?? 0))) continue;
        if (!sellingThreshold("gear", selling, hoarding)) continue;
        const quantity = item.number - (trophies.has(item.handle) ? 1 : 0);
        if (quantity > 0) out.push({ handle: item.handle, quantity, name, tval: item.tval });
      }
      seen.add(type.toLowerCase());
      continue;
    }
    if (item.tval === TV_MAGIC.STAFF || item.tval === TV_MAGIC.WAND || item.tval === TV_MAGIC.ROD) {
      if (!sellingThreshold("magic", selling, hoarding)) continue;
      const family = magicFamily(name);
      const kept = keptDevice.get(family) ?? 0;
      /* Keep one of each kind (three healing rods), the best charged attack wand and the trophy. */
      const owed = Math.max(0, (item.tval === TV_MAGIC.ROD ? DEVICE_KEEP[family] ?? 1 : 1) - kept);
      const held = Math.min(item.number, Math.max(owed, item.handle === attackWand || trophies.has(item.handle) ? 1 : 0));
      keptDevice.set(family, kept + held);
      const quantity = item.number - held;
      if (quantity > 0) out.push({ handle: item.handle, quantity, name, tval: item.tval });
      continue;
    }
    if (item.tval === TV.AMULET || item.tval === TV.RING) {
      if (!sellingThreshold("magic", selling, hoarding)) continue;
      /* The protections a deeper level demands are aims; one carried is kept. */
      if (/Free Action|See Invisible|Seeing/i.test(name)) continue;
      const quantity = item.number - (trophies.has(item.handle) ? 1 : 0);
      if (quantity > 0) out.push({ handle: item.handle, quantity, name, tval: item.tval });
      continue;
    }
    const supply = spareFromBudget(item, remainingByKind);
    if (supply.kind !== null && supply.quantity > 0) {
      if (!sellingThreshold("consumable", selling, hoarding)) continue;
      remainingByKind.set(supply.kind, (remainingByKind.get(supply.kind) ?? 0) - supply.quantity);
      out.push({ handle: item.handle, quantity: supply.quantity, name, tval: item.tval });
    }
  }
  return out;
}

/**
 * Each store's buy list, by item kind, from the game's own store.txt. A store
 * with no entry buys nothing here, and the Black Market, which has no buy list,
 * buys anything. The home is not a sale: deposits go through homeSpares.
 */
const STORE_ALIASES: Readonly<Record<string, string>> = {
  STORE_GENERAL: "General Store",
  STORE_ALCHEMY: "Alchemy Shop",
  STORE_WEAPON: "Weapon Smiths",
  STORE_ARMOR: "Armoury",
  STORE_BOOK: "Bookstore",
  STORE_MAGIC: "Magic Shop",
  STORE_BLACK: "Black Market",
};

const BUY_TVALS: Readonly<Record<string, readonly number[] | null>> = {
  "General Store": [TV.LIGHT, TV_TRADE.FOOD, TV_TRADE.MUSHROOM, TV_TRADE.FLASK, TV.DIGGING, TV.CLOAK, TV.SHOT, TV.BOLT, TV.ARROW],
  "Alchemy Shop": [TV_MAGIC.SCROLL, TV_MAGIC.POTION],
  "Armoury": [TV.BOOTS, TV.GLOVES, TV.HELM, TV.CROWN, TV.SHIELD, TV.CLOAK, TV.SOFT_ARMOR, TV.HARD_ARMOR, TV.DRAG_ARMOR],
  "Weapon Smiths": [TV.HAFTED, TV.POLEARM, TV.SWORD, TV.BOW, TV.SHOT, TV.ARROW, TV.BOLT, TV.DIGGING],
  "Bookstore": [TV_TRADE.MAGIC_BOOK, TV_TRADE.PRAYER_BOOK, TV_TRADE.NATURE_BOOK, TV_TRADE.SHADOW_BOOK],
  "Magic Shop": [TV_TRADE.MAGIC_BOOK, TV.AMULET, TV.RING, TV_MAGIC.STAFF, TV_MAGIC.WAND, TV_MAGIC.ROD],
  "Black Market": null,
};

/** Whether this store's buy list takes an item of this kind. */
export function saleFits(tval: number, storeName: string): boolean {
  const list = BUY_TVALS[STORE_ALIASES[storeName] ?? storeName];
  if (list === undefined) return false;
  return list === null || list.includes(tval);
}

/** The handle whose removal would leave the character without a light source. */
function lastFuelCandidate(view: AgentView, pattern: RegExp, worn: ReadonlySet<number>): number | null {
  const candidates = [...view.inventory().filter((item) => pattern.test(shownName(item) ?? "")).map((item) => item.handle), ...view.equipment().filter((item) => item !== null && pattern.test(shownName(item) ?? "")).map((item) => (item as { handle: number }).handle)];
  return candidates.length === 1 && !worn.has(candidates[0]!) ? candidates[0]! : null;
}

/**
 * Items to withdraw from the home before shopping for the same need. The home
 * contents must already be remembered; an unknown home returns nothing.
 */
export function homeWithdrawal(home: HomeStock, needs: readonly SupplyNeed[]): { readonly name: string; readonly quantity: number }[] {
  if (!home.entered) return [];
  const out: { name: string; quantity: number }[] = [];
  for (const need of needs) {
    if (need.have >= need.want) continue;
    const want = need.want - need.have;
    let total = 0;
    for (const ware of home.wares) {
      if (matchesSupplyName(ware.name, need.name)) total += ware.count;
    }
    if (total <= 0) continue;
    out.push({ name: need.name, quantity: Math.min(want, total) });
  }
  return out;
}

/**
 * Items the home can spare for later. A hoarding persona keeps more in the pack,
 * so the excess sent home is smaller; a miser with a low hoarding slider ships
 * almost everything beyond one stack.
 */
export function homeSpares(view: AgentView, persona: Persona | null, darkLesson = false): { readonly handle: number; readonly name: string; readonly quantity: number }[] {
  if (persona === null) return [];
  const keep = keepTargets(view, persona, darkLesson);
  const remainingByKind = new Map<SupplyKind, number>();
  for (const [kind, total] of countByKind(view)) {
    const excess = Math.max(0, total - (keep.get(kind) ?? 0));
    /* A hoarding persona keeps half of the excess in the pack; a non-hoarder sends most home. */
    const held = persona.sliders.hoarding >= 60 ? Math.ceil(excess / 2) : 0;
    remainingByKind.set(kind, excess - held);
  }
  const out: { handle: number; name: string; quantity: number }[] = [];
  for (const item of view.inventory()) {
    const name = shownName(item);
    if (name === null) continue;
    const supply = spareFromBudget(item, remainingByKind);
    if (supply.kind === null || supply.quantity === 0) continue;
    remainingByKind.set(supply.kind, (remainingByKind.get(supply.kind) ?? 0) - supply.quantity);
    out.push({ handle: item.handle, name, quantity: supply.quantity });
  }
  return out;
}
