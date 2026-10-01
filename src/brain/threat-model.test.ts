import { describe, expect, it } from "vitest";
import type { AgentView, LoadoutSimulation } from "@rpgm-tools/neo-angband-core";
import { turnEnergy } from "@rpgm-tools/neo-angband-core";
import { world } from "../harness.js";
import { assessThreat, bestBallAim, clearShot, incomingDamage, inspecting, knownCapability, monsterActions, pickAttackSpell, threatWindow, unseenDamageAt, type InspectingView } from "./threat-model.js";
import { createGoalPlanner } from "./goals.js";
import { defaultCfg } from "../settings.js";

const MAP = ["#########", "#.@.....#", "#########"];
/* The views here are the harness's, which never check an input token. */
const token = {};

function recall(view: AgentView, text: string): void {
  Object.assign(view, { monsterRecall: () => ({ token, title: "veteran", text }) });
}

describe("threat model", () => {
  it("prices an unseen hit at each candidate square and lets it decay", () => {
    const w = world({ map: MAP });
    const hit = { grid: w.at(), damage: 12, turn: w.view.turn() };
    const facts = { unseenHit: hit };
    expect(incomingDamage(w.view, w.at(), 2, w.terrain, facts)).toEqual({ damage: 24, uncertainty: 24, status: 0 });
    expect(incomingDamage(w.view, { x: 3, y: 1 }, 1, w.terrain, facts).damage).toBe(9);
    w.advance(25);
    expect(incomingDamage(w.view, w.at(), 1, w.terrain, facts).damage).toBeLessThan(12);
    expect(unseenDamageAt(hit, { x: 8, y: 1 }, w.view.turn())).toBe(0);
    expect(unseenDamageAt(hit, w.at(), hit.turn - 1)).toBe(0);
    w.advance(26);
    expect(incomingDamage(w.view, w.at(), 2, w.terrain, facts).damage).toBe(0);
  });
  it("uses known blow dice rather than level and reads known spells and breeding", () => {
    expect(knownCapability("He can hit to hurt (2d8, 50%) and kick to hurt (1d6, 30%), averaging 2 damage on each of his turns. He may breathe fire (22). He breeds explosively.", 0))
      .toEqual({ round: 22, spell: 22, breeds: true, knownBlows: true });
    expect(knownCapability("Nothing is known about his attack.", 0).round).toBe(8);
  });

  it("rates a healthy level 1 mage against a town veteran before the first hit", () => {
    const w = world({ map: MAP, player: { level: 1, cls: "Mage", hp: 12, maxHp: 12 }, monsters: [{ grid: { x: 3, y: 1 }, race: "battle-scarred veteran", level: 0 }] });
    recall(w.view, "He can hit to hurt (2d8, 50%), averaging 8 damage on each of his turns.");
    const rating = assessThreat(w.view.monsters()[0]!, w.view.player(), w.view.monsters(), w.view);
    expect(rating.round).toBe(16);
    expect(rating.capability).toBe(1);
    expect(rating.band).toBeGreaterThanOrEqual(2);
    expect(rating.description).toContain("up to 16 a round");
    const q = createGoalPlanner({ cfg: defaultCfg(), terrain: w.terrain, log: () => undefined, reflex: false }).ask(w.view);
    if (!("request" in q)) throw new Error("expected a question");
    expect(String(q.request.state["creatures"])).toContain("hits hard for a level 1 mage (up to 16 a round), dangerous");
  });

  it("raises lethality with lost health, crowd and faster enemies", () => {
    const w = world({ map: MAP, player: { level: 10, hp: 40, maxHp: 40 }, monsters: [{ grid: { x: 3, y: 1 }, race: "veteran", level: 0 }] });
    recall(w.view, "He can hit to hurt (2d6, 40%).");
    const rating = () => assessThreat(w.view.monsters()[0]!, w.view.player(), w.view.monsters(), w.view);
    const fresh = rating().band;
    w.setPlayer({ hp: 16 });
    const hurt = rating().band;
    w.setMonsters([{ grid: { x: 3, y: 1 }, race: "veteran", level: 0, speed: 130 }, { grid: { x: 4, y: 1 }, race: "veteran", level: 0 }]);
    expect(fresh).toBeLessThan(hurt);
    expect(hurt).toBeLessThan(rating().band);
  });

  it("uses the two-action fallback without recall", () => {
    const w = world({ map: MAP, player: { level: 1, hp: 10 }, monsters: [{ grid: { x: 3, y: 1 }, level: 0 }] });
    expect(assessThreat(w.view.monsters()[0]!, w.view.player(), w.view.monsters(), w.view).band).toBe(1);
  });

  it("does not call a townsperson with unseen blows dangerous to a lightly hurt priest", () => {
    /* The soak's Priest in town: a beggar beside it at 7 of 13 hit points, and a mercenary 4 steps off at full health. */
    const w = world({
      map: ["##########", "#.@......#", "##########"],
      player: { level: 1, cls: "Priest", hp: 7, maxHp: 13, depth: 0, maxDepth: 1 },
      monsters: [{ grid: { x: 3, y: 1 }, race: "pitiful-looking wretch", level: 0 }],
    });
    recall(w.view, "Nothing is known about his attack.");
    const rate = () => assessThreat(w.view.monsters()[0]!, w.view.player(), w.view.monsters(), w.view).band;
    expect(rate()).toBe(1);
    w.setPlayer({ hp: 13 });
    w.setMonsters([{ grid: { x: 6, y: 1 }, race: "mean-looking mercenary", level: 0 }]);
    expect(rate()).toBe(0);
    w.setPlayer({ hp: 3 });
    expect(rate()).toBe(0);
    w.setMonsters([{ grid: { x: 3, y: 1 }, race: "mean-looking mercenary", level: 0 }]);
    expect(rate()).toBeGreaterThanOrEqual(2);
  });

  it("keeps the dungeon's estimate for a level 0 creature below town", () => {
    const w = world({ map: MAP, player: { level: 1, hp: 7, maxHp: 13 }, monsters: [{ grid: { x: 3, y: 1 }, level: 0 }] });
    recall(w.view, "Nothing is known about his attack.");
    expect(assessThreat(w.view.monsters()[0]!, w.view.player(), w.view.monsters(), w.view).band).toBe(2);
  });
});

describe("incoming damage windows", () => {
  const grip = { grid: { x: 3, y: 1 }, level: 2, speed: 120, race: "Grip, Farmer Maggot's Dog", raceFlags: ["UNIQUE"] };

  it("counts two bites in one action and four in two against the recorded dog", () => {
    const w = world({ map: MAP, player: { level: 1, hp: 1, maxHp: 14 }, monsters: [grip], monsterRecall: () => "He can bite to hurt (1d4, 50%)." });
    const incoming = threatWindow(w.view, w.view.player().grid, w.terrain);
    expect(incoming.one.damage).toBe(8);
    expect(incoming.two.damage).toBe(16);
    expect(incoming.one.uncertainty).toBe(0);
  });

  it("lets a fast enemy move and attack before adjacency", () => {
    const w = world({ map: MAP, monsters: [{ ...grip, grid: { x: 4, y: 1 } }], monsterRecall: () => "He can bite to hurt (1d4, 50%)." });
    expect(threatWindow(w.view, undefined, w.terrain).one.damage).toBe(4);
    w.setMonsters([{ ...grip, grid: { x: 4, y: 1 }, speed: 110 }]);
    expect(threatWindow(w.view, undefined, w.terrain).one.damage).toBe(0);
    expect(threatWindow(w.view, undefined, w.terrain).two.damage).toBe(4);
  });

  it("uses energy ratios beyond the old doubling cap", () => {
    const w = world({ map: MAP, monsters: [{ ...grip, speed: 130 }] });
    expect(monsterActions(w.view.monsters()[0]!, w.view.player(), 1)).toBe(3);
    expect(monsterActions(w.view.monsters()[0]!, w.view.player(), 2)).toBe(6);
    w.setPlayer({ speed: 100 });
    expect(monsterActions(w.view.monsters()[0]!, w.view.player(), 1)).toBe(6);
  });

  it("uses the supplied host table and keeps the fallback above actual action counts", () => {
    const w = world({ map: MAP, player: { speed: 140 }, monsters: [{ ...grip, speed: 140 }], monsterRecall: () => "He can bite to hurt (1d4, 50%)." });
    expect(incomingDamage(w.view, undefined, 1, w.terrain, { energy: turnEnergy }).damage).toBe(4);
    expect(incomingDamage(w.view, undefined, 1, w.terrain).damage).toBe(8);
    for (let playerSpeed = 0; playerSpeed < 200; playerSpeed += 1) {
      for (let monsterSpeed = 0; monsterSpeed < 200; monsterSpeed += 1) {
        expect(monsterActions({ ...w.view.monsters()[0]!, speed: monsterSpeed }, { ...w.view.player(), speed: playerSpeed }, 2)).toBeGreaterThanOrEqual(monsterActions({ ...w.view.monsters()[0]!, speed: monsterSpeed }, { ...w.view.player(), speed: playerSpeed }, 2, turnEnergy));
      }
    }
  });

  it("retains a damage fallback and uncertainty for unseen blows and magic", () => {
    const w = world({ map: MAP, monsters: [{ grid: { x: 7, y: 1 }, level: 2, spellFlags: ["BO_FIRE"], raceFlags: ["NEVER_BLOW"] }] });
    const incoming = incomingDamage(w.view, undefined, 1, w.terrain);
    expect(incoming.damage).toBe(14);
    expect(incoming.uncertainty).toBeGreaterThan(0);
  });

  it("prices a candidate independently of the current square", () => {
    const w = world({ map: MAP, monsters: [{ ...grip, grid: { x: 4, y: 1 } }], monsterRecall: () => "He can bite to hurt (1d4, 50%)." });
    expect(incomingDamage(w.view, { x: 1, y: 1 }, 1, w.terrain).damage).toBe(0);
    expect(incomingDamage(w.view, { x: 3, y: 1 }, 1, w.terrain).damage).toBe(8);
  });

  it("counts reachable attack slots rather than every corridor occupant", () => {
    const w = world({ map: MAP, monsters: [3, 4, 5].map((x) => ({ grid: { x, y: 1 }, level: 0 })), monsterRecall: () => "It can hit to hurt (1d6, 50%)." });
    expect(threatWindow(w.view, undefined, w.terrain).one.damage).toBe(6);
    expect(threatWindow(w.view, undefined, w.terrain).two.damage).toBe(12);
  });

  it("blocks known walls and charges a monster's door opening", () => {
    const w = world({ map: ["#########", "#.@+....#", "#########"], monsters: [{ grid: { x: 4, y: 1 }, level: 0, speed: 120, raceFlags: ["OPEN_DOOR"] }], monsterRecall: () => "It can bite to hurt (1d4, 50%)." });
    expect(threatWindow(w.view, undefined, w.terrain).one.damage).toBe(0);
    expect(threatWindow(w.view, undefined, w.terrain).two.damage).toBe(8);
    w.setMonsters([{ grid: { x: 4, y: 1 }, level: 0, speed: 120 }]);
    expect(threatWindow(w.view, undefined, w.terrain).two.damage).toBe(0);
  });

  it("counts ranged attacks around a corner when speed buys the approach", () => {
    const w = world({ map: ["#######", "#.@...#", "#...#.#", "#.....#", "#######"], monsters: [{ grid: { x: 5, y: 3 }, speed: 130, level: 0, raceFlags: ["NEVER_BLOW"] }], monsterRecall: () => "It may cast spells which produce fire bolts (12)." });
    expect(incomingDamage(w.view, undefined, 1, w.terrain).damage).toBeGreaterThan(0);
  });

  it("blocks bolts on another creature and lets a breath cross it", () => {
    const w = world({ map: MAP, monsters: [{ grid: { x: 6, y: 1 }, raceIndex: 1, raceFlags: ["NEVER_BLOW", "NEVER_MOVE"] }, { grid: { x: 4, y: 1 }, raceIndex: 2, raceFlags: ["NEVER_BLOW", "NEVER_MOVE"] }], monsterRecall: (index) => index === 1 ? "It may cast spells which produce fire bolts (12)." : "Its attacks are unknown." });
    expect(incomingDamage(w.view, undefined, 1, w.terrain).damage).toBe(0);
    Object.assign(w.view, { monsterRecall: (index: number) => ({ text: index === 1 ? "It may breathe fire (12)." : "Its attacks are unknown." }) });
    expect(incomingDamage(w.view, undefined, 1, w.terrain).damage).toBe(12);
  });

  it("applies permanent resistance, opposition, immunity and vulnerability", () => {
    const w = world({ map: MAP, monsters: [{ grid: { x: 6, y: 1 }, level: 0, raceFlags: ["NEVER_BLOW", "NEVER_MOVE"] }], monsterRecall: () => "It may breathe fire (12)." });
    let resistance = 1;
    Object.assign(w.view, { simulateLoadout: () => ({ before: { stats: { resistElements: ["FIRE"], resists: [resistance] } } } as unknown as LoadoutSimulation) });
    expect(incomingDamage(w.view).damage).toBe(4);
    resistance = 2;
    w.setPlayer({ status: { resFire: 10 } });
    expect(incomingDamage(w.view).damage).toBe(2);
    resistance = 3;
    expect(incomingDamage(w.view).damage).toBe(0);
    resistance = -1;
    w.setPlayer({ status: { resFire: 0 } });
    expect(incomingDamage(w.view).damage).toBe(16);
  });

  it("retains physical melee damage when resistance protects the element", () => {
    const w = world({ map: MAP, player: { status: { resFire: 10 } }, monsters: [{ grid: { x: 3, y: 1 }, level: 0 }], monsterRecall: () => "It can bite to burn with fire (2d6, 50%)." });
    expect(incomingDamage(w.view).damage).toBe(12);
  });

  it.each(["BASH_DOOR", "KILL_WALL", "SMASH_WALL"])("charges movement once for %s", (flag) => {
    const w = world({ map: ["#########", "#.@+....#", "#########"], monsters: [{ grid: { x: 4, y: 1 }, level: 0, speed: 120, raceFlags: [flag] }], monsterRecall: () => "It can bite to hurt (1d4, 50%)." });
    expect(incomingDamage(w.view, undefined, 1, w.terrain).damage).toBe(4);
  });

  it("uses timed resistance when loadout inspection is unavailable", () => {
    const w = world({ map: MAP, player: { status: { resFire: 10 } }, monsters: [{ grid: { x: 6, y: 1 }, raceFlags: ["NEVER_BLOW", "NEVER_MOVE"] }], monsterRecall: () => "It may breathe fire (30)." });
    expect(incomingDamage(w.view).damage).toBe(10);
  });

  it("keeps paralysis danger separate and recognizes Free Action", () => {
    const w = world({ map: MAP, monsters: [{ grid: { x: 6, y: 1 }, raceFlags: ["NEVER_BLOW", "NEVER_MOVE"], spellFlags: ["HOLD"] }], monsterRecall: () => "It may cast spells which paralyze." });
    expect(incomingDamage(w.view).status).toBe(150);
    w.setPlayer({ objectFlags: ["FREE_ACT"] });
    expect(incomingDamage(w.view).status).toBe(0);
  });

  it("keeps an unexplained hit in both action windows", () => {
    const w = world({ map: MAP });
    const incoming = threatWindow(w.view, undefined, w.terrain, { unseenDamage: 3 });
    expect(incoming.one).toEqual({ damage: 3, status: 0, uncertainty: 3 });
    expect(incoming.two).toEqual({ damage: 6, status: 0, uncertainty: 6 });
  });

  it("ignores never-seen hidden monsters", () => {
    const w = world({ map: MAP, monsters: [{ grid: { x: 3, y: 1 }, visible: false, level: 50 }] });
    expect(incomingDamage(w.view).damage).toBe(0);
  });
});

describe("combat sense", () => {
  it("chooses the most damage per action among castable spells", () => {
    const w = world({ map: MAP, spells: [{ name: "Fire Ball", sidx: 1, mana: 8 }, { name: "Magic Missile", sidx: 0, mana: 2 }] });
    const spells = [
      { name: "Fire Ball", sidx: 1, mana: 8, fail: 10, power: 3 },
      { name: "Magic Missile", sidx: 0, mana: 2, fail: 10, power: 1 },
    ];
    const info: NonNullable<InspectingView["spellInfo"]> = (index) => ({
      /* Magic Missile's 3d4 averages 7.5, and the engine writes the decimal. */
      description: `Inflicts an average of ${index === 1 ? "16" : "7.5"} damage.`,
      mana: index === 1 ? 8 : 2, failChance: 10, canCastNow: true,
    });
    expect(pickAttackSpell(spells, info)?.sidx).toBe(1);
    expect(pickAttackSpell(spells)?.sidx).toBe(1);
    expect(inspecting(w.view).spellInfo).toBeUndefined();
  });

  it("rejects a shot through a wall or another creature", () => {
    const w = world({ map: MAP, monsters: [{ grid: { x: 5, y: 1 } }, { grid: { x: 4, y: 1 } }] });
    Object.assign(w.view, { projectionPath: () => ({ token, grids: [{ x: 3, y: 1 }, { x: 4, y: 1 }, { x: 5, y: 1 }] }) });
    expect(clearShot(w.view, w.view.monsters()[0]!)).toBe(false);
    w.setMonsters([{ grid: { x: 5, y: 1 } }]);
    expect(clearShot(w.view, w.view.monsters()[0]!)).toBe(true);
    Object.assign(w.view, { projectionPath: () => ({ token, grids: [{ x: 3, y: 1 }] }) });
    expect(clearShot(w.view, w.view.monsters()[0]!)).toBe(false);
  });

  it("removes blocked ranged offers while leaving melee available", () => {
    const w = world({ map: MAP, worn: ["a Long Bow"], quiver: ["12 Arrows"], pack: ["a Wand of Magic Missile"], player: { sp: 5, maxSp: 5 },
      spells: [{ name: "Magic Missile", sidx: 0 }], monsters: [{ grid: { x: 5, y: 1 }, race: "orc" }, { grid: { x: 4, y: 1 }, race: "orc" }] });
    Object.assign(w.view, { projectionPath: () => ({ token, grids: [{ x: 3, y: 1 }] }) });
    const q = createGoalPlanner({ cfg: defaultCfg(), terrain: w.terrain, log: () => undefined, reflex: false }).ask(w.view);
    if (!("request" in q)) throw new Error("expected a question");
    const goals = q.context.offers.map((offer) => offer.goal);
    expect(goals).toContain("fight");
    expect(goals).not.toContain("shoot");
    expect(goals).not.toContain("aim_wand");
    expect(goals).not.toContain("cast_attack");
  });

  it("aims a ball at the creature whose blast catches the largest group", () => {
    const w = world({ map: MAP, monsters: [3, 5, 6].map((x) => ({ grid: { x, y: 1 } })) });
    Object.assign(w.view, {
      projectionPath: (to: { x: number; y: number }) => ({ token, grids: [to] }),
      blastArea: (to: { x: number; y: number }) => ({ token, radius: 2, arc: null, element: null, wallsStop: true,
        grids: to.x === 3 ? [{ x: 3, y: 1 }] : [{ x: 5, y: 1 }, { x: 6, y: 1 }] }),
    });
    expect(bestBallAim(w.view, w.view.monsters(), w.view.monsters()[0]!)).toEqual({ x: 5, y: 1 });
    const aimed: { x: number; y: number }[] = [];
    const castWorld = world({ map: MAP, player: { sp: 8, maxSp: 8 }, spells: [{ name: "Fire Ball", sidx: 1, mana: 4 }],
      monsters: [3, 5, 6].map((x) => ({ grid: { x, y: 1 } })) });
    Object.assign(castWorld.view, { projectionPath: inspecting(w.view).projectionPath, blastArea: inspecting(w.view).blastArea });
    Object.assign(castWorld.act, { setTargetLocation: (x: number, y: number) => aimed.push({ x, y }) });
    const planner = createGoalPlanner({ cfg: defaultCfg(), terrain: castWorld.terrain, log: () => undefined, reflex: false });
    const q = planner.ask(castWorld.view);
    if (!("request" in q)) throw new Error("expected a question");
    const choice = planner.choose({ goal: { type: "choice", choice: "cast_attack", confidence: 1, probabilities: { cast_attack: 1 } } }, q.context, castWorld.view);
    if (!("plan" in choice)) throw new Error("expected a plan");
    expect(choice.plan.step(castWorld.view, castWorld.act)).toMatchObject({ code: "cast", args: { spell: 1 } });
    expect(aimed).toEqual([{ x: 5, y: 1 }]);
  });
});
