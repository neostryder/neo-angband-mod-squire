import type { StoreItemView, StoreView } from "@rpgm-tools/neo-angband-core";
import { describe, expect, it } from "vitest";
import { itemNamed } from "../harness.js";
import { defaultPersona } from "../persona/persona.js";
import { readPack } from "../brain/pack.js";
import { world } from "../harness.js";
import type { SupplyNeed } from "./needs.js";
import { mightBeSpecial, sellList, shoppingList, storesFor } from "./shop.js";

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

  it("buys recall first and keeps the total within gold", () => {
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
    expect(list[0]).toMatchObject({ kind: "recall", index: 2, quantity: 1 });
    expect(list.reduce((sum, item) => sum + item.quantity * (store.stock[item.index]?.price ?? 0), 0)).toBeLessThanOrEqual(65);
    const saver = defaultPersona();
    saver.sliders.savings = 100;
    expect(shoppingList(needs, store, 65, saver)[0]?.kind).toBe("recall");
  });

  it("skips wares without a shown name or price", () => {
    const hidden = { ...ware("a Scroll of Word of Recall", 0, 5, 1), name: undefined } as StoreItemView;
    const need: SupplyNeed = { kind: "recall", name: "Word of Recall", want: 1, have: 0 };
    expect(shoppingList([need], alchemy([hidden]), 50, null)).toEqual([]);
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
