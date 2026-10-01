import { describe, expect, it } from "vitest";
import { TV as CORE_TV } from "@rpgm-tools/neo-angband-core";
import { sameKind, TV } from "./compare.js";
import type { AgentView, LoadoutSimulation, LoadoutView, PlayerView } from "@rpgm-tools/neo-angband-core";
import { itemNamed, world } from "../harness.js";
import { equipmentValue, gearCandidates, keepsCapacity, loadoutDamage, loadoutMissileDamage } from "./compare.js";
import { aimPurchase, unaimedUpgradePurchase } from "../town/aims-shop.js";
import { sellList } from "../town/shop.js";
import { readPack } from "../brain/pack.js";
import { defaultPersona } from "../persona/persona.js";

describe("gear kinds", () => {
  it("numbers every item kind the way the engine does", () => {
    for (const [name, value] of Object.entries(TV)) expect(CORE_TV[name as keyof typeof CORE_TV]).toBe(value);
  });
});

describe("loadout capacity", () => {
  function loadout(view: AgentView, patch: Partial<PlayerView> = {}, equipment = view.equipment(), resists: number[] = []): LoadoutView {
    const player = { ...view.player(), ...patch };
    return { player, equipment, inventory: view.inventory(), stats: { heavyWield: false, heavyShoot: false, ammoMult: 0, resists, resistElements: ["ACID", "ELEC", "FIRE", "COLD"], objectFlags: player.objectFlags } } as unknown as LoadoutView;
  }

  function simulation(before: LoadoutView, after: LoadoutView): LoadoutSimulation {
    const a = before.player;
    const b = after.player;
    return { before, after, unresolved: [], placements: [{ slot: 0, worn: after.equipment[0]!, displaced: before.equipment[0] ?? null }],
      delta: { ac: b.ac - a.ac, toH: b.toHit - a.toHit, toD: b.toDam - a.toDam, blows: b.blows - a.blows, shots: b.shots - a.shots, speed: b.speed - a.speed, maxHp: b.maxHp - a.maxHp, maxSp: b.maxSp - a.maxSp, light: b.light - a.light, resists: after.stats.resists.map((value, i) => value - (before.stats.resists[i] ?? 0)) } } as unknown as LoadoutSimulation;
  }

  it.each(["FREE_ACT", "SEE_INVIS", "TELEPATHY"])("keeps the last %s even for a large armour upgrade", (flag) => {
    const w = world({ map: ["@"], pack: ["Leather Shield [8,+20]"], worn: ["Leather Shield [4,+0]"], player: { objectFlags: [flag] } });
    const result = simulation(loadout(w.view), loadout(w.view, { objectFlags: [], ac: 40 }, [w.view.inventory()[0]!]));
    const view = { ...w.view, simulateLoadout: () => result };
    expect(gearCandidates(view)).toEqual([]);
    expect(keepsCapacity(view, result)).toBe(false);
  });

  it("keeps the next depth's fire resistance and required basic resistance count", () => {
    const w = world({ map: ["@"], player: { depth: 20, maxDepth: 20, level: 25, maxLevel: 25, maxHp: 200, hp: 200, light: 2, objectFlags: ["FREE_ACT", "SEE_INVIS"] } });
    const before = loadout(w.view, {}, [], [1, 1, 1, 0]);
    const result = simulation(before, loadout(w.view, { ac: 50 }, [], [1, 1, 0, 0]));
    expect(keepsCapacity(w.view, result)).toBe(false);
    const safe = simulation(before, loadout(w.view, { ac: 50 }, [], [1, 0, 1, 1]));
    expect(keepsCapacity(w.view, safe)).toBe(true);
    w.setPlayer({ depth: 25, maxDepth: 25 });
    expect(keepsCapacity(w.view, simulation(before, loadout(w.view, { ac: 50 }, [], [1, 0, 1, 0])))).toBe(false);
  });

  it("compares weapon dice times simulated blows, with the displayed weapon bonus", () => {
    const w = world({ map: ["@"], player: { blows: 300, toDam: 0 }, worn: ["a Dagger (1d4) (+0,+1)"] });
    const before = loadout(w.view);
    const after = loadout(w.view, { blows: 100 }, [itemNamed("a Battle Axe (2d6) (+0,+0)", 1)]);
    expect(loadoutDamage(before)).toBe(10.5);
    expect(loadoutDamage(after)).toBe(7);
    expect(equipmentValue(simulation(before, after))).toBeLessThan(0);
  });

  it("compares launcher damage and simulated shot rate", () => {
    const w = world({ map: ["@"], player: { shots: 10 }, worn: ["a Short Bow (x2) (+0,+1)"], pack: ["20 Arrows (1d4) (+0,+0)"] });
    const before = loadout(w.view);
    const after = loadout(w.view, { shots: 20 }, [itemNamed("a Long Bow (x3) (+0,+0)", 3)]);
    expect(loadoutMissileDamage(before)).toBe(7);
    expect(loadoutMissileDamage(after)).toBe(15);
    expect(equipmentValue(simulation(before, after))).toBeGreaterThan(0);
    const quivered = world({ map: ["@"], player: { shots: 10 }, worn: ["a Short Bow (x2) (+0,+1)"], quiver: ["20 Arrows (1d4) (+0,+0)"] });
    expect(loadoutMissileDamage(loadout(quivered.view), quivered.view)).toBe(7);
  });

  it("does not treat a missing blow count as zero combat value", () => {
    const w = world({ map: ["@"], player: { blows: 100 }, worn: ["a Dagger (1d4) (+0,+0)"] });
    const after = loadout(w.view, { blows: 0, ac: 100 });
    expect(loadoutDamage(after)).toBeNull();
    expect(keepsCapacity(w.view, simulation(loadout(w.view), after))).toBe(false);
  });

  it("keeps casting capacity before armour and leaves a safe speed tradeoff for judgment", () => {
    const w = world({ map: ["@"], player: { cls: "Mage", sp: 4, maxSp: 4 }, pack: ["Leather Armour [8,+20]"], worn: ["Leather Armour [8,+0]"], spells: [{ name: "Magic Missile", sidx: 0, mana: 2, fail: 0 }, { name: "Phase Door", sidx: 1, mana: 1, fail: 0 }] });
    const before = loadout(w.view);
    expect(keepsCapacity(w.view, simulation(before, loadout(w.view, { ac: 100, maxSp: 0 })))).toBe(false);
    expect(keepsCapacity(w.view, simulation(before, loadout(w.view, { ac: 100, maxSp: 2 })))).toBe(false);
    const trade = simulation(before, loadout(w.view, { ac: 9, speed: 115 }, [w.view.inventory()[0]!]));
    expect(gearCandidates({ ...w.view, simulateLoadout: () => trade })[0]).toMatchObject({ unknown: false, safeUpgrade: false });
  });

  it("does not try unknown gear over a required protection without a derive", () => {
    const w = world({ map: ["@"], player: { objectFlags: ["FREE_ACT"] }, pack: ["Leather Shield [8] {??}"], worn: ["Leather Shield [4,+0]"] });
    expect(gearCandidates(w.view)).toEqual([]);
    const light = world({ map: ["@"], player: { objectFlags: ["FREE_ACT"] }, pack: ["a Wooden Torch (5000 turns)"], worn: ["a Wooden Torch (90 turns)"] });
    const result = simulation(loadout(light.view), loadout(light.view, { objectFlags: [] }, [light.view.inventory()[0]!]));
    expect(gearCandidates({ ...light.view, simulateLoadout: () => result })).toEqual([]);
  });

  it("buys the simulated capacity upgrade before a cheaper item and rejects protection loss", () => {
    const stock = [
      { ...itemNamed("Leather Shield [8,+0]", 1), index: 0, number: 1, price: 10 },
      { ...itemNamed("Leather Shield [8,+2]", 2), index: 1, number: 1, price: 20 },
    ];
    const store = { feat: 9, featName: "Armoury", isHome: false, owner: { name: "Toby", purse: 1000 }, stock };
    const w = world({ map: ["@"], player: { objectFlags: ["FREE_ACT"], gold: 50 }, worn: ["Leather Shield [4,+0]"], stores: [store] });
    const before = loadout(w.view);
    const view: AgentView = { ...w.view, simulateLoadout: (change) => {
      const ref = change.wield?.[0];
      const index = ref?.from === "store" ? ref.index : 0;
      return simulation(before, loadout(w.view, index === 0 ? { objectFlags: [], ac: 50 } : { speed: 115 }, [stock[index]!]));
    } };
    const aim = { kind: "armour" as const, label: "armour", detail: "", how: "save" as const, price: 10, depth: null };
    expect(aimPurchase([aim], store, 50, view)).toMatchObject({ index: 1 });
    expect(aimPurchase([aim], { ...store, stock: stock.slice(0, 1) }, 50, view)).toBeNull();
  });

  it("buys an unaimed upgrade when no aim asked for it and it is a clear swap", () => {
    const stock = [
      { ...itemNamed("Leather Shield [8,+0]", 1), index: 0, number: 1, price: 10 },
      { ...itemNamed("Leather Shield [8,+2]", 2), index: 1, number: 1, price: 20 },
    ];
    const store = { feat: 9, featName: "Armoury", isHome: false, owner: { name: "Toby", purse: 1000 }, stock };
    const w = world({ map: ["@"], player: { objectFlags: ["FREE_ACT"], gold: 50 }, worn: ["Leather Shield [4,+0]"], stores: [store] });
    const before = loadout(w.view);
    const view: AgentView = { ...w.view, simulateLoadout: (change) => {
      const ref = change.wield?.[0];
      const index = ref?.from === "store" ? ref.index : 0;
      return simulation(before, loadout(w.view, index === 0 ? { objectFlags: [], ac: 50 } : { speed: 115 }, [stock[index]!]));
    } };
    expect(unaimedUpgradePurchase(store, 50, view)).toMatchObject({ index: 1, aim: "unaimed upgrade" });
    expect(unaimedUpgradePurchase(store, 5, view)).toBeNull();
    expect(unaimedUpgradePurchase(store, 0, view)).toBeNull();
  });

  it("does not sell a spare whose removal loses speed or a required ability", () => {
    const w = world({ map: ["@"], pack: ["a Dagger", "a Dagger"], player: { objectFlags: ["FREE_ACT"] } });
    const before = loadout(w.view);
    const persona = defaultPersona();
    persona.sliders.selling = 80;
    const view: AgentView = { ...w.view, simulateLoadout: (change) => change.release === undefined ? null : simulation(before, loadout(w.view, { objectFlags: [], speed: 109 })) };
    expect(sellList(readPack(view), view, persona)).toEqual([]);
  });
});

describe("sameKind", () => {
  it("ignores count, article and fuel", () => {
    expect(sameKind("a Wooden Torch (4989 turns)", "2 Wooden Torches (4990 turns)")).toBe(true);
    expect(sameKind("a Wooden Torch (5000 turns)", "a Lantern (7500 turns)")).toBe(false);
  });
});

describe("an empty light slot", () => {
  it("lights a plain torch at once, whatever the persona's curiosity", async () => {
    const { world } = await import("../harness.js");
    const { gearCandidates } = await import("./compare.js");
    const dark = world({ map: ["#####", "#.@.#", "#####"], pack: ["2 Wooden Torches (5000 turns)"] });
    expect(gearCandidates(dark.view)[0]).toMatchObject({ handle: 1, unknown: false });
    const lit = world({ map: ["#####", "#.@.#", "#####"], pack: ["2 Wooden Torches (5000 turns)"], worn: ["a Wooden Torch (2000 turns)"] });
    expect(gearCandidates(lit.view)).toEqual([]);
  });
});

describe("a light running out", () => {
  it("swaps a burnt-out or nearly empty torch for a full one", async () => {
    const { world } = await import("../harness.js");
    const { gearCandidates } = await import("./compare.js");
    const out = world({ map: ["#####", "#.@.#", "#####"], pack: ["2 Wooden Torches (5000 turns)"], worn: ["a Wooden Torch (0 turns)"] });
    expect(gearCandidates(out.view)[0]).toMatchObject({ handle: 1, unknown: false });
    const low = world({ map: ["#####", "#.@.#", "#####"], pack: ["2 Wooden Torches (5000 turns)"], worn: ["a Wooden Torch (90 turns)"] });
    expect(gearCandidates(low.view)[0]?.criteria).toContain("nearly out of fuel");
  });
});

describe("favoured weapon kind in tie-break", () => {
  it("sorts the matching kind first when the candidates are within five percent of the top", () => {
    /* Two unknown weapons of the same visible dice: the sword matches "blade", the mace does not.
     * Both scores sit at the top of the array, so the kind match wins over raw score order. */
    const w = world({ map: ["@"], pack: ["a Sword (2d5) (+0,+0)", "a Mace (2d5) (+0,+0)"] });
    expect(gearCandidates(w.view, "blade").map((c) => c.handle)).toEqual([1, 2]);
    /* Reverse the input order and the sort still puts the sword first. */
    const reversed = world({ map: ["@"], pack: ["a Mace (2d5) (+0,+0)", "a Sword (2d5) (+0,+0)"] });
    expect(gearCandidates(reversed.view, "blade").map((c) => c.handle)).toEqual([2, 1]);
  });

  it("does not promote the matching kind when the score gap is wider than five percent", () => {
    /* 3d8 vs 1d4: 3d8 = 13.5, 1d4 = 2.5. The mace (hafted) is below the 5% floor of the sword,
     * so the sword sorts first regardless of the favoured kind. */
    const w = world({ map: ["@"], pack: ["a Mace (3d8) (+0,+0)", "a Sword (1d4) (+0,+0)"] });
    const order = gearCandidates(w.view, "hafted").map((c) => c.handle);
    expect(order[0]).toBe(1);
  });

  it("leaves the order alone when no favoured kind is set", () => {
    const w = world({ map: ["@"], pack: ["a Sword (2d5) (+0,+0)", "a Mace (2d5) (+0,+0)"] });
    /* Same scores; the comparator falls back to insertion order via Array.sort stability. */
    expect(gearCandidates(w.view, null).map((c) => c.handle)).toEqual([1, 2]);
  });
});
