import { describe, expect, it } from "vitest";
import type { StoreView } from "@rpgm-tools/neo-angband-core";
import { FEAT, itemNamed, world } from "../harness.js";
import { readPack } from "../brain/pack.js";
import { defaultPersona } from "../persona/persona.js";
import { basketNeeds, createDeparture } from "./departure.js";
import { supplyNeeds, type SupplyNeed } from "./needs.js";
import { shoppingList } from "./shop.js";

const PANTRY = ["5 Rations of Food", "2 Wooden Torches (5000 turns)"];
const alchemy: StoreView = { feat: FEAT.ALCHEMY, featName: "Alchemy Shop", isHome: false, owner: { name: "Mauser", purse: 10000 }, stock: [
  { ...itemNamed("a Potion of Cure Light Wounds", 0), index: 0, price: 20, number: 8 },
  { ...itemNamed("a Scroll of Phase Door", 0), index: 1, price: 18, number: 8 },
] };

describe("the town survival basket", () => {
  it("does not leave when an entered shop still sells an affordable missing essential", () => {
    const w = world({ map: ["######", "#@A.>#", "######"], player: { depth: 0, gold: 20, light: 0 }, worn: ["a Wooden Torch (5000 turns)"], pack: PANTRY, stores: [alchemy] });
    w.moveTo({ x: 2, y: 1 });
    const departure = createDeparture();
    expect(departure.status(w.view, w.terrain, null, new Set([FEAT.ALCHEMY]))).toMatchObject({ ready: false, earning: false });
    w.setPlayer({ gold: 5 });
    expect(departure.status(w.view, w.terrain, null, new Set([FEAT.ALCHEMY]))).toMatchObject({ ready: false, earning: true, target: 76 });
    departure.begin(w.view, 76);
    w.setPlayer({ depth: 1, gold: 75 });
    expect(departure.finished(w.view)).toBe(false);
    w.setPlayer({ gold: 76 });
    expect(departure.finished(w.view)).toBe(true);
  });
  /* The soak's Rogue, at 2 gold, took the up staircase it arrived on with one
   * command, 161 times in ten minutes. */
  it("runs a trip whose gold goal was already met on the turn limit", () => {
    const w = world({ map: ["######", "#@..>#", "######"], player: { depth: 0, gold: 2, light: 0 }, worn: ["a Wooden Torch (5000 turns)"], pack: PANTRY });
    const departure = createDeparture();
    departure.begin(w.view, 0);
    w.setPlayer({ depth: 1 });
    departure.observe(w.view, w.terrain);
    expect(departure.finished(w.view)).toBe(false);
    w.advance(1000);
    expect(departure.finished(w.view)).toBe(true);
  });

  it("buys a first Phase Door before discretionary potion top-ups when only 18 gold remains", () => {
    const w = world({ map: ["@"], player: { depth: 0, gold: 18 }, pack: ["a Potion of Cure Light Wounds", ...PANTRY] });
    const needs = basketNeeds(w.view, supplyNeeds(w.view, readPack(w.view), null));
    expect(shoppingList(needs, alchemy, 18, null)).toMatchObject([{ kind: "phase", quantity: 1, index: 1 }]);
  });

  it("buys food and fuel reserves before oil top-ups and spending held by savings", () => {
    const needs: SupplyNeed[] = [
      { kind: "food", name: "Ration of Food", have: 0, want: 5 },
      { kind: "light", name: "Wooden Torch", have: 0, want: 2 },
      { kind: "oil", name: "Flask of Oil", have: 0, want: 10 },
    ];
    const general: StoreView = { ...alchemy, feat: FEAT.GENERAL, featName: "General Store", stock: [
      { ...itemNamed("a Ration of Food", 0), index: 0, price: 3, number: 10 },
      { ...itemNamed("a Wooden Torch", 0), index: 1, price: 2, number: 10 },
      { ...itemNamed("a Flask of Oil", 0), index: 2, price: 3, number: 10 },
    ] };
    const persona = defaultPersona();
    persona.sliders.savings = 100;
    expect(shoppingList(needs, general, 10, persona).map((purchase) => purchase.kind)).toEqual(["food", "light", "food", "light"]);
  });

  it("holds optional stock across stores while food or fuel is missing", () => {
    const w = world({ map: ["@"], player: { depth: 0 }, pack: ["2 Potions of Cure Light Wounds", "2 Scrolls of Phase Door"] });
    const basket = basketNeeds(w.view, supplyNeeds(w.view, readPack(w.view), null));
    expect(shoppingList(basket, alchemy, 100, null)).toEqual([]);
    expect(basket.map((need) => need.kind)).not.toContain("oil");
  });
});
