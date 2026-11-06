import { describe, expect, it } from "vitest";
import { suppliedWorld, world, type WorldSpec } from "../harness.js";
import { defaultCfg } from "../settings.js";
import { attackOptions } from "./combat-kit.js";
import { createGoalPlanner } from "./goals.js";

function replay(spec: WorldSpec) {
  const w = suppliedWorld(structuredClone(spec));
  const p = createGoalPlanner({ cfg: defaultCfg(), terrain: w.terrain, log: () => {}, now: () => 1234, rng: () => 0.5, reflex: false });
  const q = p.ask(w.view);
  if ("handBack" in q) throw new Error(q.handBack);
  const goal = q.context.offers.find((offer) => offer.goal === "throw_oil")?.goal ?? q.context.offers[0]!.goal;
  const choice = p.choose({ goal: { type: "choice", choice: goal, confidence: 1, probabilities: { [goal]: 1 } } }, q.context, w.view);
  if (!("plan" in choice)) throw new Error(choice.handBack);
  return { goal, command: choice.plan.step(w.view, w.act), offers: q.context.offers.map((offer) => offer.goal) };
}

describe("forecast decision integration", () => {
  it.each(["Warrior", "Mage", "Priest", "Rogue", "Ranger", "Paladin", "Druid", "Necromancer", "Blackguard"])("takes a cheap armored fight as a hurt %s", (cls) => {
    const w = suppliedWorld({ map: ["########", "#<@...,#", "########"], player: { cls, race: "Dwarf", depth: 1, level: 3, maxLevel: 3, hp: 18, maxHp: 30, ac: 100, blows: 200, toDam: 4 },
      worn: ["a Dagger (2d4) (+0,+0)"], monsters: [{ grid: { x: 3, y: 1 }, level: 1, knownCombat: { averageHp: 4, health: "unhurt", blows: [{ method: "HIT", effect: "HURT", damage: { base: 0, dice: 1, sides: 2, mBonus: 0 } }], spellFrequency: null, innateFrequency: null, status: [] } }] });
    Object.assign(w.view, { blowRules: { effects: new Map([["HURT", 40]]), methods: new Map([["HIT", true]]) } });
    const p = createGoalPlanner({ cfg: defaultCfg(), terrain: w.terrain, log: () => {}, now: () => 0, rng: () => 0.5 });
    const q = p.ask(w.view);
    if (!("reflex" in q)) throw new Error("expected a cheap-fight reflex");
    expect(q.answers["goal"]).toMatchObject({ choice: "fight" });
    expect(q.context.offers.find((o) => o.goal === "fight")?.forecast?.viable).toBe(true);
    expect(q.plan.step(w.view, w.act)?.code).toBe("melee");
  });

  it("binds the forecasted wand rather than the first wand in the pack", () => {
    const w = world({ map: ["########", "#.@....#", "########"], player: { hp: 100, maxHp: 100 },
      pack: ["a Wand of Magic Missile (5 charges)", "a Wand of Stinking Cloud (5 charges)"], monsters: [{ grid: { x: 5, y: 1 }, hp: 20 }],
      inspect: (ref) => ref === 1 ? "Inflicts an average of 2 damage." : "Inflicts an average of 20 damage.", projectionPath: (to) => [to] });
    const p = createGoalPlanner({ cfg: defaultCfg(), terrain: w.terrain, log: () => {}, reflex: false });
    const q = p.ask(w.view);
    if (!("request" in q)) throw new Error("expected a request");
    expect(attackOptions(w.view, w.view.monsters()[0]!, "aim_wand").map((a) => [a.source, a.damage])).toEqual([[{ handle: 2, name: "a Wand of Stinking Cloud (5 charges)", power: 1 }, 20], [{ handle: 1, name: "a Wand of Magic Missile (5 charges)", power: 1 }, 2]]);
    const offer = q.context.offers.find((o) => o.goal === "aim_wand")!;
    expect(offer.action?.source).toEqual({ handle: 2 });
    const choice = p.choose({ goal: { type: "choice", choice: "aim_wand", confidence: 1, probabilities: { aim_wand: 1 } } }, q.context, w.view);
    if (!("plan" in choice)) throw new Error(choice.handBack);
    expect(choice.plan.step(w.view, w.act)).toEqual({ code: "aim", args: { handle: 2 } });
  });

  it("takes a viable escape when the answer chooses a forecasted losing fight", () => {
    const w = world({ map: ["############", "#..........#", "#.@........#", "#..........#", "############"], player: { hp: 12, maxHp: 40, level: 6, maxLevel: 6, blows: 100, toDam: 0 },
      worn: ["a Dagger (1d1) (+0,+0)"], pack: ["2 Scrolls of Phase Door"], monsters: [{ grid: { x: 3, y: 2 }, hp: 100, raceFlags: ["NEVER_MOVE"] }], monsterRecall: () => "It can hit to hurt (1d8)." });
    const p = createGoalPlanner({ cfg: defaultCfg(), terrain: w.terrain, log: () => {}, reflex: false });
    const q = p.ask(w.view);
    if (!("request" in q)) throw new Error("expected a request");
    expect(q.context.offers.find((o) => o.goal === "fight")?.forecast?.blocker).toBe("loss");
    const choice = p.choose({ goal: { type: "choice", choice: "fight", confidence: 1, probabilities: { fight: 1 } } }, q.context, w.view);
    if (!("plan" in choice)) throw new Error(choice.handBack);
    expect(q.context.offers.find((o) => o.goal === "retreat")?.forecast?.viable).toBe(true);
    expect(choice.plan.step(w.view, w.act)).toEqual({ code: "walk", dir: 4 });
  });

  it("invalidates a late attack answer when its source or target frame changes", () => {
    const w = world({ map: ["########", "#.@....#", "########"], pack: ["5 Flasks of Oil"], monsters: [{ grid: { x: 5, y: 1 } }] });
    const p = createGoalPlanner({ cfg: defaultCfg(), terrain: w.terrain, log: () => {}, reflex: false });
    const q = p.ask(w.view);
    if (!("request" in q)) throw new Error("expected a request");
    w.setPack(["a Potion of Cure Light Wounds"]);
    const choice = p.choose({ goal: { type: "choice", choice: "throw_oil", confidence: 1, probabilities: { throw_oil: 1 } } }, q.context, w.view);
    if (!("plan" in choice)) throw new Error(choice.handBack);
    expect(choice.plan.step(w.view, w.act)).toBeNull();
  });

  it("keeps an omitted API 2 pursuer after the old fifty-turn timeout", () => {
    const w = suppliedWorld({ map: ["########", "#.@...,#", "########"], player: { hp: 30, maxHp: 40 }, monsters: [{ grid: { x: 3, y: 1 } }] });
    Object.assign(w.view, { apiVersion: "2.0.0" });
    const p = createGoalPlanner({ cfg: defaultCfg(), terrain: w.terrain, log: () => {}, reflex: false });
    p.ask(w.view);
    w.setMonsters([]);
    w.advance(60);
    const q = p.ask(w.view);
    if ("handBack" in q) throw new Error(q.handBack);
    expect(q.context.offers.map((offer) => offer.goal)).not.toContain("rest");
  });
});

describe("synthetic decision replay", () => {
  it("repeats a public fixture with a fixed clock and answer", () => {
    const fixture: WorldSpec = { map: ["#########", "#<@....,#", "#########"], player: { depth: 1, level: 3, hp: 24, maxHp: 24 },
      monsters: [{ grid: { x: 5, y: 1 }, race: "floating eye", raceFlags: ["NEVER_MOVE"], hp: 6, maxHp: 6 }], pack: ["5 Flasks of Oil"] };
    expect(replay(JSON.parse(JSON.stringify(fixture)) as WorldSpec)).toEqual(replay(fixture));
    expect(replay(fixture)).toMatchObject({ goal: "throw_oil", command: { code: "throw" } });
  });

  it.each(["confused", "blind"] as const)("keeps a %s survival case executable", (status) => {
    const result = replay({ map: ["#########", "#<@....,#", "#########"], player: { depth: 1, hp: 6, maxHp: 24, status: { [status]: 5 } },
      monsters: [{ grid: { x: 3, y: 1 }, race: "mushroom", raceFlags: ["NEVER_MOVE"] }] });
    expect(result.offers).not.toContain("phase");
    expect(result.command).not.toBeNull();
  });
});
