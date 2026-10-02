import type { AgentCommand, AgentView, StoreItemView, StoreView } from "@rpgm-tools/neo-angband-core";
import { describe, expect, it } from "vitest";
import { FEAT, itemNamed, suppliedWorld, world, type World } from "../harness.js";
import { DIRECTIONS } from "../grid.js";
import { defaultPersona } from "../persona/persona.js";
import type { Aim } from "../strategy/aims.js";
import { emptyFlourishes } from "../learning/family-ways.js";
import { aimPurchase } from "./aims-shop.js";
import { neededEntrances, townTripPlan } from "./plan.js";
import { readHomeStock, UNKNOWN_HOME, createHomeMemory, type HomeStock } from "./home.js";
import { homeSpares, homeWithdrawal, sellList } from "./shop.js";
import { readPack } from "../brain/pack.js";

/** A stack's identity, so a second purchase of the same ware adds to it. */
function stackKey(name: string): string {
  return name.toLowerCase().replace(/ \(\d+ turns\)$/, "").replace(/^\d+\s+/, "").replace(/^(a|an)\s+/, "")
    .replace(/^potions of /, "potion of ").replace(/^scrolls of /, "scroll of ").replace(/^rations of /, "ration of ")
    .replace(/^flasks of /, "flask of ").replace(/^wooden torches\b/, "wooden torch");
}

function stackCount(line: string): number {
  const match = /^(\d+)\s/.exec(line);
  return match === null ? 1 : Number(match[1]);
}

/** The name a stack shows after a purchase. One stays singular; more takes the plural the pack tests already use. */
function pluralize(single: string, count: number): string {
  if (count <= 1) return single;
  const turns = / \(\d+ turns\)$/.exec(single)?.[0] ?? "";
  const base = single.replace(/ \(\d+ turns\)$/, "")
    .replace(/^a Potion of /, `${String(count)} Potions of `)
    .replace(/^a Scroll of /, `${String(count)} Scrolls of `)
    .replace(/^a Ration of /, `${String(count)} Rations of `)
    .replace(/^a Flask of /, `${String(count)} Flasks of `)
    .replace(/^a Wooden Torch$/, `${String(count)} Wooden Torches`)
    .replace(/^a Cloak$/, `${String(count)} Cloaks`)
    .replace(/^an /, `${String(count)} `)
    .replace(/^a /, `${String(count)} `);
  return base + turns;
}

function addToPack(pack: readonly string[], wareName: string, bought: number): string[] {
  const key = stackKey(wareName);
  const next = [...pack];
  const slot = next.findIndex((line) => line !== "" && stackKey(line) === key);
  if (slot < 0) {
    next.push(pluralize(wareName, bought));
    return next;
  }
  next[slot] = pluralize(wareName, stackCount(next[slot]!) + bought);
  return next;
}

/**
 * Apply the command the trip just issued. A sale pays 5 gold per item, the
 * price the weapon-shop fixture uses for a plain spare, so the trip's gold
 * stays a pure function of the commands.
 */
function applyTownCommand(w: World, pack: readonly string[], gold: number, stores: readonly StoreView[]): { pack: string[]; gold: number } {
  const command: AgentCommand | undefined = w.issued[w.issued.length - 1];
  if (command === undefined) return { pack: [...pack], gold };
  if (command.code === "walk") {
    const step = DIRECTIONS.find((dir) => dir.key === command.dir);
    if (step !== undefined) w.moveTo({ x: w.at().x + step.dx, y: w.at().y + step.dy });
    return { pack: [...pack], gold };
  }
  if (command.code !== "shop-buy" && command.code !== "shop-sell") return { pack: [...pack], gold };
  const feat = w.view.cell(w.at().x, w.at().y)?.feat;
  const store = stores.find((entry) => entry.feat === feat);
  if (store === undefined) return { pack: [...pack], gold };
  if (command.code === "shop-buy") {
    const index = command.args?.["index"];
    const quantity = command.args?.["quantity"];
    if (typeof index !== "number" || typeof quantity !== "number") return { pack: [...pack], gold };
    const ware = store.stock.find((item) => item.index === index);
    const price = ware?.price;
    if (ware === undefined || price === undefined) return { pack: [...pack], gold };
    const affordable = price === 0 ? quantity : Math.min(quantity, Math.floor(gold / price));
    const bought = Math.min(affordable, ware.number);
    if (bought <= 0) return { pack: [...pack], gold };
    ware.number -= bought;
    const next = addToPack(pack, ware.name ?? "", bought);
    const left = gold - price * bought;
    w.setPack(next);
    w.setPlayer({ gold: left });
    return { pack: next, gold: left };
  }
  const handle = command.args?.["handle"];
  const quantity = command.args?.["quantity"];
  if (typeof handle !== "number" || typeof quantity !== "number") return { pack: [...pack], gold };
  const next = [...pack];
  const line = next[handle - 1];
  if (line === undefined || line === "") return { pack: next, gold };
  const left = stackCount(line) - quantity;
  next[handle - 1] = left > 0 ? pluralize(line, left) : "";
  const paid = gold + 5 * quantity;
  w.setPack(next);
  w.setPlayer({ gold: paid });
  return { pack: next, gold: paid };
}

function commandText(command: AgentCommand): string {
  const dir = command.dir === undefined ? "" : `:${String(command.dir)}`;
  const args = command.args === undefined ? "" : ` ${JSON.stringify(command.args)}`;
  return `${command.code}${dir}${args}`;
}

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
    expect(plan.step(w.view, w.act)).toEqual({ code: "shop-buy", args: { index: 0, quantity: 2 } });
    w.setPack(["2 Potions of Cure Light Wounds", "a Ration of Food", "a Wooden Torch"]);
    w.setPlayer({ gold: 25 });
    expect(plan.step(w.view, w.act)).toEqual({ code: "shop-buy", args: { index: 1, quantity: 1 } });
    w.setPack(["2 Potions of Cure Light Wounds", "a Scroll of Phase Door", "a Ration of Food", "a Wooden Torch"]);
    w.setPlayer({ gold: 7 });
    expect(plan.step(w.view, w.act)).toEqual({ code: "shop-exit" });
    expect(w.issued.filter((command) => command.code === "shop-buy")).toHaveLength(2);
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

describe("a first town trip's commands", () => {
  function ware(name: string, index: number, price: number, number: number): StoreItemView {
    return { ...itemNamed(name, 0), index, price, number } as StoreItemView;
  }

  it("counts every command from the door to the last exit", () => {
    const stores: StoreView[] = [
      { feat: FEAT.HOME, featName: "Home", isHome: true, owner: { name: "Squire", purse: 0 }, stock: [] },
      { feat: FEAT.ALCHEMY, featName: "Alchemy Shop", isHome: false, owner: { name: "Mauser", purse: 10000 }, stock: [
        ware("a Potion of Cure Light Wounds", 0, 20, 20),
        ware("a Scroll of Phase Door", 1, 18, 20),
      ] },
      { feat: FEAT.GENERAL, featName: "General Store", isHome: false, owner: { name: "Bilbo", purse: 5000 }, stock: [
        ware("a Ration of Food", 0, 3, 20),
        ware("a Wooden Torch (5000 turns)", 1, 2, 20),
        ware("a Flask of Oil", 2, 3, 20),
      ] },
    ];
    const persona = defaultPersona();
    /* Gear sells from 60 up. The default of 50 would keep both cloaks. */
    persona.sliders.selling = 80;
    const w = world({
      map: ["###########", "#@..H.A.G.#", "###########"],
      player: { cls: "Warrior", level: 1, depth: 0, maxDepth: 0, gold: 100 },
      pack: ["a Wooden Torch (5000 turns)", "a Cloak", "a Cloak", "a Cloak"],
      worn: ["a Wooden Torch (5000 turns)"],
      stores,
    });
    const plan = townTripPlan(w.terrain, persona, new Set(), () => {}, [], emptyFlourishes, undefined, undefined, UNKNOWN_HOME, () => {});
    const commands: string[] = [];
    let pack = ["a Wooden Torch (5000 turns)", "a Cloak", "a Cloak", "a Cloak"];
    let gold = 100;
    for (let step = 0; step < 80; step += 1) {
      const command = plan.step(w.view, w.act);
      if (command === null) break;
      commands.push(commandText(command));
      const applied = applyTownCommand(w, pack, gold, stores);
      pack = applied.pack;
      gold = applied.gold;
    }
    const carried = pack.filter((line) => line !== "");
    expect({ count: commands.length, gold, carried, commands }).toEqual({
      count: 18,
      gold: 2,
      carried: [
        "2 Wooden Torches (5000 turns)",
        "a Cloak",
        "2 Potions of Cure Light Wounds",
        "2 Scrolls of Phase Door",
        "5 Rations of Food",
        "5 Flasks of Oil",
      ],
      commands: [
        "walk:6",
        "walk:6",
        "walk:6",
        "shop-exit",
        "walk:6",
        "walk:6",
        "shop-buy {\"index\":0,\"quantity\":2}",
        "shop-buy {\"index\":1,\"quantity\":2}",
        "shop-exit",
        "walk:6",
        "walk:6",
        "shop-sell {\"handle\":3,\"quantity\":1}",
        "shop-sell {\"handle\":4,\"quantity\":1}",
        "shop-buy {\"index\":0,\"quantity\":2}",
        "shop-buy {\"index\":1,\"quantity\":1}",
        "shop-buy {\"index\":0,\"quantity\":3}",
        "shop-buy {\"index\":2,\"quantity\":5}",
        "shop-exit",
      ],
    });
  });
});

describe("a townsperson in the way", () => {
  const maggot = { grid: { x: 2, y: 1 }, race: "Farmer Maggot", level: 2, speed: 120, raceFlags: ["UNIQUE", "RAND_25"] };

  it("waits a few turns for the only way to clear, then skips that shop for the visit", () => {
    const w = world({ map: ["#####", "#@.A#", "#####"], player: { cls: "Warrior", depth: 0, gold: 100 }, pack: [], monsters: [maggot], worn: ["a Wooden Torch (5000 turns)"] });
    const visited = new Set<number>();
    const plan = townTripPlan(w.terrain, defaultPersona(), visited);
    for (let i = 0; i < 5; i += 1) expect(plan.step(w.view, w.act)).toMatchObject({ code: "hold" });
    expect(plan.step(w.view, w.act)).toBeNull();
    expect(visited.size).toBe(1);
  });

  it("walks around a townsperson when the street is wide enough", () => {
    const w = world({ map: ["#####", "#...#", "#@.A#", "#...#", "#####"], player: { cls: "Warrior", depth: 0, gold: 100 }, pack: [], monsters: [{ ...maggot, grid: { x: 2, y: 2 } }], worn: ["a Wooden Torch (5000 turns)"] });
    const plan = townTripPlan(w.terrain, defaultPersona());
    expect(plan.step(w.view, w.act)).toMatchObject({ code: "walk" });
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
    w.setPack(["2 Potions of Cure Light Wounds"]);
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

  it("marks a store done when a purchase changes neither pack nor gold", () => {
    const store: StoreView = { feat: FEAT.ALCHEMY, featName: "Alchemy Shop", isHome: false, owner: { name: "Mauser", purse: 10000 }, stock: [
      { ...itemNamed("a Potion of Cure Light Wounds", 0), index: 0, price: 20, number: 10 },
    ] };
    const w = world({ map: ["#####", "#@.A#", "#####"], player: { cls: "Warrior", level: 1, depth: 0, gold: 100 }, pack: ["a Wooden Torch (5000 turns)"], worn: ["a Wooden Torch (5000 turns)"], stores: [store] });
    const plan = townTripPlan(w.terrain, defaultPersona());
    expect(plan.step(w.view, w.act)).toEqual({ code: "walk", dir: 6 });
    w.moveTo({ x: 3, y: 1 });
    expect(plan.step(w.view, w.act)).toMatchObject({ code: "shop-buy" });
    expect(plan.step(w.view, w.act)).toEqual({ code: "shop-exit" });
    expect(plan.step(w.view, w.act)).toBeNull();
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
    /* The sale paid out, so the step is not a no-op, yet the pack still lists the dagger. */
    w.setPlayer({ gold: 5 });
    expect(plan.step(w.view, w.act)).not.toEqual({ code: "shop-sell", args: { handle: 2, quantity: 1 } });
  });

  it("counts a withdrawal that lands in the quiver as a change", () => {
    const home: StoreView = { feat: FEAT.HOME, featName: "Home", isHome: true, owner: { name: "Squire", purse: 0 }, stock: [
      { ...itemNamed("a Potion of Cure Light Wounds", 0), index: 0, price: 0, number: 5 },
      { ...itemNamed("a Scroll of Phase Door", 0), index: 1, price: 0, number: 5 },
    ] };
    const w = world({ map: ["#####", "#@.H#", "#####"], player: { cls: "Warrior", depth: 0, gold: 100 }, pack: [], stores: [home], worn: ["a Wooden Torch (5000 turns)"] });
    const plan = townTripPlan(w.terrain, defaultPersona(), new Set(), () => {}, [], emptyFlourishes, undefined, undefined, UNKNOWN_HOME, () => {});
    plan.step(w.view, w.act);
    w.moveTo({ x: 3, y: 1 });
    expect(plan.step(w.view, w.act)).toMatchObject({ code: "shop-buy", args: { index: 0 } });
    /* Only the quiver changes, as it does when the home hands over ammo. */
    Object.assign(w.view, { quiver: () => [itemNamed("20 Iron Shots", 200)] });
    expect(plan.step(w.view, w.act)).toMatchObject({ code: "shop-buy", args: { index: 1 } });
  });
});
