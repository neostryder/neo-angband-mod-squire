import type { AgentView, StoreItemView, StoreView } from "@rpgm-tools/neo-angband-core";
import { describe, expect, it } from "vitest";
import { FEAT, itemNamed, suppliedWorld, world } from "../harness.js";
import { defaultPersona } from "../persona/persona.js";
import type { Aim } from "../strategy/aims.js";
import { emptyFlourishes } from "../learning/family-ways.js";
import { aimPurchase } from "./aims-shop.js";
import { neededEntrances, townTripPlan } from "./plan.js";
import { readHomeStock, UNKNOWN_HOME, createHomeMemory, type HomeStock } from "./home.js";
import { homeSpares, homeWithdrawal, sellList } from "./shop.js";
import { readPack } from "../brain/pack.js";

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
    const w = suppliedWorld({ map: ["#####", "#@.A#", "#####"], player: { depth: 0, maxDepth: 5, gold: 50 }, stores: [store] });
    let reads = 0;
    const view: AgentView = { ...w.view, stores: () => { reads += 1; return w.view.stores(); } };
    expect(neededEntrances(view, w.terrain, null).map((entry) => entry.name)).toEqual(["Alchemy Shop"]);
    const plan = townTripPlan(w.terrain, null);
    expect(plan.step(view, w.act)).toEqual({ code: "walk", dir: 6 });
    expect(reads).toBe(0);
    w.moveTo({ x: 3, y: 1 });
    expect(plan.step(view, w.act)).toEqual({ code: "shop-buy", args: { index: 0, quantity: 1 } });
    expect(reads).toBe(1);
    w.setPack(["a Scroll of Word of Recall", "3 Potions of Cure Light Wounds", "3 Scrolls of Phase Door", "5 Rations of Food", "2 Wooden Torches"]);
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
    const w = suppliedWorld({ map: ["#####", "#@.U#", "#####"], player: { depth: 0, maxDepth: 5, gold: 200 }, stores: [store] });
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
    const w = suppliedWorld({ map: ["#####", "#@.U#", "#####"], player: { depth: 0, gold: 200 }, stores: [store] });
    const plan = townTripPlan(w.terrain, null, new Set(), () => {}, [aim]);
    expect(plan.step(w.view, w.act)).toEqual({ code: "walk", dir: 6 });
    w.moveTo({ x: 3, y: 1 });
    expect(plan.step(w.view, w.act)).toEqual({ code: "shop-buy", args: { index: 0, quantity: 1 } });
    w.setPack(["Leather Cloak [1,+0]", "3 Potions of Cure Light Wounds", "3 Scrolls of Phase Door", "5 Rations of Food", "2 Wooden Torches"]);
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

  it("inspects mapped shops for a needed protection and buys only an affordable named match", () => {
    const aim: Aim = { kind: "free-action", label: "free action", detail: "Get Free Action before descending.", how: "hunt", price: null, depth: null };
    const w = suppliedWorld({ map: ["#####", "#@.A#", "#####"], player: { depth: 0, gold: 200 } });
    expect(neededEntrances(w.view, w.terrain, null, new Set(), [aim]).map((entry) => entry.name)).toEqual(["Alchemy Shop"]);
    const store: StoreView = { feat: FEAT.ALCHEMY, featName: "Alchemy Shop", isHome: false, owner: { name: "Mauser", purse: 10000 }, stock: [{ ...itemNamed("a Ring of Free Action", 0), index: 0, price: 150, number: 1 }] };
    expect(aimPurchase([aim], store, 200)).toMatchObject({ index: 0, quantity: 1 });
    expect(aimPurchase([aim], store, 100)).toBeNull();
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

describe("home routing", () => {
  it("withdraws from the home before the shops and remembers it for the next trip", () => {
    const home: StoreView = { feat: FEAT.HOME, featName: "Home", isHome: true, owner: { name: "Squire", purse: 0 }, stock: [
      { ...itemNamed("a Potion of Cure Light Wounds", 0), index: 0, price: 0, number: 5 },
    ] };
    const alchemy: StoreView = { feat: FEAT.ALCHEMY, featName: "Alchemy Shop", isHome: false, owner: { name: "Mauser", purse: 10000 }, stock: [
      { ...itemNamed("a Potion of Cure Light Wounds", 0), index: 0, price: 20, number: 10 },
    ] };
    const w = world({ map: ["#######", "#@.H.A#", "#######"], player: { cls: "Warrior", depth: 0, gold: 100 }, pack: [], stores: [home, alchemy], worn: ["a Wooden Torch (5000 turns)"] });
    const persona = defaultPersona();
    let saved: HomeStock = UNKNOWN_HOME;
    const plan = townTripPlan(w.terrain, persona, new Set(), () => {}, [], emptyFlourishes, undefined, undefined, UNKNOWN_HOME, (stock) => { saved = stock; });
    expect(neededEntrances(w.view, w.terrain, persona, new Set(), [], emptyFlourishes(), undefined, UNKNOWN_HOME)[0]?.name).toBe("Home");
    expect(plan.step(w.view, w.act)).toMatchObject({ code: "walk" });
    w.moveTo({ x: 3, y: 1 });
    expect(plan.step(w.view, w.act)).toEqual({ code: "shop-buy", args: { index: 0, quantity: 2 } });
    expect(saved.entered).toBe(true);
    /* A reload reads the home back, and the remembered stock still routes a need there. */
    const reloaded = readHomeStock(JSON.parse(JSON.stringify(saved)));
    expect(reloaded.entered).toBe(true);
    expect(homeWithdrawal(reloaded, [{ kind: "healing", name: "Cure Light Wounds", want: 2, have: 0 }])).toEqual([{ name: "Cure Light Wounds", quantity: 2 }]);
    w.setPack([]);
    expect(neededEntrances(w.view, w.terrain, persona, new Set(), [], emptyFlourishes(), undefined, reloaded).map((entry) => entry.name)).toContain("Home");
    /* A second trip from the reloaded stock withdraws the same ware. */
    const second = townTripPlan(w.terrain, persona, new Set(), () => {}, [], emptyFlourishes, undefined, undefined, reloaded, () => {});
    expect(second.step(w.view, w.act)).toEqual({ code: "shop-buy", args: { index: 0, quantity: 2 } });
  });

  it("takes a second ware from the home on the same visit", () => {
    const home: StoreView = { feat: FEAT.HOME, featName: "Home", isHome: true, owner: { name: "Squire", purse: 0 }, stock: [
      { ...itemNamed("a Potion of Cure Light Wounds", 0), index: 0, price: 0, number: 5 },
      { ...itemNamed("a Scroll of Phase Door", 0), index: 1, price: 0, number: 5 },
    ] };
    const w = world({ map: ["#####", "#@.H#", "#####"], player: { cls: "Warrior", depth: 0, gold: 100 }, pack: [], stores: [home], worn: ["a Wooden Torch (5000 turns)"] });
    const plan = townTripPlan(w.terrain, defaultPersona(), new Set(), () => {}, [], emptyFlourishes, undefined, undefined, UNKNOWN_HOME, () => {});
    expect(plan.step(w.view, w.act)).toMatchObject({ code: "walk" });
    w.moveTo({ x: 3, y: 1 });
    expect(plan.step(w.view, w.act)).toMatchObject({ code: "shop-buy", args: { index: 0 } });
    expect(plan.step(w.view, w.act)).toMatchObject({ code: "shop-buy", args: { index: 1 } });
  });

  it("never stores or sells the only escape or Word of Recall on a shallow character", () => {
    const home: StoreView = { feat: FEAT.HOME, featName: "Home", isHome: true, owner: { name: "Squire", purse: 0 }, stock: [] };
    const w = world({ map: ["#####", "#@.H#", "#####"], player: { cls: "Warrior", depth: 0, maxDepth: 3, gold: 0 }, pack: ["a Scroll of Teleportation", "a Scroll of Word of Recall"], stores: [home], worn: ["a Wooden Torch (5000 turns)"] });
    const greedy = { ...defaultPersona(), sliders: { ...defaultPersona().sliders, selling: 100, hoarding: 0 } };
    expect(homeSpares(w.view, greedy, false)).toEqual([]);
    expect(sellList(readPack(w.view), w.view, greedy).map((sale) => sale.name)).toEqual([]);
  });

  it("stores a spare at the home and remembers it", () => {
    const home: StoreView = { feat: FEAT.HOME, featName: "Home", isHome: true, owner: { name: "Squire", purse: 0 }, stock: [] };
    const w = world({ map: ["#####", "#@.H#", "#####"], player: { cls: "Warrior", depth: 0, gold: 0 }, pack: ["10 Potions of Cure Light Wounds"], stores: [home], worn: ["a Wooden Torch (5000 turns)"] });
    let saved: HomeStock = UNKNOWN_HOME;
    const plan = townTripPlan(w.terrain, defaultPersona(), new Set(), () => {}, [], emptyFlourishes, undefined, undefined, UNKNOWN_HOME, (stock) => { saved = stock; });
    expect(plan.step(w.view, w.act)).toEqual({ code: "walk", dir: 6 });
    w.moveTo({ x: 3, y: 1 });
    expect(plan.step(w.view, w.act)).toEqual({ code: "shop-sell", args: { handle: 1, quantity: 4 } });
    expect(saved.entered).toBe(true);
  });

  it("does not read the home from across town", () => {
    const home: StoreView = { feat: FEAT.HOME, featName: "Home", isHome: true, owner: { name: "Squire", purse: 0 }, stock: [
      { ...itemNamed("a Potion of Cure Light Wounds", 0), index: 0, price: 0, number: 5 },
    ] };
    const w = world({ map: ["#####", "#@.H#", "#####"], player: { depth: 0, gold: 0 }, stores: [home] });
    const memory = createHomeMemory();
    expect(memory.observe(w.view)).toBe(false);
    expect(memory.current().entered).toBe(false);
    w.moveTo({ x: 3, y: 1 });
    expect(memory.observe(w.view)).toBe(true);
    expect(memory.current().entered).toBe(true);
  });
});

describe("refused sales", () => {
  it("does not offer a sale the store's buy list refuses", () => {
    const persona = defaultPersona();
    persona.sliders.selling = 80;
    const alchemy: StoreView = { feat: FEAT.ALCHEMY, featName: "Alchemy Shop", isHome: false, owner: { name: "Mauser", purse: 10000 }, stock: [
      { ...itemNamed("a Potion of Cure Light Wounds", 0), index: 0, price: 20, number: 10 },
    ] };
    const w = suppliedWorld({ map: ["#####", "#@.A#", "#####"], player: { depth: 0, gold: 100 }, pack: ["a Dagger", "a Dagger"], stores: [alchemy] });
    const plan = townTripPlan(w.terrain, persona, new Set(), () => {});
    plan.step(w.view, w.act);
    w.moveTo({ x: 3, y: 1 });
    expect(plan.step(w.view, w.act)?.code).not.toBe("shop-sell");
    expect(w.issued.some((command) => command.code === "shop-sell")).toBe(false);
  });

  it("offers a sale once even when the pack still shows the item", () => {
    const persona = defaultPersona();
    persona.sliders.selling = 80;
    const weapon: StoreView = { feat: FEAT.WEAPON, featName: "Weapon Smiths", isHome: false, owner: { name: "Bert", purse: 5000 }, stock: [] };
    const w = world({ map: ["#####", "#@.W#", "#####"], player: { depth: 0, maxDepth: 5, gold: 0 }, pack: ["a Dagger", "a Dagger"], stores: [weapon] });
    const plan = townTripPlan(w.terrain, persona, new Set(), () => {});
    plan.step(w.view, w.act);
    w.moveTo({ x: 3, y: 1 });
    expect(plan.step(w.view, w.act)).toEqual({ code: "shop-sell", args: { handle: 2, quantity: 1 } });
    expect(plan.step(w.view, w.act)).not.toEqual({ code: "shop-sell", args: { handle: 2, quantity: 1 } });
  });
});
