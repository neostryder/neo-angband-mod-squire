import type { StoreItemView, StoreView } from "@rpgm-tools/neo-angband-core";
import { describe, expect, it } from "vitest";
import { itemNamed } from "../harness.js";
import { defaultPersona } from "../persona/persona.js";
import { readPack } from "../brain/pack.js";
import { world } from "../harness.js";
import { supplyNeeds, type SupplyNeed } from "./needs.js";
import { mightBeSpecial, saleFits, sellList, shoppingList, storesFor } from "./shop.js";
import { TV } from "../gear/compare.js";

function ware(name: string, index: number, price: number, number: number): StoreItemView {
  return { ...itemNamed(name, 0), index, price, number } as StoreItemView;
}

function alchemy(stock: StoreItemView[]): StoreView {
  return { feat: 7, featName: "Alchemy Shop", isHome: false, owner: { name: "Mauser", purse: 10000 }, stock };
}

describe("shop choices", () => {
  it("follows the real general and alchemy stock categories", () => {
    expect(storesFor("food")).toEqual(["General Store"]);
    expect(storesFor("healing")).toEqual(["Alchemy Shop"]);
    expect(storesFor("recall")).toEqual(["Alchemy Shop"]);
  });

  it("buys healing and phase before recall and keeps the total within gold", () => {
    const needs: SupplyNeed[] = [
      { kind: "healing", name: "Cure Light Wounds", want: 5, have: 0 },
      { kind: "recall", name: "Word of Recall", want: 1, have: 0 },
      { kind: "phase", name: "Phase Door", want: 5, have: 0 },
    ];
    const store = alchemy([
      ware("a Potion of Cure Light Wounds", 0, 20, 8),
      ware("a Scroll of Phase Door", 1, 10, 8),
      ware("a Scroll of Word of Recall", 2, 40, 4),
    ]);
    const list = shoppingList(needs, store, 65, null);
    expect(list.map((item) => item.kind)).toEqual(["healing", "phase", "healing", "phase"]);
    expect(list[0]).toMatchObject({ kind: "healing", index: 0, quantity: 1 });
    expect(list.reduce((sum, item) => sum + item.quantity * (store.stock[item.index]?.price ?? 0), 0)).toBeLessThanOrEqual(65);
    const saver = defaultPersona();
    saver.sliders.savings = 100;
    expect(shoppingList(needs, store, 65, saver)).toEqual(list);
  });

  it("skips wares without a shown name or price", () => {
    const hidden = ware("a Scroll of Word of Recall", 0, 5, 1);
    Reflect.deleteProperty(hidden, "name");
    const need: SupplyNeed = { kind: "recall", name: "Word of Recall", want: 1, have: 0 };
    expect(shoppingList([need], alchemy([hidden]), 50, null)).toEqual([]);
  });

  it("funds both survival supplies for the warrior who carried only food and a torch", () => {
    const w = world({ map: ["@"], player: { cls: "Warrior", level: 1, depth: 0, gold: 65 }, pack: ["a Ration of Food", "a Wooden Torch"] });
    const store = alchemy([ware("a Potion of Cure Light Wounds", 0, 20, 10), ware("a Scroll of Phase Door", 1, 18, 10), ware("a Scroll of Word of Recall", 2, 125, 10)]);
    const needs = supplyNeeds(w.view, readPack(w.view), null);
    expect(needs.find((n) => n.kind === "healing")?.want).toBe(6);
    const list = shoppingList(needs, store, 65, null);
    expect(list.map((item) => item.kind)).toEqual(["healing", "phase", "healing"]);
    expect(list.reduce((sum, item) => sum + item.quantity * store.stock[item.index]!.price!, 0)).toBe(58);
  });

  it("keeps purchases within both the gold and each displayed stock stack", () => {
    const needs: SupplyNeed[] = [
      { kind: "healing", name: "Cure Light Wounds", want: 6, have: 0 },
      { kind: "phase", name: "Phase Door", want: 5, have: 0 },
    ];
    const store = alchemy([ware("a Potion of Cure Light Wounds", 0, 20, 1), ware("a Potion of Cure Light Wounds", 1, 20, 1), ware("a Scroll of Phase Door", 2, 18, 1)]);
    const list = shoppingList(needs, store, 100, null);
    expect(list.map((item) => item.index)).toEqual([0, 2, 1]);
    expect(shoppingList(needs, store, 37, null).map((item) => item.kind)).toEqual(["healing"]);
    expect(shoppingList(needs, store, 38, null).map((item) => item.kind)).toEqual(["healing", "phase"]);
  });

  it("sells only an unfavoured extra weapon at a high selling setting", () => {
    const w = world({ map: ["@"], pack: ["a Dagger", "a Dagger"] });
    const persona = defaultPersona();
    expect(sellList(readPack(w.view), w.view, persona)).toEqual([]);
    persona.sliders.selling = 80;
    expect(sellList(readPack(w.view), w.view, persona)).toMatchObject([{ handle: 2, quantity: 1 }]);
    persona.lists.weapons = ["Dagger"];
    expect(sellList(readPack(w.view), w.view, persona)).toEqual([]);
  });
});

describe("mightBeSpecial", () => {
  it("reads only what the shown name tells the player", () => {
    expect(mightBeSpecial("a Dagger (1d4) (+0,+0)")).toBe(false);
    expect(mightBeSpecial("a Set of Leather Gloves [1,+0]")).toBe(false);
    expect(mightBeSpecial("a Dagger (1d4) (+2,+3) {??}")).toBe(true);
    expect(mightBeSpecial("a Dagger of Slay Orc (1d4) (+2,+3)")).toBe(true);
    expect(mightBeSpecial("the Dagger 'Narthanc' (1d4) (+4,+6)")).toBe(true);
  });
});

describe("wider selling", () => {
  it("sells a duplicate device but keeps the only one of its kind and the best attack wand", () => {
    const persona = defaultPersona();
    persona.sliders.selling = 85;
    const w = world({ map: ["@"], pack: ["a Wand of Magic Missile", "a Wand of Magic Missile", "a Rod of Detection", "a Ring of Woe", "an Amulet of Adornment"] });
    const list = sellList(readPack(w.view), w.view, persona);
    const names = list.map((entry) => entry.name);
    expect(names).toContain("a Wand of Magic Missile");
    expect(names).not.toContain("a Rod of Detection");
    expect(names).toContain("a Ring of Woe");
    expect(names).toContain("an Amulet of Adornment");
  });

  it("sells one of two rods of detection and keeps the other", () => {
    const persona = defaultPersona();
    persona.sliders.selling = 85;
    const w = world({ map: ["@"], pack: ["a Rod of Detection", "a Rod of Detection"] });
    const list = sellList(readPack(w.view), w.view, persona);
    expect(list).toMatchObject([{ quantity: 1, tval: 24 }]);
  });

  it("keeps a hoarder persona from selling spare wands and rings", () => {
    const persona = defaultPersona();
    persona.sliders.selling = 80;
    persona.sliders.hoarding = 75;
    const w = world({ map: ["@"], pack: ["a Wand of Magic Missile", "a Wand of Magic Missile"] });
    expect(sellList(readPack(w.view), w.view, persona)).toEqual([]);
  });

  it("does not sell the last light when nothing else lights the way", () => {
    const persona = defaultPersona();
    persona.sliders.selling = 100;
    const w = world({ map: ["@"], pack: ["a Wooden Torch"], worn: [] });
    expect(sellList(readPack(w.view), w.view, persona)).toEqual([]);
  });

  it("does not sell into the survival basket", () => {
    const persona = defaultPersona();
    persona.sliders.selling = 100;
    /* 2 cures is the basket floor; 1 cure is below the basket so selling is allowed */
    const w = world({ map: ["@"], pack: ["a Potion of Cure Light Wounds"], worn: ["a Wooden Torch (5000 turns)"] });
    expect(sellList(readPack(w.view), w.view, persona)).toEqual([]);
  });

  it("sells excess consumables above the basket", () => {
    const persona = defaultPersona();
    persona.sliders.selling = 100;
    /* 8 cures split across two stack lines gives a total above the basket floor of 2. */
    const w = world({ map: ["@"], pack: ["a Potion of Cure Light Wounds", "a Potion of Cure Light Wounds", "a Potion of Cure Light Wounds", "a Potion of Cure Light Wounds", "a Potion of Cure Light Wounds", "a Potion of Cure Light Wounds", "a Potion of Cure Light Wounds", "a Potion of Cure Light Wounds", "a Scroll of Phase Door", "a Scroll of Phase Door", "a Scroll of Phase Door", "a Scroll of Phase Door", "a Scroll of Phase Door", "a Scroll of Phase Door"], worn: ["a Wooden Torch (5000 turns)"] });
    const list = sellList(readPack(w.view), w.view, persona);
    const totalSold = list.reduce((sum, item) => sum + item.quantity, 0);
    expect(totalSold).toBeGreaterThan(0);
  });

  it("never sells a named artifact or an item with unknown runes", () => {
    const persona = defaultPersona();
    persona.sliders.selling = 100;
    const w = world({ map: ["@"], pack: ["the Ring 'Narthanc'", "a Wand of Wonder {??}"] });
    expect(sellList(readPack(w.view), w.view, persona)).toEqual([]);
  });

  it("sells no supply a cautious persona would buy back", () => {
    const persona = defaultPersona();
    persona.sliders.boldness = 10;
    persona.sliders.selfpreservation = 90;
    persona.sliders.ambition = 20;
    persona.sliders.selling = 100;
    const w = world({ map: ["@"], pack: ["3 Potions of Cure Light Wounds", "3 Scrolls of Phase Door"], worn: ["a Wooden Torch (5000 turns)"] });
    const list = sellList(readPack(w.view), w.view, persona);
    expect(list.filter((sale) => sale.tval === 26 || sale.tval === 25)).toEqual([]);
  });
});

import { homeSpares, homeWithdrawal } from "./shop.js";
import { UNKNOWN_HOME, type HomeStock as HomeStockType } from "./home.js";

describe("home memory and stockpile", () => {
  it("reports the home as unknown until the character steps inside", () => {
    const stock: HomeStockType = UNKNOWN_HOME;
    expect(stock.entered).toBe(false);
    expect(homeWithdrawal(stock, [{ kind: "healing", name: "Cure Light Wounds", want: 5, have: 0 }])).toEqual([]);
  });

  it("withdraws a remembered ware to satisfy a basket need", () => {
    const stock: HomeStockType = { entered: true, turn: 10, wares: [{ name: "a Potion of Cure Light Wounds", tval: 26, count: 5 }] };
    const take = homeWithdrawal(stock, [{ kind: "healing", name: "Cure Light Wounds", want: 5, have: 0 }]);
    expect(take).toEqual([{ name: "Cure Light Wounds", quantity: 5 }]);
  });

  it("sends excess consumables home only after the basket is the basket", () => {
    const persona = defaultPersona();
    /* A pack well above the basket floor in cures and phase doors. */
    const pack = Array.from({ length: 10 }, () => "a Potion of Cure Light Wounds")
      .concat(Array.from({ length: 8 }, () => "a Scroll of Phase Door"));
    const w = world({ map: ["@"], pack, worn: ["a Wooden Torch (5000 turns)"] });
    const spares = homeSpares(w.view, persona);
    const total = spares.reduce((sum, item) => sum + item.quantity, 0);
    expect(total).toBeGreaterThan(0);
  });

  it("a hoarding persona ships fewer spares home than a greedy one", () => {
    const greedy = defaultPersona();
    greedy.sliders.hoarding = 20;
    const hoarder = defaultPersona();
    hoarder.sliders.hoarding = 80;
    const pack = Array.from({ length: 10 }, () => "a Potion of Cure Light Wounds")
      .concat(Array.from({ length: 8 }, () => "a Scroll of Phase Door"));
    const w = world({ map: ["@"], pack, worn: ["a Wooden Torch (5000 turns)"] });
    const greedyTotal = homeSpares(w.view, greedy).reduce((sum, item) => sum + item.quantity, 0);
    const hoarderTotal = homeSpares(w.view, hoarder).reduce((sum, item) => sum + item.quantity, 0);
    expect(greedyTotal).toBeGreaterThan(hoarderTotal);
  });
});

describe("each store's buy list, as in the game's store.txt", () => {
  /* Item kinds by number: scroll 25, potion 26, flask 27, food 28, mushroom 29, magic book 30, prayer book 31, staff 22, wand 23, rod 24. */
  const cases: readonly [string, readonly number[], readonly number[]][] = [
    ["General Store", [TV.LIGHT, 28, 29, 27, TV.DIGGING, TV.CLOAK, TV.SHOT, TV.BOLT, TV.ARROW], [25, 26, TV.SWORD, 23]],
    ["Alchemy Shop", [25, 26], [29, 28, TV.SWORD, 23]],
    ["Armoury", [TV.BOOTS, TV.GLOVES, TV.HELM, TV.CROWN, TV.SHIELD, TV.CLOAK, TV.SOFT_ARMOR, TV.HARD_ARMOR, TV.DRAG_ARMOR], [TV.SWORD, 26]],
    ["Weapon Smiths", [TV.HAFTED, TV.POLEARM, TV.SWORD, TV.BOW, TV.SHOT, TV.ARROW, TV.BOLT, TV.DIGGING], [TV.CLOAK, 25]],
    ["Bookstore", [30, 31, 32, 33], [26, TV.SWORD]],
    ["Magic Shop", [30, TV.AMULET, TV.RING, 22, 23, 24], [31, 26, TV.SWORD]],
  ];
  for (const [store, buys, refuses] of cases) {
    it(`${store} buys its own kinds and refuses others`, () => {
      for (const tval of buys) expect(saleFits(tval, store), `${store} buys ${String(tval)}`).toBe(true);
      for (const tval of refuses) expect(saleFits(tval, store), `${store} refuses ${String(tval)}`).toBe(false);
    });
  }

  it("lets the Black Market buy anything and treats the home as no sale", () => {
    expect(saleFits(TV.SWORD, "Black Market")).toBe(true);
    expect(saleFits(26, "Home")).toBe(false);
  });
});
