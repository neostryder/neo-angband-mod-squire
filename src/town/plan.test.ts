import type { AgentView, StoreItemView, StoreView } from "@rpgm-tools/neo-angband-core";
import { describe, expect, it } from "vitest";
import { FEAT, itemNamed, world } from "../harness.js";
import { defaultPersona } from "../persona/persona.js";
import type { Aim } from "../strategy/aims.js";
import { aimPurchase } from "./aims-shop.js";
import { neededEntrances, townTripPlan } from "./plan.js";

describe("town trip", () => {
  it("leaves the general store to buy survival supplies before oil or gear", () => {
    const stores: StoreView[] = [
      { feat: FEAT.ALCHEMY, featName: "STORE_ALCHEMY", isHome: false, owner: { name: "Mauser", purse: 10000 }, stock: [
        { ...itemNamed("a Potion of Cure Light Wounds", 0), index: 0, price: 20, number: 10 },
        { ...itemNamed("a Scroll of Phase Door", 0), index: 1, price: 18, number: 10 },
      ] },
      { feat: FEAT.GENERAL, featName: "STORE_GENERAL", isHome: false, owner: { name: "Bilbo", purse: 5000 }, stock: [
        { ...itemNamed("a Flask of Oil", 0), index: 0, price: 3, number: 10 },
      ] },
    ];
    const w = world({ map: ["######", "#G@.A#", "######"], player: { cls: "Warrior", level: 1, depth: 0, gold: 65 }, pack: ["a Ration of Food", "a Wooden Torch"], stores });
    const plan = townTripPlan(w.terrain, null);
    w.moveTo({ x: 1, y: 1 });
    expect(plan.step(w.view, w.act)).toEqual({ code: "shop-exit" });
    expect(plan.step(w.view, w.act)).toEqual({ code: "walk", dir: 6 });
    w.moveTo({ x: 4, y: 1 });
    expect(plan.step(w.view, w.act)).toEqual({ code: "shop-buy", args: { index: 0, quantity: 1 } });
    w.setPack(["a Potion of Cure Light Wounds", "a Ration of Food", "a Wooden Torch"]);
    w.setPlayer({ gold: 45 });
    expect(plan.step(w.view, w.act)).toEqual({ code: "shop-buy", args: { index: 1, quantity: 1 } });
    w.setPack(["a Potion of Cure Light Wounds", "a Scroll of Phase Door", "a Ration of Food", "a Wooden Torch"]);
    w.setPlayer({ gold: 27 });
    expect(plan.step(w.view, w.act)).toEqual({ code: "shop-buy", args: { index: 0, quantity: 1 } });
    w.setPack(["2 Potions of Cure Light Wounds", "a Scroll of Phase Door", "a Ration of Food", "a Wooden Torch"]);
    w.setPlayer({ gold: 7 });
    expect(plan.step(w.view, w.act)).toEqual({ code: "shop-exit" });
    expect(w.issued.filter((command) => command.code === "shop-buy")).toHaveLength(3);
  });

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

  it("walks to a shop and buys the top affordable aim's item", () => {
    const stock = [{ ...itemNamed("Leather Armour [8,+0]", 0), index: 0, price: 100, number: 1 }] as StoreItemView[];
    const store: StoreView = { feat: FEAT.ARMOUR, featName: "Armoury", isHome: false, owner: { name: "Toby", purse: 10000 }, stock };
    const aim: Aim = { kind: "armour", label: "armour for empty slots", detail: "Buy armour for the bare slots.", how: "save", price: 100, depth: null };
    const w = world({ map: ["#####", "#@.U#", "#####"], player: { depth: 0, maxDepth: 5, gold: 200 }, stores: [store] });
    expect(neededEntrances(w.view, w.terrain, null, new Set(), [aim]).map((entry) => entry.name)).toEqual(["Armoury"]);
    const plan = townTripPlan(w.terrain, null, new Set(), () => {}, [aim]);
    expect(plan.step(w.view, w.act)).toEqual({ code: "walk", dir: 6 });
    w.moveTo({ x: 3, y: 1 });
    expect(plan.step(w.view, w.act)).toEqual({ code: "shop-buy", args: { index: 0, quantity: 1 } });
  });

  it("buys for an aim only once per shopping trip", () => {
    const stock = [
      { ...itemNamed("Leather Cloak [1,+0]", 0), index: 0, price: 100, number: 1 },
      { ...itemNamed("Leather Cloak [1,+0]", 1), index: 1, price: 100, number: 1 },
    ] as StoreItemView[];
    const store: StoreView = { feat: FEAT.ARMOUR, featName: "Armoury", isHome: false, owner: { name: "Toby", purse: 10000 }, stock };
    const aim: Aim = { kind: "armour", label: "armour for empty slots", detail: "Buy armour for the bare slots.", how: "save", price: 100, depth: null };
    const w = world({ map: ["#####", "#@.U#", "#####"], player: { depth: 0, gold: 200 }, stores: [store] });
    const plan = townTripPlan(w.terrain, null, new Set(), () => {}, [aim]);
    expect(plan.step(w.view, w.act)).toEqual({ code: "walk", dir: 6 });
    w.moveTo({ x: 3, y: 1 });
    expect(plan.step(w.view, w.act)).toEqual({ code: "shop-buy", args: { index: 0, quantity: 1 } });
    w.setPack(["Leather Cloak [1,+0]"]);
    expect(plan.step(w.view, w.act)).toEqual({ code: "shop-exit" });
  });

  it("uses the displayed price when choosing an aim purchase", () => {
    const stock = [
      { ...itemNamed("Leather Armour [8,+0]", 0), index: 0, price: 100, number: 1 },
      { ...itemNamed("Leather Shield [8,+0]", 1), index: 1, price: 6, number: 1 },
    ] as StoreItemView[];
    const store: StoreView = { feat: FEAT.ARMOUR, featName: "Armoury", isHome: false, owner: { name: "Toby", purse: 10000 }, stock };
    const aim: Aim = { kind: "armour", label: "armour for empty slots", detail: "Buy armour for the bare slots.", how: "save", price: 6, depth: null };
    expect(aimPurchase([aim], store, 6)).toMatchObject({ index: 1, quantity: 1 });
    expect(aimPurchase([aim], { ...store, stock: stock.slice(0, 1) }, 6)).toBeNull();
  });

  it("sells surplus loot in town to fund the trip", () => {
    const persona = defaultPersona();
    persona.sliders.selling = 80;
    const stock = [{ ...itemNamed("a Dagger", 0), index: 0, price: 5, number: 1 }] as StoreItemView[];
    const store: StoreView = { feat: FEAT.WEAPON, featName: "Weapon Smiths", isHome: false, owner: { name: "Bert", purse: 5000 }, stock };
    const w = world({ map: ["#####", "#@.W#", "#####"], player: { depth: 0, maxDepth: 5, gold: 0 }, pack: ["a Dagger", "a Dagger"], stores: [store] });
    const plan = townTripPlan(w.terrain, persona, new Set(), () => {});
    expect(plan.step(w.view, w.act)).toEqual({ code: "walk", dir: 6 });
    w.moveTo({ x: 3, y: 1 });
    expect(plan.step(w.view, w.act)).toEqual({ code: "shop-sell", args: { handle: 2, quantity: 1 } });
  });
});
