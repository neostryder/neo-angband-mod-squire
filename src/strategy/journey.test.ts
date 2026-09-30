import { describe, expect, it } from "vitest";
import type { AgentView, StoreView } from "@rpgm-tools/neo-angband-core";
import { FEAT, itemNamed, suppliedWorld, world } from "../harness.js";
import { defaultCfg } from "../settings.js";
import { newProgress } from "../progress.js";
import { createGoalPlanner, type Goal, type Offer } from "../brain/goals.js";
import { candidateAims } from "./aims.js";
import { createJourney } from "./journey.js";

const ROOM = ["########", "#<@...>#", "########"];
const RESERVES = ["3 Potions of Cure Light Wounds", "3 Scrolls of Phase Door", "5 Rations of Food", "2 Wooden Torches"];

function offers(...goals: Goal[]): Offer[] {
  return goals.map((goal) => ({ goal, criteria: goal, risk: 0.02 }));
}

function goals(w: ReturnType<typeof world>, journey = createJourney(w.terrain), recalling = false, base = offers("explore", "descend", "recall_town", "wait", "rest", "fight")) {
  return journey.apply(base, w.view, null, new Set(), recalling).map((offer) => offer.goal);
}

describe("journey offer and execution guards", () => {
  const breeders = [5, 6, 7].map((x, index) => ({ grid: { x, y: 1 }, race: index === 2 ? "giant white mouse" : "white worm mass", raceFlags: ["MULTIPLY"] }));

  it("keeps the young Mage's aggregate breeder exit after sight and mana change", () => {
    const w = suppliedWorld({ map: ["##########", "#<@......#", "##########"], player: { cls: "Mage", level: 2, hp: 16, maxHp: 16, sp: 0, maxSp: 4 }, monsters: breeders });
    const journey = createJourney(w.terrain);
    expect(goals(w, journey)).not.toEqual(expect.arrayContaining(["fight", "rest", "explore", "descend"]));
    expect(journey.breederExit(w.view)).toBe(true);
    w.setMonsters([]);
    w.setPlayer({ level: 6, sp: 4 });
    expect(goals(w, journey)).toContain("leave_level");
    expect(goals(w, journey)).not.toContain("rest");
    const rest = journey.guarded("rest", { label: "rest", step: (_view, act) => act.rest() });
    expect(rest.step(w.view, w.act)).toBeNull();
    w.setPlayer({ depth: 2 });
    expect(journey.breederExit(w.view)).toBe(false);
  });

  it("counts awake breeders and keeps the early threshold limited to levels 1 through 5", () => {
    const w = suppliedWorld({ map: ["##########", "#<@......#", "##########"], player: { level: 5 }, monsters: breeders.map((monster, index) => ({ ...monster, asleep: index === 2 })) });
    const journey = createJourney(w.terrain);
    expect(journey.breederExit(w.view)).toBe(false);
    w.setPlayer({ level: 6 });
    w.setMonsters(breeders);
    expect(journey.breederExit(w.view)).toBe(false);
    w.setPlayer({ level: 5 });
    expect(journey.breederExit(w.view)).toBe(true);
  });

  it("stops an optional plan when the third breeder appears", () => {
    const w = suppliedWorld({ map: ["##########", "#<@......#", "##########"], player: { level: 2 }, monsters: breeders.slice(0, 2) });
    const journey = createJourney(w.terrain);
    goals(w, journey);
    const plan = journey.guarded("fetch", { label: "fetch", step: (_view, act) => act.move(6) });
    w.setMonsters(breeders);
    expect(plan.step(w.view, w.act)).toBeNull();
  });

  it("retains attacks that clear adjacent contact while suppressing distant pursuit", () => {
    const w = suppliedWorld({ map: ["##########", "#<@......#", "##########"], player: { level: 2 }, monsters: [{ ...breeders[0]!, grid: { x: 3, y: 1 } }, ...breeders.slice(1)] });
    const journey = createJourney(w.terrain);
    expect(goals(w, journey)).toContain("fight");
    w.setMonsters(breeders);
    expect(goals(w, journey)).not.toContain("fight");
  });

  it("blocks both descent and dungeon Recall for the unsupplied town character", () => {
    const w = world({ map: ROOM, player: { depth: 0, maxDepth: 2, level: 1, maxLevel: 1, hp: 20, maxHp: 20 }, pack: ["a Scroll of Word of Recall"] });
    expect(goals(w, undefined, false, offers("descend", "recall_dungeon"))).toEqual([]);
  });

  it("checks the actual Recall landing depth, rather than a shallower fraction", () => {
    const w = suppliedWorld({ map: ROOM, player: { depth: 0, maxDepth: 3, level: 2, maxLevel: 2, hp: 30, maxHp: 30 }, pack: ["a Scroll of Word of Recall"] });
    expect(goals(w, undefined, false, offers("descend", "recall_dungeon"))).toEqual(["descend"]);
    w.setPlayer({ maxDepth: 2 });
    expect(goals(w, undefined, false, offers("recall_dungeon"))).toEqual(["recall_dungeon"]);
  });

  it("rechecks maximum HP before a previously eligible descent command", () => {
    const w = suppliedWorld({ map: ROOM, player: { level: 2, maxLevel: 2, hp: 30, maxHp: 30 } });
    const journey = createJourney(w.terrain);
    expect(goals(w, journey)).toContain("descend");
    const plan = journey.guarded("descend", { label: "descend", step: (_view, act) => act.descend() });
    w.setPlayer({ maxHp: 20 });
    expect(plan.step(w.view, w.act)).toBeNull();
  });

  it("starts the Ranger's shallow return while healing remains, without Recall or gold", () => {
    const w = world({ map: ROOM, player: { cls: "Ranger", level: 2, maxLevel: 2, hp: 24, maxHp: 24, gold: 0 }, pack: ["a Potion of Cure Light Wounds", ...RESERVES.slice(1)] });
    const journey = createJourney(w.terrain);
    const available = goals(w, journey);
    expect(available).toContain("leave_level");
    expect(available).not.toContain("descend");
    expect(available).not.toContain("explore");
    const plan = journey.guarded("leave_level", { label: "leave", step: () => null });
    expect(plan.step(w.view, w.act)).toEqual({ code: "walk", dir: 4 });
    w.moveTo({ x: 1, y: 1 });
    expect(plan.step(w.view, w.act)).toEqual({ code: "ascend" });
  });

  it("keeps a return aimed at town across an ascent even if the shallower margin is better", () => {
    const w = world({ map: ROOM, player: { depth: 6, maxDepth: 6, maxLevel: 10 }, pack: ["2 Potions of Cure Light Wounds", ...RESERVES.slice(1)] });
    const journey = createJourney(w.terrain);
    expect(goals(w, journey)).toContain("leave_level");
    w.setPlayer({ depth: 5 });
    const available = goals(w, journey);
    expect(available).toContain("leave_level");
    expect(available).not.toContain("explore");
  });

  it("never forces the recorded Ranger to wait for Recall beside Grip", () => {
    const w = world({ map: ROOM, player: { cls: "Ranger", level: 1, maxLevel: 1, hp: 1, maxHp: 15 }, monsters: [{ grid: { x: 3, y: 1 }, race: "Grip, Farmer Maggot's Dog", speed: 120, raceFlags: ["UNIQUE"] }], pack: ["a Potion of Cure Light Wounds", "a Scroll of Phase Door"] });
    const journey = createJourney(w.terrain);
    const available = goals(w, journey, true, offers("wait", "rest", "heal", "phase", "fight"));
    expect(available).toEqual(["heal", "phase", "fight"]);
    const plan = journey.guarded("wait", { label: "wait", step: (_view, act) => act.hold() });
    expect(plan.step(w.view, w.act)).toBeNull();
  });

  it("keeps a calm pending Recall wait but cancels it when an attacker appears", () => {
    const w = suppliedWorld({ map: ROOM });
    const journey = createJourney(w.terrain);
    expect(goals(w, journey, true)).toContain("wait");
    const plan = journey.guarded("wait", { label: "wait", step: (_view, act) => act.hold() });
    w.setMonsters([{ grid: { x: 5, y: 1 }, race: "apprentice", spellFlags: ["BO_FIRE"] }]);
    expect(plan.step(w.view, w.act)).toBeNull();
  });

  it("rejects a pending Recall wait on harmful ground", () => {
    const w = suppliedWorld({ map: ["#####", "#@~>#", "#####"] });
    w.moveTo({ x: 2, y: 1 });
    expect(goals(w, undefined, true)).not.toContain("wait");
  });

  it("rejects pending-Recall rest near a sleeping breeder and after unexplained damage", () => {
    const w = suppliedWorld({ map: ROOM, monsters: [{ grid: { x: 5, y: 1 }, race: "white worm mass", asleep: true, raceFlags: ["MULTIPLY"] }] });
    const journey = createJourney(w.terrain);
    expect(goals(w, journey, true)).not.toContain("rest");
    w.setMonsters([]);
    goals(w, journey, true);
    w.setPlayer({ hp: 59 });
    expect(goals(w, journey, true)).not.toContain("wait");
    w.advance(101);
    expect(goals(w, journey, true)).toContain("wait");
  });

  it("retains a recently seen attacker that leaves sight during Recall", () => {
    const w = suppliedWorld({ map: ROOM, monsters: [{ grid: { x: 5, y: 1 }, race: "fruit bat" }] });
    const journey = createJourney(w.terrain);
    goals(w, journey, true);
    w.setMonsters([{ grid: { x: 5, y: 1 }, race: "fruit bat", visible: false }]);
    expect(goals(w, journey, true)).not.toContain("wait");
    w.advance(101);
    expect(goals(w, journey, true)).toContain("wait");
  });

  it.each(["door", "trap", "enemy"])("rejects a walking return obstructed by a %s", (obstruction) => {
    const map = obstruction === "door" ? ["########", "#<+@..>#", "########"] : ROOM;
    const w = world({ map, pack: ["a Potion of Cure Light Wounds", ...RESERVES.slice(1)] });
    if (obstruction === "trap") w.setTraps([{ x: 1, y: 1 }]);
    if (obstruction === "enemy") w.setMonsters([{ grid: { x: 5, y: 1 }, race: "unknown attacker", spellFlags: [] }]);
    expect(goals(w, undefined, false, offers("explore", "descend"))).not.toContain("leave_level");
  });

  it("does not create an unsafe fallback wait when pending Recall's combat offers are stalled", () => {
    const w = world({ map: ROOM, player: { hp: 1, maxHp: 15, recall: 12 } as never, monsters: [{ grid: { x: 3, y: 1 }, race: "Grip", speed: 120, raceFlags: ["UNIQUE"] }] });
    const p = createGoalPlanner({ cfg: defaultCfg(), terrain: w.terrain, log: () => {}, reflex: false });
    for (let attempt = 0; attempt < 6; attempt += 1) {
      const q = p.ask(w.view);
      if ("handBack" in q) break;
      expect(q.context.offers.map((offer) => offer.goal)).not.toContain("wait");
      const pick = q.context.offers[0]?.goal;
      if (pick === undefined) break;
      const choice = p.choose({ goal: { type: "choice", choice: pick, confidence: 1, probabilities: { [pick]: 1 } } }, q.context, w.view);
      if ("plan" in choice) {
        choice.plan.step(w.view, w.act);
        choice.plan.step(w.view, w.act);
      }
    }
  });
});

describe("bounded exploration and earning", () => {
  it("stops optional exploration and offers only a prepared deeper or safer level after the budget", () => {
    const w = suppliedWorld({ map: ROOM, player: { level: 1, maxLevel: 1, hp: 20, maxHp: 20 } });
    const journey = createJourney(w.terrain);
    goals(w, journey);
    w.advance(500);
    const available = goals(w, journey);
    expect(available).toContain("leave_level");
    expect(available).not.toContain("descend");
    expect(available).not.toContain("explore");
  });

  it("keeps a prepared descent available when the level budget runs out", () => {
    const w = suppliedWorld({ map: ROOM, player: { level: 2, maxLevel: 2, hp: 30, maxHp: 30 } });
    const journey = createJourney(w.terrain);
    goals(w, journey);
    w.advance(1000);
    expect(goals(w, journey)).toEqual(expect.arrayContaining(["descend", "leave_level"]));
  });

  it("uses path steps rather than straight-line distance for the early leash", () => {
    const w = suppliedWorld({ map: ["################", "#<.............#", "##############.#", "#@.............#", "################"], player: { level: 1, maxLevel: 1 } });
    const journey = createJourney(w.terrain);
    journey.apply([], w.view, null, new Set(), false);
    expect(journey.leashed(w.view, { x: 1, y: 3 })).toBe(false);
    expect(journey.leashed(w.view, { x: 13, y: 1 })).toBe(true);
    expect(journey.leashed(w.view, { x: 14, y: 1 })).toBe(false);
  });

  it("withholds remote loot and stops an existing explore plan at the leash", () => {
    const w = suppliedWorld({ map: ["##################", "#<@............  #", "##################"], player: { level: 1, maxLevel: 1 }, floor: [{ x: 15, y: 1, name: "a Potion of Cure Light Wounds" }] });
    const journey = createJourney(w.terrain);
    expect(goals(w, journey, false, offers("fetch", "explore"))).toEqual([]);
    w.moveTo({ x: 13, y: 1 });
    expect(journey.explore({ view: w.view, act: w.act, terrain: w.terrain, cfg: defaultCfg(), progress: newProgress(1), log: () => {} })).toBeNull();
  });

  it("offers a six-step depth 1 earning trip with food and fuel when gold cannot buy the missing basket", () => {
    const w = world({ map: ROOM, player: { depth: 0, gold: 0, level: 1, maxLevel: 1, hp: 20, maxHp: 20 }, pack: ["5 Rations of Food", "2 Wooden Torches"] });
    const journey = createJourney(w.terrain);
    const available = journey.apply(offers("descend", "recall_dungeon"), w.view, null, new Set(), false);
    expect(available.map((offer) => offer.goal)).toEqual(["descend"]);
    expect(available[0]?.criteria).toContain("500 game turns");
    const plan = journey.guarded("descend", { label: "descend", step: (_view, act) => act.descend() });
    expect(plan.step(w.view, w.act)?.code).toBe("descend");
    w.setPlayer({ depth: 1 });
    expect(goals(w, journey, false, offers("descend"))).not.toContain("descend");
    w.advance(500);
    expect(goals(w, journey, false, offers("explore"))).toEqual(["leave_level"]);
  });

  it("does not repeat an earning trip that returned with no gold gain", () => {
    const w = world({ map: ROOM, player: { depth: 0, gold: 0 }, pack: ["5 Rations of Food", "2 Wooden Torches"] });
    const journey = createJourney(w.terrain);
    goals(w, journey, false, offers("descend"));
    journey.guarded("descend", { label: "descend", step: (_view, act) => act.descend() }).step(w.view, w.act);
    w.setPlayer({ depth: 1 });
    goals(w, journey);
    w.setPlayer({ depth: 0 });
    expect(goals(w, journey, false, offers("descend"))).toEqual([]);
    w.setPlayer({ gold: 1 });
    expect(goals(w, journey, false, offers("descend"))).toEqual(["descend"]);
  });

  it("blocks an earning departure when food or working light is missing", () => {
    const w = world({ map: ROOM, player: { depth: 0, gold: 0 }, pack: [] });
    expect(goals(w, undefined, false, offers("descend"))).toEqual([]);
  });

  it("does not read unseen shop stock while evaluating town departure", () => {
    const w = world({ map: ["######", "#@.A>#", "######"], player: { depth: 0, gold: 100 }, pack: ["5 Rations of Food", "2 Wooden Torches"] });
    const view: AgentView = { ...w.view, stores: () => { throw new Error("stock outside the entered shop"); } };
    const journey = createJourney(w.terrain);
    expect(journey.apply(offers("shop", "descend"), view, null, new Set(), false).map((offer) => offer.goal)).toEqual(["shop"]);
  });

  it("stops a fallback descent that would bypass the maximum-HP guard", () => {
    const w = world({ map: ROOM, player: { level: 1, maxLevel: 1, maxHp: 20 } });
    const journey = createJourney(w.terrain);
    goals(w, journey);
    expect(journey.guarded(null, { label: "fallback", step: (_view, act) => act.descend() }).step(w.view, w.act)).toBeNull();
  });
});

/* The soak's town: a known down staircase across ground the character has not seen yet, as the town is at night. */
const DARK_TOWN = ["############", "#G.A.,,,...#", "#..@.,,,.>.#", "#U.W.,,,...#", "############"];
/* A lit town with the staircase in reach but unexplored ground left elsewhere. */
const LIT_TOWN = ["############", "#G.A.....>.#", "#..@.......#", "#U.W.......#", "#,,,,......#", "############"];
const WARRIOR = { cls: "Warrior", depth: 0, maxDepth: 0, level: 1, maxLevel: 1, hp: 20, maxHp: 20, exp: 0 };
const WARRIOR_PACK = ["2 Rations of Food", "2 Potions of Cure Light Wounds", "a Potion of Berserk Strength", "2 Scrolls of Phase Door", "a Scroll of Word of Recall", "2 Wooden Torches (5000 turns)"];
const WORN = ["a Wooden Torch (5000 turns)", "a Tulwar (2d4)", "Soft Leather Armour [8]"];
const KEYPAD: Readonly<Record<number, readonly [number, number]>> = { 1: [-1, 1], 2: [0, 1], 3: [1, 1], 4: [-1, 0], 6: [1, 0], 7: [-1, -1], 8: [0, -1], 9: [1, -1] };

function aimedPlanner(w: ReturnType<typeof world>) {
  return createGoalPlanner({ cfg: defaultCfg(), terrain: w.terrain, log: () => {}, reflex: false, strategy: () => ({ aims: candidateAims(w.view), tripAllowed: () => true }) });
}

/** Play the town the way the soak did: shop while a shop is offered, otherwise take the first offer, and light the grids around each step. */
function leaveTown(w: ReturnType<typeof world>, limit = 30): { readonly descend: Offer | null; readonly trail: string[]; readonly handBack: string | null } {
  const p = aimedPlanner(w);
  const trail: string[] = [];
  for (let decision = 0; decision < limit; decision += 1) {
    const q = p.ask(w.view);
    if ("handBack" in q) return { descend: null, trail, handBack: q.handBack };
    const goals = q.context.offers.map((offer) => offer.goal);
    trail.push(goals.join(","));
    const descend = q.context.offers.find((offer) => offer.goal === "descend");
    if (descend !== undefined) return { descend, trail, handBack: null };
    const pick = goals.includes("shop") ? "shop" : goals[0]!;
    const choice = p.choose({ goal: { type: "choice", choice: pick, confidence: 1, probabilities: { [pick]: 1 } } }, q.context, w.view);
    if (!("plan" in choice)) return { descend: null, trail, handBack: choice.handBack };
    for (let step = 0; step < 60; step += 1) {
      const command = choice.plan.step(w.view, w.act);
      if (command === null) break;
      const dir = command.code === "walk" ? KEYPAD[(command as { dir?: number }).dir ?? 0] : undefined;
      if (dir !== undefined) {
        const at = { x: w.view.player().grid.x + dir[0], y: w.view.player().grid.y + dir[1] };
        w.moveTo(at);
        for (let dy = -1; dy <= 1; dy += 1) for (let dx = -1; dx <= 1; dx += 1) w.reveal({ x: at.x + dx, y: at.y + dy });
      }
      w.advance(10);
    }
  }
  return { descend: null, trail, handBack: null };
}

describe("leaving town ready", () => {
  it("walks the recorded level 1 Warrior across dark town ground to the known staircase and offers the descent", () => {
    const w = world({ map: DARK_TOWN, player: { ...WARRIOR, gold: 0 }, pack: WARRIOR_PACK, worn: WORN });
    const out = leaveTown(w);
    expect(out.handBack).toBeNull();
    expect(out.trail[0]).toBe("explore");
    expect(out.descend?.criteria).not.toContain("Earn gold");
    expect(out.trail.some((goals) => goals.includes("wait"))).toBe(false);
  });

  it("offers the recorded Warrior the stairs, not a town walk that stops at once, after shopping with gold left", () => {
    const w = world({ map: LIT_TOWN, player: { ...WARRIOR, gold: 30 }, pack: WARRIOR_PACK, worn: WORN });
    const out = leaveTown(w);
    expect(out.trail[0]).toContain("shop");
    expect(out.descend).not.toBeNull();
    expect(out.trail.at(-1)?.split(",")).not.toContain("explore");
  });

  it("takes the recorded Rogue down after it bought Cure Light Wounds and Phase Door", () => {
    const w = world({ map: DARK_TOWN, player: { cls: "Rogue", depth: 0, maxDepth: 0, level: 1, maxLevel: 1, hp: 14, maxHp: 14, exp: 0, gold: 20 }, pack: ["2 Potions of Cure Light Wounds", "2 Scrolls of Phase Door", "3 Rations of Food", "2 Wooden Torches (5000 turns)"], worn: WORN });
    const out = leaveTown(w);
    expect(out.handBack).toBeNull();
    expect(out.trail[0]).toContain("shop");
    expect(out.descend?.criteria).not.toContain("Earn gold");
  });

  it("still goes down to earn when the town cannot sell it the missing healing it wants", () => {
    const alchemy: StoreView = { feat: FEAT.ALCHEMY, featName: "Alchemy Shop", isHome: false, owner: { name: "Mauser", purse: 10000 }, stock: [
      { ...itemNamed("a Potion of Cure Light Wounds", 0), index: 0, price: 20, number: 8 },
    ] };
    const w = world({ map: DARK_TOWN, player: { ...WARRIOR, gold: 5 }, pack: ["2 Rations of Food", "2 Scrolls of Phase Door", "2 Wooden Torches (5000 turns)"], worn: WORN, stores: [alchemy] });
    const out = leaveTown(w);
    expect(out.handBack).toBeNull();
    expect(out.descend?.criteria).toContain("Earn gold on dungeon level 1 for the missing two healing potions");
  });
});
