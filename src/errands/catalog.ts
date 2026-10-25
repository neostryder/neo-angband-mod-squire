/**
 * The errand menu: eight errands in a fixed order, and whether each can start
 * from where the character stands.
 *
 * Every errand is always listed. One that cannot start now is shown with the
 * reason, so the menu reads the same from one moment to the next and a number
 * always means the same errand.
 */

import type { AgentView } from "@rpgm-tools/neo-angband-core";
import type { Terrain } from "../terrain.js";
import { cellAt, frontiers, hasFloorObject } from "../map.js";
import { floorTarget } from "../brain/items.js";
import { ERRAND_TEXT } from "./text.js";

export type ErrandId = "loot" | "town" | "down" | "up" | "leave" | "explore" | "clear" | "restock";

/** The menu order. A number on the menu is a position in this list, from 1. */
export const ERRAND_IDS: readonly ErrandId[] = ["loot", "town", "down", "up", "leave", "explore", "clear", "restock"];

export interface ErrandEntry {
  readonly id: ErrandId;
  /** Its menu position, from 1. */
  readonly position: number;
  readonly label: string;
  /** Null when it can start now; otherwise why not. */
  readonly reason: string | null;
}

export function isErrandId(value: unknown): value is ErrandId {
  return typeof value === "string" && (ERRAND_IDS as readonly string[]).includes(value);
}

/** Why this errand cannot start now, or null when it can. */
export function unavailable(id: ErrandId, view: AgentView, terrain: Terrain): string | null {
  const reasons = ERRAND_TEXT.reasons;
  const player = view.player();
  if (player.dead) return reasons.dead;
  const town = player.depth === 0;
  const under = cellAt(view, player.grid);
  switch (id) {
    case "loot":
      return hasFloorObject(view, player.grid) || floorTarget(view, terrain, false) !== null ? null : reasons.noLoot;
    case "town":
      return town ? reasons.inTown : null;
    case "down":
      return under !== null && terrain.isDownStair(under.feat) ? reasons.onDownStair : null;
    case "up":
      if (town) return reasons.noUpInTown;
      return under !== null && terrain.isUpStair(under.feat) ? reasons.onUpStair : null;
    case "leave":
      return null;
    case "explore":
      return frontiers(view, terrain).length > 0 ? null : reasons.explored;
    case "clear":
      return town ? reasons.townClear : null;
    case "restock":
      return town ? null : reasons.notInTown;
  }
}

/** The whole menu, in order, for the view as it stands. */
export function errandMenu(view: AgentView, terrain: Terrain): ErrandEntry[] {
  return ERRAND_IDS.map((id, index) => ({ id, position: index + 1, label: ERRAND_TEXT.labels[id], reason: unavailable(id, view, terrain) }));
}
