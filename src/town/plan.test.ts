import type { AgentView, StoreItemView, StoreView } from "@rpgm-tools/neo-angband-core";
import { describe, expect, it } from "vitest";
import { FEAT, itemNamed, world } from "../harness.js";
import { neededEntrances, townTripPlan } from "./plan.js";

describe("town trip", () => {
  it("does not read any stock before stepping inside the matching shop", () => {
    const stock = [{ ...itemNamed("a Scroll of Word of Recall", 0), index: 0, price: 35, number: 2 }] as StoreItemView[];
    /* The engine names stores by terrain code, as the live game does. */
    const store: StoreView = { feat: FEAT.ALCHEMY, featName: "STORE_ALCHEMY", isHome: false, owner: { name: "Mauser", purse: 10000 }, stock };
    const w = world({ map: ["#####", "#@.A#", "#####"], player: { depth: 0, maxDepth: 5, gold: 50 }, stores: [store] });
    let reads = 0;
    const view: AgentView = { ...w.view, stores: () => { reads += 1; return w.view.stores(); } };
    expect(neededEntrances(view, w.terrain, null).map((entry) => entry.name)).toEqual(["Alchemy Shop"]);
    const plan = townTripPlan(w.terrain, null);
    expect(plan.step(view, w.act)).toEqual({ code: "walk", dir: 6 });
    expect(reads).toBe(0);
    w.moveTo({ x: 3, y: 1 });
    expect(plan.step(view, w.act)).toEqual({ code: "shop-buy", args: { index: 0, quantity: 1 } });
    expect(reads).toBe(1);
    w.setPack(["a Scroll of Word of Recall"]);
    w.setPlayer({ gold: 15 });
    expect(plan.step(view, w.act)).toEqual({ code: "shop-exit" });
    expect(plan.step(view, w.act)).toBeNull();
  });

  it("leaves one shop and walks to the next needed entrance", () => {
    const stores: StoreView[] = [
      { feat: FEAT.ALCHEMY, featName: "Alchemy Shop", isHome: false, owner: { name: "Mauser", purse: 10000 }, stock: [] },
      { feat: FEAT.GENERAL, featName: "General Store", isHome: false, owner: { name: "Bilbo", purse: 5000 }, stock: [] },
    ];
    const w = world({ map: ["#####", "#@AG#", "#####"], player: { depth: 0 }, stores });
    const plan = townTripPlan(w.terrain, null);
    expect(plan.step(w.view, w.act)).toEqual({ code: "walk", dir: 6 });
    w.moveTo({ x: 2, y: 1 });
    expect(plan.step(w.view, w.act)).toEqual({ code: "shop-exit" });
    expect(plan.step(w.view, w.act)).toEqual({ code: "walk", dir: 6 });
    w.moveTo({ x: 3, y: 1 });
    expect(plan.step(w.view, w.act)).toEqual({ code: "shop-exit" });
    expect(plan.step(w.view, w.act)).toBeNull();
  });
});
