/**
 * Floor loot: whether an object lying on remembered ground is worth walking to,
 * which carried object is junk, and whether the pack is full.
 *
 * Newer views report the player's own floor memory with knownFloorItems: an
 * item in sight with the description the look command gives, an item out of
 * sight as it was last seen, and nothing for an item dropped out of sight.
 * inspectKnownFloorItem reads the same item's description while it is in sight.
 * Older views have floorItems and inspectItem instead, and Squire reads those as
 * it always has. With none of them, nothing here offers and Squire keeps its
 * older habit of picking up only what it already stands on.
 */

import type { AgentView, ItemView } from "@rpgm-tools/neo-angband-core";
import type { Loc } from "../grid.js";
import { steps } from "../grid.js";
import { flowFrom } from "../flow.js";
import { isRoutable, knownCount } from "../map.js";
import type { Terrain } from "../terrain.js";
import { TV } from "../gear/compare.js";
import { shownName } from "../town/needs.js";
import { mightBeSpecial } from "../town/shop.js";
import type { Persona } from "../persona/persona.js";
import { lookReach } from "../persona/quirks.js";
import { inspecting } from "./threat-model.js";

/** An opaque reference to one floor memory, valid for the view that returned it. */
export interface KnownFloorRef {
  readonly id: number;
}

/** What the player knows of one remembered item, without its kind when the flavour is unknown. */
export type KnownFloorDetails = Pick<ItemView,
  "tval" | "pval" | "number" | "weight" | "ac" | "toA" | "toH" | "toD" |
  "dd" | "ds" | "flags" | "modifiers" | "brands" | "slays" | "resists" |
  "curses" | "egoName" | "artifactName" | "inscription"
> & { readonly name: string };

/** One entry of the player's floor memory, as newer engines report it. */
export type KnownFloorEntry = {
  readonly ref: KnownFloorRef;
  readonly grid: { readonly x: number; readonly y: number };
  readonly visibility: "seen" | "remembered";
} & (
  | { readonly sensed: true; readonly money: boolean; readonly item: null }
  | { readonly sensed: false; readonly item: KnownFloorDetails }
);

/** A second look at one remembered item. */
export type KnownFloorLook =
  | { readonly status: "seen"; readonly inspection: { readonly text: string } }
  | { readonly status: "stale" | "sensed" | "unavailable"; readonly inspection: null };

/** The floor memory reads, absent from engine 1.8.0's types and from older views. */
export interface KnownFloorReads {
  knownFloorItems?(x: number, y: number): KnownFloorEntry[];
  inspectKnownFloorItem?(ref: KnownFloorRef): KnownFloorLook;
}

function knowing(view: AgentView): AgentView & KnownFloorReads {
  return view as AgentView & KnownFloorReads;
}

/** TV_GOLD, as Angband 4.2 numbers it. */
const TV_GOLD = 1;
/** The flavoured tvals compare.ts does not number, as Angband 4.2 numbers them. */
const TV_MAGIC = { STAFF: 22, WAND: 23, ROD: 24, SCROLL: 25, POTION: 26, MUSHROOM: 29 } as const;
/** Flavoured kinds, whose description names only the flavour until the kind is learned. */
const FLAVOURED: readonly number[] = [TV.AMULET, TV.RING, ...Object.values(TV_MAGIC)];
/** An object worth at least this much is loot rather than junk. */
export const LOOT_VALUE = 10;
/** The carried pack holds this many lines; past it the game refuses a pickup. */
export const PACK_LIMIT = 23;

/** The tvals of plain gear, which is never junk. */
const GEAR: readonly number[] = [
  TV.SHOT, TV.ARROW, TV.BOLT, TV.BOW, TV.DIGGING, TV.HAFTED, TV.POLEARM, TV.SWORD,
  TV.BOOTS, TV.GLOVES, TV.HELM, TV.CROWN, TV.SHIELD, TV.CLOAK, TV.SOFT_ARMOR,
  TV.HARD_ARMOR, TV.DRAG_ARMOR, TV.LIGHT, TV.AMULET, TV.RING,
];

/** Names of objects a character may want to carry. */
const USEFUL: readonly RegExp[] = [
  /\bPotion\b/i, /\bScroll\b/i, /\bStaff\b/i, /\bRod\b/i, /\bWand\b/i,
  /\bFlask of Oil\b/i, /\bRations? of Food\b/i, /\bFood\b/i,
  /\bTorch(?:es)?\b/i, /\bLantern\b/i, /\bBook\b/i,
];

/** One worthwhile object on the floor, with why it is wanted. */
export interface FloorTarget {
  readonly at: Loc;
  readonly name: string;
  /** Steps from the character. */
  readonly away: number;
  readonly gold: boolean;
  readonly sellable: boolean;
  readonly useful: boolean;
  readonly value: number | null;
  /** Found in the player's floor memory, which a closer look can contradict. Absent on older views. */
  readonly known?: boolean;
  /** Squire walks over to look rather than to fetch: the flavour is unknown, or the item was only sensed. */
  readonly look?: boolean;
  /** Only sensed, so neither its kind nor its stack size is known. */
  readonly sensed?: boolean;
}

/** What one floor object is worth to this character, from what the player knows of it. */
interface Verdict {
  readonly gold: boolean;
  readonly sellable: boolean;
  readonly useful: boolean;
  readonly value: number | null;
  readonly name: string;
  /** The description does not say what the item is. */
  readonly unknown: boolean;
  /** Sensed as money. */
  readonly money: boolean;
  readonly sensed: boolean;
}

/** A price in an item's description. */
function valueIn(text: string): number | null {
  const match = /(\d+)\s+gold/i.exec(text) ?? /value[:\s]+(\d+)/i.exec(text);
  return match === null ? null : Number(match[1]);
}

/** The object's player-known worth, from the item view or its inspection text. */
function itemValue(view: AgentView, at: Loc, item: ItemView): number | null {
  if (typeof item.value === "number") return item.value;
  /* floorIndex and inspectItem are absent from engine 1.8.0's types. */
  const index = (item as ItemView & { readonly floorIndex?: number }).floorIndex;
  const v = inspecting(view);
  if (v.inspectItem === undefined || index === undefined) return null;
  const info = v.inspectItem({ floor: { x: at.x, y: at.y, index } });
  if (info === null) return null;
  return valueIn(info.text);
}

/**
 * Whether the description names only the flavour, as the game describes a kind
 * the player has not learned: "a Bubbling Potion", 'a Scroll titled "abra"'.
 */
export function unknownFlavour(tval: number, name: string): boolean {
  if (!FLAVOURED.includes(tval)) return false;
  return tval === TV_MAGIC.SCROLL ? /\btitled\b/i.test(name) : !/\bof\b/i.test(name);
}

/**
 * What one floor object from the live floor list is worth. `strict` reads an
 * unknown flavour as unknown; without it the judgement is the older one, which
 * took a flavour's "Potion" as a useful potion.
 */
function judge(view: AgentView, at: Loc, item: ItemView, strict = false): Verdict {
  const name = shownName(item) ?? item.label;
  const unknown = strict && unknownFlavour(item.tval, name);
  const value = unknown ? null : itemValue(view, at, item);
  const gold = item.tval === TV_GOLD;
  const useful = !unknown && USEFUL.some((pattern) => pattern.test(name));
  /* A consumable's "of ..." is its kind, not an ego suffix, so only gear counts
   * as loot a shop would pay well for. */
  const sellable = !unknown && !useful && (mightBeSpecial(name) || (value !== null && value >= LOOT_VALUE));
  return { gold, sellable, useful, value, name, unknown, money: false, sensed: false };
}

/**
 * What one remembered floor item is worth, from its known details only, or null
 * when the item is in sight and a second look cannot find it.
 */
function judgeKnown(view: AgentView & KnownFloorReads, entry: KnownFloorEntry): Verdict | null {
  const look = entry.visibility === "seen" ? view.inspectKnownFloorItem?.(entry.ref) : undefined;
  if (look?.status === "stale") return null;
  if (entry.sensed) {
    return { gold: false, sellable: false, useful: false, value: null, name: entry.money ? "unseen treasure" : "an unseen object", unknown: true, money: entry.money, sensed: true };
  }
  const name = entry.item.name;
  const unknown = unknownFlavour(entry.item.tval, name);
  const value = unknown || look?.status !== "seen" ? null : valueIn(look.inspection.text);
  const gold = entry.item.tval === TV_GOLD;
  const useful = !unknown && USEFUL.some((pattern) => pattern.test(name));
  const sellable = !unknown && !useful && (mightBeSpecial(name) || (value !== null && value >= LOOT_VALUE));
  return { gold, sellable, useful, value, name, unknown, money: false, sensed: false };
}

function wanted(verdict: Verdict, saving: boolean): boolean {
  return verdict.gold || verdict.sellable || (!saving && verdict.useful);
}

/** Whether the persona walks over to look at an item it cannot judge, this many steps away. */
function looksAt(verdict: Verdict, saving: boolean, persona: Persona | null, away: number): boolean {
  return verdict.unknown && (!saving || verdict.money) && away <= lookReach(persona, verdict.money);
}

/**
 * The nearest worthwhile object on remembered, reachable ground, or null.
 *
 * While the character is saving for an aim, only gold and loot that sells well
 * count: a spare potion is not worth the detour when the gold is what buys the
 * aim.
 *
 * On a view with floor memory, an item the player cannot judge from afar (an
 * unknown flavour, or something only sensed) has no value. Whether Squire walks
 * over to look at it is the persona's call, through lookReach.
 */
export function floorTarget(view: AgentView, terrain: Terrain, saving: boolean, persona: Persona | null = null): FloorTarget | null {
  const player = view.player();
  const at = player.grid;
  const bounds = view.mapBounds();
  const routable = (grid: Loc): boolean => isRoutable(view, terrain, grid);
  const field = flowFrom({ goals: [at], canEnter: routable });
  const memory = knowing(view);
  const remembered = typeof memory.knownFloorItems === "function";
  let best: FloorTarget | null = null;
  for (let y = 0; y < bounds.height; y++) {
    for (let x = 0; x < bounds.width; x++) {
      const cell = view.cell(x, y);
      if (cell === null || !cell.known || knownCount(cell) === 0) continue;
      const here: Loc = { x, y };
      if (here.x === at.x && here.y === at.y) continue;
      if (!Number.isFinite(field.distance(here))) continue;
      const verdicts = remembered
        ? (memory.knownFloorItems?.(x, y) ?? []).map((entry) => judgeKnown(memory, entry)).filter((verdict): verdict is Verdict => verdict !== null)
        : view.floorItems(x, y).map((item) => judge(view, here, item));
      const away = steps(at, here);
      for (const verdict of verdicts) {
        const fetch = wanted(verdict, saving);
        const look = !fetch && remembered && looksAt(verdict, saving, persona, away);
        if (!fetch && !look) continue;
        if (best === null || away < best.away) best = {
          at: here, name: verdict.name, away, gold: verdict.gold, sellable: verdict.sellable, useful: verdict.useful, value: verdict.value,
          ...(remembered ? { known: true, look, sensed: verdict.sensed } : {}),
        };
      }
    }
  }
  return best;
}

/**
 * Look again at a target on the way to it, before picking it up. Standing on
 * it, the character sees the pile itself, as a player about to pick up does.
 * With the grid in sight, the floor memory is up to date and the item can be
 * inspected. Out of sight, the memory stands. False means the item is gone or,
 * seen closer, is not worth taking after all.
 */
export function stillWorthIt(view: AgentView, loot: FloorTarget, saving: boolean, persona: Persona | null): boolean {
  if (loot.known !== true) return true;
  const keep = (verdict: Verdict): boolean => wanted(verdict, saving) || looksAt(verdict, saving, persona, 1);
  const here = view.player().grid;
  if (here.x === loot.at.x && here.y === loot.at.y) {
    return view.floorItems(here.x, here.y).some((item) => keep(judge(view, here, item, true)));
  }
  const memory = knowing(view);
  const entries = memory.knownFloorItems?.(loot.at.x, loot.at.y) ?? [];
  const same = loot.sensed === true ? entries : entries.filter((entry) => !entry.sensed && entry.item.name === loot.name);
  return same.some((entry) => {
    const verdict = judgeKnown(memory, entry);
    return verdict !== null && (entry.visibility === "remembered" || keep(verdict));
  });
}

/** Whether the pack holds as many lines as the game accepts. */
export function packFull(view: AgentView): boolean {
  return view.inventory().length >= PACK_LIMIT;
}

/** A carried object with no use and no sale value, to drop when the pack is full. */
export function junkInPack(view: AgentView): { readonly handle: number; readonly name: string } | null {
  for (const item of view.inventory()) {
    const name = shownName(item);
    if (name === null) continue;
    if (item.tval === TV_GOLD || GEAR.includes(item.tval)) continue;
    if (USEFUL.some((pattern) => pattern.test(name)) || mightBeSpecial(name)) continue;
    return { handle: item.handle, name };
  }
  return null;
}
