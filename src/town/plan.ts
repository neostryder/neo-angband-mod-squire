/** Town errands walk remembered streets and inspect stock only while inside. */

import type { AgentView, ItemView } from "@rpgm-tools/neo-angband-core";
import type { Plan } from "../brain/brain.js";
import { readPack } from "../brain/pack.js";
import type { Loc } from "../grid.js";
import { newProgress } from "../progress.js";
import { defaultCfg } from "../settings.js";
import type { Terrain } from "../terrain.js";
import { travelTo } from "../travel.js";
import type { Persona } from "../persona/persona.js";
import { supplyNeeds } from "./needs.js";
import { saleFits, sellList, shoppingList, storesFor } from "./shop.js";

export interface ShopEntrance extends Loc {
  readonly feat: number;
  readonly name: string;
}

/** Only remembered shop grids can be planned toward. */
export function shopEntrances(view: AgentView, terrain: Terrain): ShopEntrance[] {
  const bounds = view.mapBounds();
  const found: ShopEntrance[] = [];
  for (let y = 0; y < bounds.height; y++) {
    for (let x = 0; x < bounds.width; x++) {
      const cell = view.cell(x, y);
      if (cell === null || !cell.known || !terrain.isShopEntrance(cell.feat)) continue;
      const name = terrain.shopName(cell.feat);
      if (name !== null) found.push({ x, y, feat: cell.feat, name });
    }
  }
  return found;
}

/** Visible needs and mapped entrances determine where to walk, without stores(). */
export function neededEntrances(view: AgentView, terrain: Terrain, persona: Persona | null, visited: ReadonlySet<number> = new Set()): ShopEntrance[] {
  if (view.player().depth !== 0) return [];
  const pack = readPack(view);
  const needs = supplyNeeds(view, pack, persona);
  const sales = sellList(pack, view, persona);
  return shopEntrances(view, terrain).filter((entrance) => {
    if (visited.has(entrance.feat)) return false;
    const buying = view.player().gold > 0 && needs.some((need) => need.have < need.want && storesFor(need.kind).includes(entrance.name));
    return buying || sales.some((sale) => saleFits(sale.name, entrance.name));
  }).sort((a, b) => {
    const rank = (shop: ShopEntrance): number => shop.name === "Alchemy Shop" ? 0 : shop.name === "General Store" ? 1 : 2;
    return rank(a) - rank(b);
  });
}

/** Re-read the entered shop after each command; buying can move its stock slots. */
export function townTripPlan(terrain: Terrain, persona: Persona | null, visited: Set<number> = new Set(), log: (line: string) => void = () => {}): Plan {
  const progress = newProgress(0);
  return {
    label: "shop for supplies",
    step(view, act) {
      if (view.player().depth !== 0) return null;
      const at = view.player().grid;
      const cell = view.cell(at.x, at.y);
      if (cell !== null && terrain.isShopEntrance(cell.feat) && !visited.has(cell.feat)) {
        /* stores() exposes the whole town; touch only the matching store's stock. */
        const found = view.stores().find((entry) => entry.feat === cell.feat);
        /* The engine names a store by its terrain code (STORE_ALCHEMY); the
         * shopping rules use the name terrain.txt shows the player. */
        const store = found === undefined ? undefined : { ...found, featName: terrain.shopName(cell.feat) ?? found.featName };
        if (store === undefined) {
          visited.add(cell.feat);
          log("shop: this store has no stock to read");
          return act.shopExit();
        }
        const pack = readPack(view);
        const sale = sellList(pack, view, persona).find((item) => saleFits(item.name, store.featName));
        if (sale !== undefined) {
          log(`shop: selling ${sale.name} in the ${store.featName}`);
          return act.shopSell(sale.handle, sale.quantity);
        }
        const purchase = shoppingList(supplyNeeds(view, pack, persona), store, view.player().gold, persona)[0];
        if (purchase !== undefined) {
          log(`shop: buying ${String(purchase.quantity)} from "${purchase.name}" in the ${store.featName}`);
          return act.shopBuy(purchase.index, purchase.quantity);
        }
        visited.add(cell.feat);
        log(`shop: done in the ${store.featName}`);
        return act.shopExit();
      }
      const next = neededEntrances(view, terrain, persona, visited)[0];
      if (next === undefined) {
        log("shop: no shop left with anything needed");
        return null;
      }
      const travel = travelTo({ view, act, terrain, cfg: defaultCfg(), progress, log: () => {} }, [next]);
      if (travel.kind === "step") return travel.command;
      /* A townsperson in the way is gone in a turn or two, so only a shop that
       * cannot be reached at all is crossed off for this visit. */
      if (travel.kind === "unreachable") visited.add(next.feat);
      log(`shop: the ${next.name} is ${travel.kind === "unreachable" ? "out of reach" : "blocked for now"}`);
      return null;
    },
  };
}

/** Recall is one read; the level change is handled by the game's own timer. */
export function recallPlan(item: ItemView): Plan {
  let read = false;
  return {
    label: "read Word of Recall",
    step(_view, act) {
      if (read) return null;
      read = true;
      return act.read(item.handle);
    },
  };
}
