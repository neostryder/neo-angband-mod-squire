/** A missing basket can fund a short shallow trip only after local buying is exhausted. */

import type { AgentView, StoreView } from "@rpgm-tools/neo-angband-core";
import { readPack } from "../brain/pack.js";
import type { Persona } from "../persona/persona.js";
import type { Terrain } from "../terrain.js";
import { missingEssentials, supplies } from "../strategy/readiness.js";
import { matchesSupplyName, supplyNeeds, type SupplyNeed } from "./needs.js";
import { shopEntrances } from "./plan.js";
import { storesFor } from "./shop.js";

export const EARNING_TURNS = 1000;
export const EARNING_LEASH = 6;

/** Optional stock and gear wait until the whole survival basket is present. */
export function basketNeeds(view: AgentView, needs: readonly SupplyNeed[]): SupplyNeed[] {
  if (missingEssentials(view).length === 0) return [...needs];
  const stock = supplies(view);
  return needs.filter((need) => ["healing", "phase", "food", "light"].includes(need.kind)).map((need) => ({
    ...need,
    have: need.kind === "healing" ? stock.cures : need.kind === "phase" ? stock.phase : need.have,
    want: 2,
  }));
}

export function createDeparture() {
  const shelves = new Map<number, StoreView>();
  let previousDepth = -1;
  let lastTurn = -1;
  let earning: { turn: number; gold: number; target: number | null } | null = null;
  let failedAtGold: number | null = null;

  function observe(view: AgentView, terrain: Terrain): void {
    const player = view.player();
    if (view.turn() < lastTurn) {
      shelves.clear();
      earning = null;
      failedAtGold = null;
      previousDepth = -1;
    }
    lastTurn = view.turn();
    if (player.depth === 0 && previousDepth > 0) {
      if (earning !== null && player.gold <= earning.gold) failedAtGold = player.gold;
      earning = null;
      shelves.clear();
    }
    /* The trip's clock starts on level 1. A descent begun in town can be
     * interrupted by townspeople for hundreds of turns, and the soak's Priest
     * arrived with the trip already over and climbed straight back up. */
    if (player.depth > 0 && previousDepth === 0 && earning !== null) earning = { ...earning, turn: view.turn() };
    previousDepth = player.depth;
    const cell = view.cell(player.grid.x, player.grid.y);
    if (player.depth !== 0 || cell === null || !terrain.isShopEntrance(cell.feat)) return;
    try {
      const store = view.stores().find((entry) => entry.feat === cell.feat);
      if (store !== undefined) shelves.set(cell.feat, { ...store, featName: terrain.shopName(cell.feat) ?? store.featName });
    } catch {
      /* A failed stock read cannot establish that an essential is sold out. */
    }
  }

  function status(view: AgentView, terrain: Terrain, persona: Persona | null, visited: ReadonlySet<number>) {
    observe(view, terrain);
    const player = view.player();
    const missing = missingEssentials(view);
    if (missing.length === 0) return { ready: true, earning: false, reason: "", target: null };
    const needs = basketNeeds(view, supplyNeeds(view, readPack(view), persona)).filter((need) => need.have < need.want);
    const shops = shopEntrances(view, terrain);
    const unknown = player.gold > 0 && shops.some((shop) => !visited.has(shop.feat) && needs.some((need) => storesFor(need.kind).includes(shop.name)));
    let total = 0;
    let priced = true;
    let affordable = false;
    for (const need of needs) {
      const prices = [...shelves.values()].filter((store) => storesFor(need.kind).includes(store.featName)).flatMap((store) => store.stock.filter((item) => item.number > 0 && item.price !== undefined && item.price > 0 && matchesSupplyName((item as { name?: string }).name ?? "", need.name)).map((item) => item.price!));
      const price = prices.length === 0 ? null : Math.min(...prices);
      if (price === null) priced = false;
      else {
        total += price * (need.want - need.have);
        if (price <= player.gold) affordable = true;
      }
    }
    const stock = supplies(view);
    const canEarn = !unknown && !affordable && player.hp === player.maxHp && player.status.poisoned === 0 && player.status.cut === 0 && player.status.blind === 0 && player.status.confused === 0 && stock.food >= 1 && (stock.lastingLight || stock.workingLight && stock.fuel >= 1) && (failedAtGold === null || player.gold > failedAtGold);
    return { ready: false, earning: canEarn, reason: missing.map((requirement) => requirement.reason).join(", "), target: priced ? total : null };
  }

  return {
    status,
    begin(view: AgentView, target: number | null): void {
      /* A goal already met would end the trip on arrival; the soak's Rogue, with
       * 2 gold, climbed straight back 161 times. The turn limit still ends it. */
      earning = { turn: view.turn(), gold: view.player().gold, target: target !== null && target > view.player().gold ? target : null };
    },
    active: () => earning !== null,
    finished(view: AgentView): boolean {
      return earning !== null && (view.player().depth > 1 || view.turn() - earning.turn >= EARNING_TURNS || earning.target !== null && view.player().gold >= earning.target);
    },
    observe,
  };
}
