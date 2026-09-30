import { describe, expect, it } from "vitest";
import type { AgentView } from "@rpgm-tools/neo-angband-core";
import { world } from "../harness.js";
import { assessThreat, bestBallAim, clearShot, inspecting, knownCapability, pickAttackSpell, type InspectingView } from "./threat-model.js";
import { createGoalPlanner } from "./goals.js";
import { defaultCfg } from "../settings.js";

const MAP = ["#########", "#.@.....#", "#########"];
/* The views here are the harness's, which never check an input token. */
const token = {};

function recall(view: AgentView, text: string): void {
  Object.assign(view, { monsterRecall: () => ({ token, title: "veteran", text }) });
}

describe("threat model", () => {
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

  it("preserves old threat behavior without recall", () => {
    const w = world({ map: MAP, player: { level: 1, hp: 10 }, monsters: [{ grid: { x: 3, y: 1 }, level: 0 }] });
    expect(assessThreat(w.view.monsters()[0]!, w.view.player(), w.view.monsters(), w.view).band).toBe(0);
  });
});

describe("combat sense", () => {
  it("chooses the most damage per mana among castable spells", () => {
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
    expect(pickAttackSpell(spells, info)?.sidx).toBe(0);
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
