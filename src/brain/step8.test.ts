/**
 * Step 8: floor loot, combat preparation, devices, terrain and the bad level
 * feeling. Kept in its own file so the planner tests another worker edits stay
 * untouched.
 */

import { describe, expect, it } from "vitest";
import { suppliedWorld as world } from "../harness.js";
import { defaultCfg } from "../settings.js";
import type { Answer } from "./systemone.js";
import { createGoalPlanner, type GoalDigest } from "./goals.js";
import type { Question } from "./brain.js";
import { floorTarget } from "./items.js";
import { badLevelFeeling } from "./level-feel.js";

function planner(w: ReturnType<typeof world>, reflex = false) {
  const logged: string[] = [];
  return { p: createGoalPlanner({ cfg: defaultCfg(), terrain: w.terrain, log: (m) => logged.push(m), reflex }), logged };
}

type Asked = ReturnType<ReturnType<typeof createGoalPlanner>["ask"]>;

function asked(q: Asked): Question<GoalDigest> {
  if ("handBack" in q) throw new Error(`expected a question, got a hand-back: ${q.handBack}`);
  if ("reflex" in q) throw new Error(`expected a question, got a reflex: ${q.reflex}`);
  return q;
}

function offered(q: Asked): string[] {
  if ("handBack" in q) throw new Error(`expected offers, got a hand-back: ${q.handBack}`);
  return q.context.offers.map((o) => o.goal);
}

function pick(choice: string): Readonly<Record<string, Answer>> {
  return { goal: { type: "choice", choice, confidence: 0.9, probabilities: { [choice]: 0.9 } } };
}

describe("floor loot", () => {
  it("offers to fetch a worthwhile floor item and walks to it", () => {
    const w = world({ map: ["#####", "#@..#", "#####"], floor: [{ x: 2, y: 1, name: "a Potion of Cure Light Wounds" }] });
    const { p } = planner(w);
    const q = asked(p.ask(w.view));
    expect(q.context.offers.map((o) => o.goal)).toContain("fetch");
    const choice = p.choose(pick("fetch"), q.context, w.view);
    if (!("plan" in choice)) throw new Error("expected a plan");
    expect(choice.plan.step(w.view, w.act)).toEqual({ code: "walk", dir: 6 });
    w.moveTo({ x: 2, y: 1 });
    expect(choice.plan.step(w.view, w.act)).toEqual({ code: "pickup" });
    expect(choice.plan.step(w.view, w.act)).toBeNull();
  });

  it("favours gold over a useful item while saving for an aim", () => {
    const w = world({
      map: ["#####", "#@..#", "#####"],
      floor: [{ x: 2, y: 1, name: "a Potion of Cure Light Wounds" }, { x: 3, y: 1, name: "5 Gold Pieces" }],
    });
    expect(floorTarget(w.view, w.terrain, false)?.at).toEqual({ x: 2, y: 1 });
    expect(floorTarget(w.view, w.terrain, true)?.at).toEqual({ x: 3, y: 1 });
  });

  it("drops junk instead of offering a pickup when the pack is full", () => {
    const pack = Array.from({ length: 23 }, (_, i) => `a Broken Stick ${String(i)}`);
    const w = world({ map: ["#####", "#@*.#", "#####"], pack, floor: [{ x: 2, y: 1, name: "5 Gold Pieces" }] });
    const { p } = planner(w);
    const q = asked(p.ask(w.view));
    const goals = q.context.offers.map((o) => o.goal);
    expect(goals).toContain("drop_junk");
    expect(goals).not.toContain("fetch");
    const choice = p.choose(pick("drop_junk"), q.context, w.view);
    if (!("plan" in choice)) throw new Error("expected a plan");
    expect(choice.plan.step(w.view, w.act)).toEqual({ code: "drop", args: { handle: 1 } });
  });
});

describe("combat preparation", () => {
  const HARD = [{ grid: { x: 3, y: 1 }, race: "Grip, Farmer Maggot's Dog", level: 20, raceFlags: ["UNIQUE"] }];
  const EASY = [{ grid: { x: 3, y: 1 }, race: "giant white mouse", level: 1 }];
  const CORRIDOR = ["########", "#.@....#", "#.#### #", "########"];

  it("offers a buff before a hard fight but not before an easy one", () => {
    const pack = ["a Potion of Heroism"];
    const hard = world({ map: CORRIDOR, pack, monsters: HARD });
    expect(offered(planner(hard).p.ask(hard.view))).toContain("buff");
    const easy = world({ map: CORRIDOR, pack, player: { level: 10 }, monsters: EASY });
    expect(offered(planner(easy).p.ask(easy.view))).not.toContain("buff");
  });

  it("drinks the buff potion", () => {
    const w = world({ map: CORRIDOR, pack: ["a Potion of Heroism"], monsters: HARD });
    const { p } = planner(w);
    const q = asked(p.ask(w.view));
    const choice = p.choose(pick("buff"), q.context, w.view);
    if (!("plan" in choice)) throw new Error("expected a plan");
    expect(choice.plan.step(w.view, w.act)).toEqual({ code: "quaff", args: { handle: 1 } });
  });

  it("offers a resist potion before a creature known to breathe", () => {
    const w = world({
      map: CORRIDOR,
      pack: ["a Potion of Resist Fire"],
      monsters: [{ grid: { x: 4, y: 1 }, race: "young red dragon", level: 10 }],
      monsterRecall: () => "It may breathe fire (30).",
    });
    const q = asked(planner(w).p.ask(w.view));
    expect(q.context.offers.map((o) => o.goal)).toContain("resist");
    expect(q.context.offers.find((o) => o.goal === "resist")?.criteria).toContain("fire");
  });

  it("uses a curing device when hurt in a hard fight", () => {
    const w = world({ map: CORRIDOR, pack: ["a Staff of Curing"], player: { hp: 5, maxHp: 40 }, monsters: HARD });
    const { p } = planner(w);
    const q = asked(p.ask(w.view));
    expect(q.context.offers.map((o) => o.goal)).toContain("device");
    const choice = p.choose(pick("device"), q.context, w.view);
    if (!("plan" in choice)) throw new Error("expected a plan");
    expect(choice.plan.step(w.view, w.act)).toEqual({ code: "use", args: { handle: 1 } });
  });

  it("activates a ready item before a hard fight", () => {
    const w = world({ map: CORRIDOR, pack: ["a Ring of Flames"], activations: ["a Ring of Flames"], monsters: HARD });
    const { p } = planner(w);
    const q = asked(p.ask(w.view));
    expect(q.context.offers.map((o) => o.goal)).toContain("activate");
    const choice = p.choose(pick("activate"), q.context, w.view);
    if (!("plan" in choice)) throw new Error("expected a plan");
    expect(choice.plan.step(w.view, w.act)).toEqual({ code: "activate", args: { handle: 1 } });
  });

  it("offers a detection rod for evil creatures", () => {
    const w = world({ map: CORRIDOR, pack: ["a Rod of Detect Evil"], player: { depth: 2 } });
    expect(offered(planner(w).p.ask(w.view))).toContain("detect");
  });
});

describe("terrain", () => {
  it("disarms a visible trap next to the character", () => {
    const w = world({ map: ["#####", "#@..#", "#####"], traps: [{ x: 2, y: 1 }] });
    const { p } = planner(w);
    const q = asked(p.ask(w.view));
    expect(q.context.offers.map((o) => o.goal)).toContain("disarm");
    const choice = p.choose(pick("disarm"), q.context, w.view);
    if (!("plan" in choice)) throw new Error("expected a plan");
    expect(choice.plan.step(w.view, w.act)).toEqual({ code: "disarm", dir: 6 });
  });

  it("tunnels through rubble that blocks the way on", () => {
    const w = world({ map: ["#######", "#@%..>#", "#######"], player: { depth: 2, maxDepth: 2 } });
    const { p } = planner(w);
    const q = asked(p.ask(w.view));
    expect(q.context.offers.map((o) => o.goal)).toContain("tunnel");
    const choice = p.choose(pick("tunnel"), q.context, w.view);
    if (!("plan" in choice)) throw new Error("expected a plan");
    expect(choice.plan.step(w.view, w.act)).toEqual({ code: "tunnel", dir: 6 });
  });

  it("does not tunnel when the way is already open", () => {
    const w = world({ map: ["########", "#@%...>#", "#.....##", "########"], player: { depth: 2, maxDepth: 2 } });
    expect(offered(planner(w).p.ask(w.view))).not.toContain("tunnel");
  });
});

describe("level feeling and the worm-mass case", () => {
  const ROOM = ["########", "#@....>#", "########"];

  it("offers to leave a level the game calls dangerous", () => {
    const w = world({ map: ROOM, player: { depth: 2, maxDepth: 2 }, messages: ["Omens of death haunt this place, and there are good treasures here."] });
    const { p } = planner(w);
    const q = asked(p.ask(w.view));
    expect(q.context.offers.find((o) => o.goal === "leave_level")?.criteria).toContain("Omens of death");
    /* The feeling is announced once, so the offer has to survive the message. */
    w.setMessages([]);
    expect(offered(p.ask(w.view))).toContain("leave_level");
  });

  it("reads a bad level feeling out of the messages", () => {
    expect(badLevelFeeling(["You feel that there are good treasures here."])).toBeNull();
    expect(badLevelFeeling(["This place seems murderous, and there are good treasures here."])).toContain("murderous");
    expect(badLevelFeeling(["there is naught but cobwebs here."])).not.toBeNull();
  });

  it("offers to leave the level to a caster out of mana beside a breeder", () => {
    const worm = [{ grid: { x: 3, y: 1 }, race: "acid worm mass", level: 3, raceFlags: ["MULTIPLY"] }];
    const spent = world({ map: ROOM, player: { depth: 2, maxDepth: 2, cls: "Mage", level: 5, sp: 0, maxSp: 5 }, monsters: worm });
    expect(offered(planner(spent).p.ask(spent.view))).toContain("leave_level");
    const rested = world({ map: ROOM, player: { depth: 2, maxDepth: 2, cls: "Mage", level: 5, sp: 5, maxSp: 5 }, monsters: worm });
    expect(offered(planner(rested).p.ask(rested.view))).not.toContain("leave_level");
  });
});
