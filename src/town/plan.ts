/** Town errands walk remembered streets and inspect stock only while inside. */

import type { AgentView, ItemView } from "@rpgm-tools/neo-angband-core";
import type { Plan } from "../brain/brain.js";
import { readPack } from "../brain/pack.js";
import { PACK_LIMIT } from "../brain/items.js";
import type { Loc } from "../grid.js";
import { newProgress } from "../progress.js";
import { defaultCfg } from "../settings.js";
import type { Terrain } from "../terrain.js";
import { travelTo } from "../travel.js";
import type { Persona } from "../persona/persona.js";
import { affordable, type Aim } from "../strategy/aims.js";
import { missingEssentials } from "../strategy/readiness.js";
import { aimPurchase, aimStores, unaimedUpgradePurchase } from "./aims-shop.js";
import { supplyNeeds } from "./needs.js";
import { basketNeeds } from "./departure.js";
import { homeSpares, homeWithdrawal, saleFits, sellList, shoppingList, storesFor } from "./shop.js";
import { emptyFlourishes, trophyHandles, type Flourishes } from "../learning/family-ways.js";
import { stockConfidence, type StoreMemory } from "./memory.js";
import { createHomeMemory, type HomeStock } from "./home.js";
import type { Steering } from "../strategy/steer.js";
import type { PurchaseKind } from "../strategy/judgment.js";

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
      /* The home has the SHOP flag but its name comes from the engine, not
       * terrain.txt; an unknown terrain returns null here, so fall back to the
       * generic "Home" name and let the stock view's isHome be the truth. */
      if (name === null && cell.feat !== 0 && !found.some((entry) => entry.feat === cell.feat)) found.push({ x, y, feat: cell.feat, name: "Home" });
      else if (name !== null) found.push({ x, y, feat: cell.feat, name });
    }
  }
  return found;
}

/** Visible needs, affordable aims and mapped entrances determine where to walk, without stores(). */
export function neededEntrances(view: AgentView, terrain: Terrain, persona: Persona | null, visited: ReadonlySet<number> = new Set(), aims: readonly Aim[] = [], flourishes: Flourishes = emptyFlourishes(), memories?: readonly StoreMemory[], home?: HomeStock): ShopEntrance[] {
  if (view.player().depth !== 0) return [];
  const pack = readPack(view);
  const needs = basketNeeds(view, supplyNeeds(view, pack, persona, flourishes.darkLesson), persona);
  const sales = sellList(pack, view, persona, trophyHandles(flourishes, view, persona), flourishes.darkLesson);
  const gold = view.player().gold;
  return shopEntrances(view, terrain).filter((entrance) => {
    if (visited.has(entrance.feat)) return false;
    if (entrance.name === "Home") {
      /* The home is the first stop when it can fill a basket need, when the
       * pack can shed a spare, or when it has never been seen and must be
       * learned. */
      if (home === undefined) return false;
      const covers = homeWithdrawal(home, needs).length > 0;
      const spares = homeSpares(view, persona, flourishes.darkLesson).length > 0;
      return covers || spares || !home.entered;
    }
    const buying = gold > 0 && needs.some((need) => need.have < need.want && storesFor(need.kind).includes(entrance.name));
    const aiming = aims.some((aim) => (affordable(aim, gold) || gold > 0 && aim.how === "hunt" && (aim.kind === "free-action" || aim.kind === "see-invisible")) && (aim.stock === undefined ? aimStores(aim).includes(entrance.name) : aim.stock.feat === entrance.feat));
    const exploring = memories !== undefined && !memories.some((memory) => memory.feat === entrance.feat && stockConfidence(memory, view.turn()) > 0);
    return buying || aiming || exploring || sales.some((sale) => saleFits(sale.tval, entrance.name));
  }).sort((a, b) => {
    const rank = (shop: ShopEntrance): number => shop.name === "Home" ? -1 : shop.name === "Alchemy Shop" ? 0 : shop.name === "General Store" ? 1 : 2;
    return rank(a) - rank(b);
  });
}

/** Turns a town trip waits for a creature to clear the only way to a shop before skipping that shop for the visit. */
const BLOCKED_WAIT_TURNS = 5;

/** Re-read the entered shop after each command; buying can move its stock slots. */
export function townTripPlan(terrain: Terrain, persona: Persona | null, visited: Set<number> = new Set(), log: (line: string) => void = () => {}, aims: readonly Aim[] = [], flourishes: () => Flourishes = emptyFlourishes, strategy?: () => Steering, purchaseOrder?: () => readonly PurchaseKind[] | null, home?: HomeStock, saveHome?: (stock: HomeStock) => void): Plan {
  const progress = newProgress(0);
  /* An aim is bought for once per trip: its list was ranked before the trip,
   * so after one purchase it would still ask for more of the same. */
  const boughtFor = new Set<string>();
  let leftShopForSupplies = false;
  const homeMemory = createHomeMemory(home, saveHome);
  /* A sale the engine refuses leaves the pack unchanged, so a handle already
   * offered at a store is not offered there again on this trip. */
  const offeredSales = new Map<number, Set<number>>();
  /* Home wares taken and stacks left this trip, each tried once. */
  const homeTried = new Set<string>();
  /* Turns spent waiting for a creature to clear the way to one shop. */
  const waited = new Map<number, number>();
  return {
    label: "shop for supplies",
    step(view, act) {
      if (view.player().depth !== 0) return null;
      const at = view.player().grid;
      const cell = view.cell(at.x, at.y);
      const current = strategy?.();
      const currentAims = current?.aims ?? aims;
      const homeNow = homeMemory.current();
      const first = neededEntrances(view, terrain, persona, visited, currentAims, flourishes(), current?.storeMemory, homeNow)[0];
      const alchemyFirst = first?.name === "Alchemy Shop" && first.feat !== cell?.feat;
      if (alchemyFirst && cell !== null && terrain.isShopEntrance(cell.feat) && !leftShopForSupplies) {
        leftShopForSupplies = true;
        return act.shopExit();
      }
      if (!alchemyFirst) leftShopForSupplies = false;
      if (!alchemyFirst && cell !== null && terrain.isShopEntrance(cell.feat) && !visited.has(cell.feat)) {
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
        /* The home is visited before the first supply shop so a remembered
         * stack can fill the pack without costing gold, and after the loop so
         * the surplus from a deep pack can ride home. */
        if (store.isHome) {
          homeMemory.observe(view);
          const stock = homeMemory.current();
          const needs = basketNeeds(view, supplyNeeds(view, readPack(view), persona, flourishes().darkLesson), persona);
          const withdrawal = homeWithdrawal(stock, needs);
          /* Each ware is tried once per trip, so a full pack or a home that
           * refuses cannot hold the character here. */
          const ware = store.stock.find((entry) => !homeTried.has(`take:${entry.name}`) && withdrawal.some((w) => shownMatch(entry, w.name)));
          if (ware !== undefined) {
            const want = withdrawal.find((w) => shownMatch(ware, w.name))?.quantity ?? 1;
            homeTried.add(`take:${ware.name}`);
            log(`home: taking ${String(want)} "${ware.name}" from the home before the shops`);
            return act.shopBuy(ware.index, want);
          }
          /* Either the pack is near full or the spare sits beyond what the
           * basket asks for, so a remembered stack rides home before shops. */
          const packFull = view.inventory().length >= PACK_LIMIT - 1;
          const spares = homeSpares(view, persona, flourishes().darkLesson);
          const spare = spares.find((entry) => !homeTried.has(`leave:${String(entry.handle)}`));
          if (spare !== undefined) {
            homeTried.add(`leave:${String(spare.handle)}`);
            log(`home: storing ${spare.name} at home to ${packFull ? "make room" : "shed excess"}`);
            return act.shopSell(spare.handle, spare.quantity);
          }
          visited.add(cell.feat);
          log("home: nothing to take or leave");
          return act.shopExit();
        }
        const pack = readPack(view);
        const offered = offeredSales.get(cell.feat) ?? new Set<number>();
        const sale = sellList(pack, view, persona, trophyHandles(flourishes(), view, persona), flourishes().darkLesson).find((item) => saleFits(item.tval, store.featName) && !offered.has(item.handle));
        if (sale !== undefined) {
          offered.add(sale.handle);
          offeredSales.set(cell.feat, offered);
          log(`shop: selling ${sale.name} in the ${store.featName}`);
          return act.shopSell(sale.handle, sale.quantity);
        }
        const order = purchaseOrder?.() ?? null;
        const purchase = shoppingList(basketNeeds(view, supplyNeeds(view, pack, persona, flourishes().darkLesson), persona), store, view.player().gold, persona, order)[0];
        /* With the supplies settled, the gold on hand can fund the top aim, unless the persona chose to keep it. */
        const saving = order !== null && order.includes("save") && order.indexOf("save") < (order.includes("gear") ? order.indexOf("gear") : order.length);
        const aimed = missingEssentials(view, persona).length > 0 || saving ? null : aimPurchase(currentAims.filter((aim) => !boughtFor.has(aim.label)), store, view.player().gold, view);
        const gearFirst = aimed !== null && order !== null && purchase !== undefined && order.includes("gear") && order.indexOf("gear") < (order.includes(purchase.kind) ? order.indexOf(purchase.kind) : order.length);
        if (purchase !== undefined && !gearFirst) {
          log(`shop: buying ${String(purchase.quantity)} from "${purchase.name}" in the ${store.featName}`);
          return act.shopBuy(purchase.index, purchase.quantity);
        }
        if (aimed !== null) {
          boughtFor.add(aimed.aim);
          log(`shop: buying ${aimed.name} in the ${store.featName} for the aim: ${aimed.aim}`);
          return act.shopBuy(aimed.index, aimed.quantity);
        }
        /* An aim that no aim requested: the gear comparison still knows what is
         * a clear swap, and the gold on hand can fund it, unless the persona
         * ranked saving the gold above gear for this visit. */
        if (!saving && missingEssentials(view, persona).length === 0) {
          const upgrade = unaimedUpgradePurchase(store, view.player().gold, view);
          if (upgrade !== null && !boughtFor.has(upgrade.aim)) {
            boughtFor.add(upgrade.aim);
            log(`shop: buying ${upgrade.name} in the ${store.featName} as a clear upgrade`);
            return act.shopBuy(upgrade.index, upgrade.quantity);
          }
        }
        visited.add(cell.feat);
        const shelf = store.stock.slice(0, 8).map((item) => `${(item as { name?: string }).name ?? "?"} at ${String(item.price ?? "?")}`).join("; ");
        log(`shop: done in the ${store.featName} with ${String(view.player().gold)} gold (${shelf})`);
        return act.shopExit();
      }
      const next = neededEntrances(view, terrain, persona, visited, currentAims, flourishes(), current?.storeMemory, homeMemory.current())[0];
      if (next === undefined) {
        log("shop: no shop left with anything needed");
        return null;
      }
      /* Walk around a townsperson where the streets allow it. */
      const occupied = (grid: { readonly x: number; readonly y: number }) => view.monsters().some((monster) => monster.visible && monster.grid.x === grid.x && monster.grid.y === grid.y);
      const travel = travelTo({ view, act, terrain, cfg: defaultCfg(), progress, log: () => {} }, [next], occupied);
      if (travel.kind === "step") {
        waited.delete(next.feat);
        return travel.command;
      }
      /* A townsperson in the only way through usually moves on within a few
       * turns, so the trip waits for it; one that stays, as Farmer Maggot can
       * when he follows the character, crosses that shop off for this visit. */
      if (travel.kind === "blocked") {
        const turns = (waited.get(next.feat) ?? 0) + 1;
        waited.set(next.feat, turns);
        if (turns <= BLOCKED_WAIT_TURNS) {
          log(`shop: the way to the ${next.name} is blocked; waiting a turn`);
          return act.hold();
        }
      }
      visited.add(next.feat);
      log(`shop: the ${next.name} is ${travel.kind === "unreachable" ? "out of reach" : "still blocked, so it is skipped this visit"}`);
      return null;
    },
  };
}

function shownMatch(item: { readonly name?: string | null }, wanted: string): boolean {
  return typeof item.name === "string" && item.name.toLowerCase().includes(wanted.toLowerCase());
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
