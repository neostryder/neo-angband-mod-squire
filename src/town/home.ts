/**
 * What the home contains, remembered exactly after the character steps inside.
 *
 * The home is read like the other stores, except that its contents are private
 * to the character. Before the first entry, the home is unknown and no decision
 * can name an item there; after the first entry, the remembered ware list is
 * taken at face value and updated on each subsequent visit.
 */

import type { AgentView, ItemView } from "@rpgm-tools/neo-angband-core";
import { shownName } from "./needs.js";

export interface HomeWare {
  readonly name: string;
  readonly tval: number;
  readonly count: number;
}

export interface HomeStock {
  readonly entered: boolean;
  readonly turn: number;
  readonly wares: readonly HomeWare[];
}

function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function number(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

export const UNKNOWN_HOME: HomeStock = { entered: false, turn: 0, wares: [] };

export function readHomeStock(value: unknown): HomeStock {
  const raw = record(value);
  if (raw["entered"] !== true || !number(raw["turn"]) || !Array.isArray(raw["wares"])) return UNKNOWN_HOME;
  const wares = raw["wares"].flatMap((item): HomeWare[] => {
    const ware = record(item);
    return typeof ware["name"] === "string" && number(ware["tval"]) && number(ware["count"]) && ware["count"] > 0
      ? [{ name: ware["name"], tval: ware["tval"], count: ware["count"] }] : [];
  });
  return { entered: true, turn: raw["turn"], wares };
}

function liveHome(view: AgentView): HomeStock | null {
  const player = view.player();
  if (player.depth !== 0) return null;
  const cell = view.cell(player.grid.x, player.grid.y);
  if (cell === null) return null;
  let store;
  try {
    store = view.stores().find((entry) => entry.isHome);
  } catch {
    return null;
  }
  /* Like the other shops, the home is read only while the character stands on
   * its own entrance, so the whole town's stock is never taken from afar. */
  if (store === undefined || store.feat !== cell.feat) return null;
  return {
    entered: true,
    turn: view.turn(),
    wares: store.stock.flatMap((item) => {
      const name = shownName(item as ItemView);
      return name !== null && item.number > 0 ? [{ name, tval: item.tval, count: item.number }] : [];
    }),
  };
}

export function createHomeMemory(initial: HomeStock = UNKNOWN_HOME, save: (stock: HomeStock) => void = () => {}) {
  let stock = initial.entered ? initial : UNKNOWN_HOME;
  return {
    current: (): HomeStock => stock,
    observe(view: AgentView): boolean {
      const live = liveHome(view);
      if (live === null) return false;
      const same = stock.entered && live.turn === stock.turn && live.wares.length === stock.wares.length &&
        live.wares.every((ware, index) => ware.name === stock.wares[index]?.name && ware.count === stock.wares[index]?.count && ware.tval === stock.wares[index]?.tval);
      if (same) return false;
      stock = live;
      save(stock);
      return true;
    },
    reset(): void {
      stock = UNKNOWN_HOME;
      save(stock);
    },
  };
}
