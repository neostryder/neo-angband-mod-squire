import { describe, expect, it } from "vitest";
import { itemNamed, world } from "../harness.js";
import type { AgentView, StoreView } from "@rpgm-tools/neo-angband-core";
import { affordable, candidateAims, depthTarget, inFixedOrder, type Aim, type AimKind } from "./aims.js";
import { readStoreMemory, type StoreMemory } from "../town/memory.js";

const ROOM = ["#####", "#.@.#", "#####"];
const SPELLS = [{ name: "Magic Missile", sidx: 0 }];

function shop(items: readonly [string, number][]): StoreView {
  const stock = items.map(([name, price], i) => ({ ...itemNamed(name, 0), index: i, price, name }));
  return { feat: 1, featName: "General Store", isHome: false, owner: { name: "Bilbo", purse: 5000 }, stock } as unknown as StoreView;
}

function kinds(aims: readonly Aim[]): AimKind[] {
  return aims.map((a) => a.kind);
}

function remembered(view: AgentView): StoreMemory[] {
  return readStoreMemory(view.stores().map((store) => ({
    feat: store.feat, name: store.featName, owner: store.owner.name, turn: view.turn(), lifetime: 20000,
    stock: store.stock.map((item) => ({ name: (item as { name?: string }).name, tval: item.tval, price: item.price, count: item.number })),
  })));
}

function find(aims: readonly Aim[], kind: AimKind): Aim {
  const aim = aims.find((a) => a.kind === kind);
  if (aim === undefined) throw new Error(`no ${kind} aim in ${kinds(aims).join(", ")}`);
  return aim;
}

describe("candidate aims", () => {
  it("always includes a depth target from level and hit points", () => {
    const w = world({ map: ROOM, player: { level: 20, maxHp: 60 } });
    expect(find(candidateAims(w.view), "depth").depth).toBe(5);
    expect(depthTarget(20, 600)).toBe(10);
    expect(depthTarget(1, 10)).toBe(1);
  });

  it("aims at the next spellbook: save when a store prices it, hunt when it is unknown or not stocked", () => {
    const priced = world({ map: ROOM, player: { level: 1 }, spells: SPELLS, stores: [shop([["Magic for Beginners", 25]])] });
    const saving = find(candidateAims(priced.view, remembered(priced.view)), "spellbook");
    expect(saving.how).toBe("save");
    expect(saving.price).toBe(25);
    const unknown = world({ map: ROOM, player: { level: 1 }, spells: SPELLS });
    expect(find(candidateAims(unknown.view), "spellbook").how).toBe("hunt");
    const stocked = world({ map: ROOM, player: { level: 1 }, spells: SPELLS, stores: [shop([["Flask of Oil", 3]])] });
    expect(find(candidateAims(stocked.view), "spellbook").how).toBe("hunt");
  });

  it("has no spellbook aim once the book is carried", () => {
    const w = world({ map: ROOM, spells: SPELLS, pack: ["Magic for Beginners"] });
    expect(kinds(candidateAims(w.view))).not.toContain("spellbook");
  });

  it("has no spellbook aim when the next book is far above the character", () => {
    const w = world({ map: ROOM, player: { level: 1 } });
    const far = { ...w.view, spellbooks: () => [{ tval: 90, name: "Conjurings and Tricks", realm: "arcane", spells: [{ name: "x", sidx: 9, level: 30, learned: false }] }] };
    expect(kinds(candidateAims(far as never))).not.toContain("spellbook");
  });

  it("aims at a lantern only while a torch is worn and no lantern is", () => {
    const torch = world({ map: ROOM, worn: ["Wooden Torch"], stores: [shop([["Lantern", 100]])] });
    const aim = find(candidateAims(torch.view, remembered(torch.view)), "lantern");
    expect(aim.how).toBe("save");
    expect(aim.price).toBe(100);
    const carried = world({ map: ROOM, worn: ["Wooden Torch"], pack: ["Lantern"] });
    expect(find(candidateAims(carried.view), "lantern").how).toBe("try");
    const lit = world({ map: ROOM, worn: ["Lantern"] });
    expect(kinds(candidateAims(lit.view))).not.toContain("lantern");
    const none = world({ map: ROOM });
    expect(kinds(candidateAims(none.view))).not.toContain("lantern");
  });

  it("aims at empty armour slots and drops the aim when they are filled", () => {
    const bare = world({ map: ROOM, stores: [shop([["Leather Boots", 4]])] });
    const aim = find(candidateAims(bare.view, remembered(bare.view)), "armour");
    expect(aim.how).toBe("save");
    expect(aim.price).toBe(4);
    const carried = world({ map: ROOM, pack: ["Leather Shield"] });
    expect(find(candidateAims(carried.view), "armour").how).toBe("try");
    const dressed = world({ map: ROOM, worn: ["Soft Leather Armour", "Cloak", "Leather Shield", "Hard Helm", "Leather Gloves", "Leather Boots"] });
    expect(kinds(candidateAims(dressed.view))).not.toContain("armour");
  });

  it("aims at a magical weapon: buy one in a store, try a carried unknown one, none when already wielded", () => {
    const store = world({ map: ROOM, worn: ["Dagger (1d4)"], stores: [shop([["Dagger (1d4) of Slay Evil", 900]])] });
    const buy = find(candidateAims(store.view, remembered(store.view)), "weapon");
    expect(buy.how).toBe("save");
    expect(buy.price).not.toBeNull();
    const carried = world({ map: ROOM, worn: ["Dagger (1d4)"], pack: ["Dagger (1d4) {??}"] });
    expect(find(candidateAims(carried.view), "weapon").how).toBe("try");
    const plain = world({ map: ROOM, worn: ["Dagger (1d4)"], stores: [shop([["Dagger (1d4)", 10]])] });
    expect(kinds(candidateAims(plain.view))).not.toContain("weapon");
    const wielded = world({ map: ROOM, worn: ["Dagger (1d4) of Slay Evil"], stores: [shop([["Dagger (1d4) of Slay Evil", 900]])] });
    expect(kinds(candidateAims(wielded.view))).not.toContain("weapon");
  });

  it("aims at free action and see invisible only near the depths that need them, and only while the flag is missing", () => {
    const shallow = world({ map: ROOM, player: { depth: 3, maxDepth: 3 } });
    expect(kinds(candidateAims(shallow.view))).not.toContain("free-action");
    expect(kinds(candidateAims(shallow.view))).not.toContain("see-invisible");
    const mid = world({ map: ROOM, player: { depth: 10, maxDepth: 10 } });
    expect(kinds(candidateAims(mid.view))).toContain("see-invisible");
    expect(kinds(candidateAims(mid.view))).not.toContain("free-action");
    const deep = world({ map: ROOM, player: { depth: 16, maxDepth: 16 } });
    expect(kinds(candidateAims(deep.view))).toContain("free-action");
    const protectedDeep = world({ map: ROOM, player: { depth: 16, maxDepth: 16, objectFlags: ["FREE_ACT", "SEE_INVIS"] } });
    expect(kinds(candidateAims(protectedDeep.view))).not.toContain("free-action");
    expect(kinds(candidateAims(protectedDeep.view))).not.toContain("see-invisible");
  });

  it("counts a carried item that grants the protection as something to try", () => {
    const w = world({ map: ROOM, player: { depth: 16, maxDepth: 16 }, pack: ["Ring of Free Action"] });
    expect(find(candidateAims(w.view), "free-action").how).toBe("try");
  });

  it("copes with a view that cannot read the stores", () => {
    const w = world({ map: ROOM });
    const blind = { ...w.view, stores: () => { throw new Error("not in a store"); } };
    expect(kinds(candidateAims(blind as never))).toContain("depth");
  });

  it("lists candidates in the fixed order and judges affordability from the price", () => {
    const w = world({ map: ROOM, worn: ["Wooden Torch"], player: { level: 1 } });
    const aims = candidateAims(w.view);
    expect(kinds(inFixedOrder([...aims].reverse()))).toEqual(kinds(aims));
    expect(affordable({ ...find(aims, "depth"), price: 50 }, 50)).toBe(true);
    expect(affordable({ ...find(aims, "depth"), price: 50 }, 49)).toBe(false);
    expect(affordable(find(aims, "depth"), 9999)).toBe(false);
  });
});
