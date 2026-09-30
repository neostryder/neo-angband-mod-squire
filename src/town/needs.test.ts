import { describe, expect, it } from "vitest";
import { readPack } from "../brain/pack.js";
import { world } from "../harness.js";
import { defaultPersona } from "../persona/persona.js";
import { lowOnSupplies, supplyNeeds } from "./needs.js";

describe("town supplies", () => {
  it("wants no recall scroll before the character has been to level 5", () => {
    const shallow = world({ map: ["###", "#@#", "###"], player: { maxDepth: 4 } });
    expect(supplyNeeds(shallow.view, readPack(shallow.view), null).find((n) => n.kind === "recall")?.want).toBe(0);
  });

  it("scales healing and escapes with persona, with minimums", () => {
    const w = world({ map: ["###", "#@#", "###"], player: { maxDepth: 5 } });
    const low = defaultPersona();
    low.sliders.consumables = 0;
    low.sliders.escapes = 0;
    const high = defaultPersona();
    high.sliders.consumables = 100;
    high.sliders.escapes = 100;
    high.sliders.healat = 100;
    const needs = (persona: typeof low) => supplyNeeds(w.view, readPack(w.view), persona);
    expect(needs(low).find((n) => n.kind === "healing")?.want).toBeGreaterThanOrEqual(2);
    expect(needs(low).find((n) => n.kind === "recall")?.want).toBe(1);
    expect(needs(high).find((n) => n.kind === "healing")?.want).toBeGreaterThan(needs(low).find((n) => n.kind === "healing")?.want ?? 0);
    expect(needs(high).find((n) => n.kind === "phase")?.want).toBeGreaterThan(needs(low).find((n) => n.kind === "phase")?.want ?? 0);
  });

  it("requires a carried recall for a low-supply trip", () => {
    const w = world({ map: ["###", "#@#", "###"], pack: ["a Scroll of Word of Recall"] });
    expect(lowOnSupplies(supplyNeeds(w.view, readPack(w.view), null))).toBe(true);
    w.setPack(["2 Potions of Cure Light Wounds", "a Scroll of Phase Door", "a Ration of Food"]);
    expect(lowOnSupplies(supplyNeeds(w.view, readPack(w.view), null))).toBe(false);
    w.setPack(["2 Potions of Cure Light Wounds", "a Scroll of Phase Door", "a Scroll of Word of Recall"]);
    w.setPlayer({ status: { food: 900 } });
    expect(lowOnSupplies(supplyNeeds(w.view, readPack(w.view), null))).toBe(true);
  });

  it("changes healing grade at level 15 and light fuel with a lantern", () => {
    const w = world({ map: ["###", "#@#", "###"], player: { level: 15 }, worn: ["a Lantern"], pack: ["3 Flasks of Oil"] });
    const needs = supplyNeeds(w.view, readPack(w.view), null);
    expect(needs.find((n) => n.kind === "healing")?.name).toBe("Cure Serious Wounds");
    expect(needs.find((n) => n.kind === "light")?.have).toBe(3);
  });

  it("keeps scroll supplies for a dark warrior and lowers healing only for a usable healing spell", () => {
    const warrior = world({ map: ["@"], player: { cls: "Warrior", level: 1, light: 0, depth: 0 } });
    const priest = world({ map: ["@"], player: { cls: "Priest", level: 1, sp: 2, maxSp: 2, depth: 0 }, spells: [{ name: "Minor Healing", sidx: 0, mana: 1 }] });
    const need = (w: typeof warrior, kind: string) => supplyNeeds(w.view, readPack(w.view), null).find((n) => n.kind === kind)?.want;
    expect(need(warrior, "healing")).toBe(6);
    expect(need(warrior, "phase")).toBe(5);
    expect(need(priest, "healing")).toBe(3);
    priest.setPlayer({ sp: 0 });
    expect(need(priest, "healing")).toBe(5);
  });
});
