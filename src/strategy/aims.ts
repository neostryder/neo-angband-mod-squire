/**
 * The aims Squire can hold above its tactical choices, and the code that works
 * out which of them apply to a character right now.
 *
 * An aim is a thing worth working toward over several levels: a spellbook, a
 * better weapon, armour for a bare slot, a lantern, the protection a depth
 * demands, a depth to reach. Code builds the candidates from the view; the
 * model only ranks them (see review.ts).
 */

import type { AgentView, ItemView } from "@rpgm-tools/neo-angband-core";
import { TV } from "../gear/compare.js";
import { shownName } from "../town/needs.js";
import { mightBeSpecial } from "../town/shop.js";
import { missingPreparation } from "./readiness.js";
import { stockConfidence, type StoreMemory } from "../town/memory.js";
import type { Persona } from "../persona/persona.js";
import { paceFactor, winStep } from "./pursuits.js";

export type AimKind = "spellbook" | "lantern" | "armour" | "weapon" | "free-action" | "see-invisible" | "preparation" | "depth" | "win" | "avenge";

/** How an aim is pursued: gold to save, something to find, something already carried, or a depth to reach. */
export type AimHow = "save" | "hunt" | "try" | "dive";

export interface Aim {
  readonly kind: AimKind;
  /** A short lowercase name, shown in the panel and named in offers. */
  readonly label: string;
  /** What the aim is and how to pursue it, one sentence, for the model. */
  readonly detail: string;
  readonly how: AimHow;
  /** Gold needed, when the stores show a price. */
  readonly price: number | null;
  /** Dungeon level to reach, for the depth aim. */
  readonly depth: number | null;
  /** The unique to kill, for the avenge aim. */
  readonly target?: string;
  readonly stock?: { readonly feat: number; readonly name: string; readonly turn: number; readonly confidence: number };
}

/** The order aims come in when the model cannot rank them. */
export const FIXED_ORDER: readonly AimKind[] = ["spellbook", "lantern", "armour", "weapon", "free-action", "see-invisible", "preparation", "depth", "win", "avenge"];

/** A book counts as next when its first spell is at most this many levels above the character. */
export const BOOK_LOOKAHEAD = 5;
/** Dungeon levels (50 ft each) where paralysis and invisible attackers start to be common. */
export const FREE_ACTION_DEPTH = 20;
export const SEE_INVISIBLE_DEPTH = 10;
/** How many levels before that depth the aim starts. */
export const PROTECTION_LEAD = 5;

const WEAPONS: readonly number[] = [TV.HAFTED, TV.POLEARM, TV.SWORD];
const ARMOUR_SLOTS: readonly { readonly name: string; readonly tvals: readonly number[] }[] = [
  { name: "body", tvals: [TV.SOFT_ARMOR, TV.HARD_ARMOR, TV.DRAG_ARMOR] },
  { name: "cloak", tvals: [TV.CLOAK] },
  { name: "shield", tvals: [TV.SHIELD] },
  { name: "head", tvals: [TV.HELM, TV.CROWN] },
  { name: "hands", tvals: [TV.GLOVES] },
  { name: "feet", tvals: [TV.BOOTS] },
];

interface Ware {
  readonly name: string;
  readonly tval: number;
  readonly price: number;
  readonly stock: NonNullable<Aim["stock"]>;
}

interface Shelves {
  readonly wares: readonly Ware[];
}

function shelves(view: AgentView, memories: readonly StoreMemory[]): Shelves {
  const wares = memories.flatMap((memory) => {
    const confidence = stockConfidence(memory, view.turn());
    return confidence <= 0 ? [] : memory.stock.filter((item) => item.count > 0 && item.price > 0).map((item) => ({
      name: item.name, tval: item.tval, price: item.price, stock: { feat: memory.feat, name: item.name, turn: memory.turn, confidence },
    }));
  });
  return { wares };
}

function cheapest(wares: readonly Ware[], match: (ware: Ware) => boolean): Ware | null {
  let best: Ware | null = null;
  for (const ware of wares) if (match(ware) && (best === null || ware.price / ware.stock.confidence < best.price / best.stock.confidence)) best = ware;
  return best;
}

/** Where an aim's item comes from: a priced shop item to save for, or the dungeon. */
function sourced(ware: Ware | null): { how: AimHow; price: number | null; stock?: NonNullable<Aim["stock"]> } {
  return ware === null ? { how: "hunt", price: null } : { how: "save", price: ware.price, stock: ware.stock };
}

function namesOf(items: readonly ItemView[]): string[] {
  return items.flatMap((item) => {
    const name = shownName(item);
    return name === null ? [] : [name];
  });
}

/** The dungeon level worth aiming for, from the character's level and hit points. */
export function depthTarget(level: number, maxHp: number): number {
  return Math.max(1, Math.min(Math.floor(level / 2), Math.floor(maxHp / 12)));
}

function bookAim(view: AgentView, shelf: Shelves, pack: readonly string[]): Aim | null {
  const level = view.player().level;
  for (const book of view.spellbooks()) {
    if (book.spells.length === 0 || book.name.length === 0) continue;
    if (pack.some((name) => name.includes(book.name))) continue;
    const first = Math.min(...book.spells.map((spell) => spell.level));
    /* Books come in order, so a book this far off is not the next one either. */
    if (first > level + BOOK_LOOKAHEAD) return null;
    const source = sourced(cheapest(shelf.wares, (ware) => ware.name.includes(book.name)));
    return {
      kind: "spellbook",
      label: "next spellbook",
      detail: `Get the next spellbook, ${book.name}, whose first spell is level ${String(first)}. ${source.how === "save" ? `I remember it at ${String(source.price)} gold, so save that much.` : "I have no shop memory of it, so hunt for it in the dungeon."}`,
      ...source,
      depth: null,
    };
  }
  return null;
}

function lanternAim(shelf: Shelves, pack: readonly string[], worn: readonly ItemView[]): Aim | null {
  const light = worn.find((item) => item.tval === TV.LIGHT);
  const name = light === undefined ? null : shownName(light);
  if (name === null || !/\bTorch/i.test(name) || /\bLantern/i.test(name)) return null;
  const carried = pack.some((n) => /\bLantern/i.test(n));
  const source = carried ? { how: "try" as const, price: null } : sourced(cheapest(shelf.wares, (ware) => /\bLantern/i.test(ware.name)));
  return {
    kind: "lantern",
    label: "lantern over torch",
    detail: `Use a Lantern instead of a wooden torch: it lights farther and refills from flasks of oil. ${source.how === "try" ? "One is in the pack." : source.how === "save" ? `I remember one at ${String(source.price)} gold.` : "I have no shop memory of one, so look for one in the dungeon."}`,
    ...source,
    depth: null,
  };
}

function armourAim(view: AgentView, shelf: Shelves, packItems: readonly ItemView[], worn: readonly ItemView[]): Aim | null {
  const casts = view.spellbooks().some((book) => /arcane|necromantic/i.test(book.realm));
  const wornTvals = worn.map((item) => item.tval);
  /* Gloves hurt an arcane caster's mana, so a bare hand is right for one. */
  const empty = ARMOUR_SLOTS.filter((slot) => !slot.tvals.some((t) => wornTvals.includes(t)) && !(casts && slot.name === "hands"));
  if (empty.length === 0) return null;
  const wanted = empty.flatMap((slot) => slot.tvals);
  const carried = packItems.some((item) => wanted.includes(item.tval));
  const source = carried ? { how: "try" as const, price: null } : sourced(cheapest(shelf.wares, (ware) => wanted.includes(ware.tval)));
  return {
    kind: "armour",
    label: "armour for empty slots",
    detail: `Nothing is worn on the ${empty.map((slot) => slot.name).join(", ")}. ${source.how === "try" ? "Armour for it is in the pack." : source.how === "save" ? `I remember a piece at ${String(source.price)} gold.` : "I have no shop memory of any, so look for some in the dungeon."}`,
    ...source,
    depth: null,
  };
}

function weaponAim(shelf: Shelves, packItems: readonly ItemView[], worn: readonly ItemView[]): Aim | null {
  const special = (item: ItemView): boolean => {
    const name = shownName(item);
    return name !== null && WEAPONS.includes(item.tval) && mightBeSpecial(name);
  };
  if (worn.some(special)) return null;
  if (packItems.some(special)) {
    return { kind: "weapon", label: "magic weapon", detail: "Try the unknown or magical weapon in the pack to see whether it beats the one wielded.", how: "try", price: null, depth: null };
  }
  const ware = cheapest(shelf.wares, (w) => WEAPONS.includes(w.tval) && mightBeSpecial(w.name));
  if (ware === null) return null;
  return { kind: "weapon", label: "magic weapon", detail: `Buy a magical or ego weapon: I remember ${ware.name} at ${String(ware.price)} gold.`, ...sourced(ware), depth: null };
}

function protectionAim(view: AgentView, kind: "free-action" | "see-invisible", pack: readonly string[]): Aim | null {
  const player = view.player();
  const flag = kind === "free-action" ? "FREE_ACT" : "SEE_INVIS";
  const from = kind === "free-action" ? FREE_ACTION_DEPTH : SEE_INVISIBLE_DEPTH;
  if (player.objectFlags.includes(flag)) return null;
  if (Math.max(player.depth, player.maxDepth) < from - PROTECTION_LEAD) return null;
  const words = kind === "free-action" ? "free action" : "see invisible";
  const carried = pack.some((name) => (kind === "free-action" ? /Free Action/i : /See Invisible|Seeing/i).test(name));
  return {
    kind,
    label: words,
    detail: `Get ${words} before dungeon level ${String(from)} (${String(from * 50)} ft), where ${kind === "free-action" ? "paralysis kills characters without it" : "invisible creatures strike unseen"}. ${carried ? "An item that may grant it is in the pack." : "Look for it in the dungeon."}`,
    how: carried ? "try" : "hunt",
    price: null,
    depth: null,
  };
}

/** The win as an aim: its next step on the road to Morgoth, held by every character. */
export function winAim(maxDepth: number): Aim {
  const step = winStep(maxDepth);
  return {
    kind: "win",
    label: "win the game",
    detail: `Defeat Sauron on dungeon level 99 and then Morgoth on dungeon level 100. The next step is to ${step.text}.`,
    how: "dive",
    price: null,
    depth: step.depth,
  };
}

/** The aims that apply to the character now, in the fixed order. The persona sets the pace of the depth target. */
export function candidateAims(view: AgentView, memories: readonly StoreMemory[] = [], persona: Persona | null = null): Aim[] {
  const player = view.player();
  const shelf = shelves(view, memories);
  const packItems = view.inventory();
  const pack = namesOf(packItems);
  const worn = view.equipment().flatMap((item) => (item === null ? [] : [item]));
  const target = Math.max(1, Math.round(depthTarget(player.level, player.maxHp) * paceFactor(persona)));
  const next = Math.max(2, player.depth + 1, player.depth === 0 ? player.maxDepth : 0);
  const missing = missingPreparation(view, next);
  const preparation: Aim | null = missing.length === 0 ? null : {
    kind: "preparation",
    label: "prepare for descent",
    detail: `Before dungeon level ${String(next)}, acquire ${missing.map((requirement) => requirement.reason).join(", ")}. Buy named supplies in town, find the required protections, and gain experience on a prepared shallower level for the missing level or hit points.`,
    how: "hunt",
    price: null,
    depth: next,
  };
  const depth: Aim = {
    kind: "depth",
    label: "depth target",
    detail: `Reach dungeon level ${String(target)} (${String(target * 50)} ft), which suits a level ${String(player.level)} character with ${String(player.maxHp)} hit points.`,
    how: "dive",
    price: null,
    depth: target,
  };
  const found: (Aim | null)[] = [
    bookAim(view, shelf, pack),
    lanternAim(shelf, pack, worn),
    armourAim(view, shelf, packItems, worn),
    weaponAim(shelf, packItems, worn),
    protectionAim(view, "free-action", pack),
    protectionAim(view, "see-invisible", pack),
    preparation,
    depth,
    winAim(player.maxDepth),
  ];
  return found.filter((aim): aim is Aim => aim !== null);
}

/** Sort aims into the fixed order. */
export function inFixedOrder(aims: readonly Aim[]): Aim[] {
  const worth = (aim: Aim): number => (FIXED_ORDER.length - FIXED_ORDER.indexOf(aim.kind)) * (aim.stock?.confidence ?? 1);
  return [...aims].sort((a, b) => worth(b) - worth(a) || FIXED_ORDER.indexOf(a.kind) - FIXED_ORDER.indexOf(b.kind));
}

/** Whether the character wields a weapon that may be magical, which is what the weapon aim asks for. */
export function wieldsMagicWeapon(view: AgentView): boolean {
  return view.equipment().some((item) => {
    if (item === null || !WEAPONS.includes(item.tval)) return false;
    const name = shownName(item);
    return name !== null && mightBeSpecial(name);
  });
}

/** Whether the gold on hand covers an aim's price. */
export function affordable(aim: Aim, gold: number): boolean {
  return aim.price !== null && gold >= aim.price;
}
