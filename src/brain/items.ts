/**
 * Floor loot: whether an object lying on remembered ground is worth walking to,
 * which carried object is junk, and whether the pack is full.
 *
 * The view reports the objects on a grid with floorItems, and inspectItem gives
 * the same object's player-facing description, which is where a price the item
 * view does not carry can be read. Both reads are optional on older views: with
 * neither, nothing here offers and Squire keeps its older habit of picking up
 * only what it already stands on.
 */

import type { AgentView, ItemView } from "@rpgm-tools/neo-angband-core";
import type { Loc } from "../grid.js";
import { steps } from "../grid.js";
import { flowFrom } from "../flow.js";
import { isRoutable } from "../map.js";
import type { Terrain } from "../terrain.js";
import { TV } from "../gear/compare.js";
import { shownName } from "../town/needs.js";
import { mightBeSpecial } from "../town/shop.js";
import { inspecting } from "./threat-model.js";

/** TV_GOLD, as Angband 4.2 numbers it. */
const TV_GOLD = 1;
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
  const match = /(\d+)\s+gold/i.exec(info.text) ?? /value[:\s]+(\d+)/i.exec(info.text);
  return match === null ? null : Number(match[1]);
}

/** What one floor object is worth to this character. */
function judge(view: AgentView, at: Loc, item: ItemView): { gold: boolean; sellable: boolean; useful: boolean; value: number | null; name: string } {
  const name = shownName(item) ?? item.label;
  const value = itemValue(view, at, item);
  const gold = item.tval === TV_GOLD;
  const useful = USEFUL.some((pattern) => pattern.test(name));
  /* A consumable's "of ..." is its kind, not an ego suffix, so only gear counts
   * as loot a shop would pay well for. */
  const sellable = !useful && (mightBeSpecial(name) || (value !== null && value >= LOOT_VALUE));
  return { gold, sellable, useful, value, name };
}

/**
 * The nearest worthwhile object on remembered, reachable ground, or null.
 *
 * While the character is saving for an aim, only gold and loot that sells well
 * count: a spare potion is not worth the detour when the gold is what buys the
 * aim.
 */
export function floorTarget(view: AgentView, terrain: Terrain, saving: boolean): FloorTarget | null {
  const player = view.player();
  const at = player.grid;
  const bounds = view.mapBounds();
  const routable = (grid: Loc): boolean => isRoutable(view, terrain, grid);
  const field = flowFrom({ goals: [at], canEnter: routable });
  let best: FloorTarget | null = null;
  for (let y = 0; y < bounds.height; y++) {
    for (let x = 0; x < bounds.width; x++) {
      const cell = view.cell(x, y);
      if (cell === null || !cell.known || cell.objectCount === 0) continue;
      const here: Loc = { x, y };
      if (here.x === at.x && here.y === at.y) continue;
      if (!Number.isFinite(field.distance(here))) continue;
      for (const item of view.floorItems(x, y)) {
        const verdict = judge(view, here, item);
        const wanted = verdict.gold || verdict.sellable || (!saving && verdict.useful);
        if (!wanted) continue;
        const away = steps(at, here);
        if (best === null || away < best.away) best = { at: here, name: verdict.name, away, gold: verdict.gold, sellable: verdict.sellable, useful: verdict.useful, value: verdict.value };
      }
    }
  }
  return best;
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
