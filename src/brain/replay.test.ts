import { describe, expect, it } from "vitest";
import { FEAT, suppliedWorld, world, type WorldSpec } from "../harness.js";
import { defaultCfg } from "../settings.js";
import { attackOptions } from "./combat-kit.js";
import { createGoalPlanner } from "./goals.js";
import { DIRECTIONS } from "../grid.js";

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
  it.each([0, 1])("leaves the harmless town crowd behind at DL%i", (depth) => {
    const w = suppliedWorld({ map: ["############", "#..........#", "#.@.....>.,#", "#..........#", "############"],
      player: { depth, level: 1, maxLevel: 1, hp: 13, maxHp: 13, gold: 0 }, pack: ["15 Flasks of Oil"],
      monsters: ["filthy street urchin", "scruffy little dog", "scrawny cat"].map((race, i) => ({ id: i + 1, race, glyph: ["p", "C", "f"][i]!, level: 0, grid: { x: i + 1, y: 1 },
        knownCombat: { blows: [], averageHp: null, health: "unhurt" as const, status: [], spellFrequency: null, innateFrequency: null } })) });
    Object.assign(w.view, { apiVersion: "2.0.0" });
    let foundStair = depth === 0;
    const cell = w.view.cell.bind(w.view);
    Object.assign(w.view, { cell: (x: number, y: number) => x === 8 && y === 2 ? { ...cell(x, y)!, feat: FEAT.DOWN_STAIR, known: foundStair, inView: foundStair } : cell(x, y) });
    const p = createGoalPlanner({ cfg: defaultCfg(), terrain: w.terrain, log: () => {}, now: () => 1234, rng: () => 0.5, reflex: false });
    let descended = false;
    const goals: string[] = [];
    for (let i = 0; i < 20 && !descended; i++) {
      const q = p.ask(w.view);
      if ("handBack" in q) throw new Error(q.handBack);
      expect(q.context.offers.map((offer) => offer.goal)).not.toContain("endure");
      const goal = q.context.offers.find((offer) => offer.goal === "descend")?.goal ?? q.context.offers.find((offer) => offer.goal === "explore")?.goal;
      if (goal === undefined) throw new Error(`No progress goal: ${q.context.offers.map((offer) => offer.goal).join(",")}`);
      goals.push(goal);
      const choice = p.choose({ goal: { type: "choice", choice: goal, confidence: 1, probabilities: { [goal]: 1 } } }, q.context, w.view);
      if (!("plan" in choice)) throw new Error(choice.handBack);
      expect(p.trigger(w.view, choice.plan)).not.toBe("A creature in view can now kill the character before its next action.");
      for (let j = 0; j < 20; j++) {
        const command = choice.plan.step(w.view, w.act);
        if (command === null) break;
        if (command.code === "descend") { w.setPlayer({ depth: depth + 1 }); descended = true; break; }
        if (command.code !== "walk") throw new Error(`Unexpected command: ${command.code}`);
        const dir = DIRECTIONS.find((d) => d.key === command.dir)!;
        w.moveTo({ x: w.at().x + dir.dx, y: w.at().y + dir.dy });
        w.advance(10);
        if (!foundStair && w.at().x >= 6) { foundStair = true; break; }
      }
      choice.plan.end?.(w.view);
    }
    expect(descended).toBe(true);
    expect(w.view.player().depth).toBe(depth + 1);
    if (depth === 1) expect(goals).toContain("explore");
  });

  it("walks to the town staircase during stage four recovery beside a quiet crowd", () => {
    const w = suppliedWorld({ map: ["############", "#..........#", "#.@.....>..#", "#..........#", "############"],
      player: { depth: 0, level: 1, maxLevel: 1, hp: 13, maxHp: 13, gold: 0 }, pack: ["15 Flasks of Oil"],
      monsters: ["filthy street urchin", "scruffy little dog", "scrawny cat"].map((race, i) => ({ id: i + 1, race, level: 0, grid: { x: i + 1, y: 1 } })) });
    let time = 0;
    const p = createGoalPlanner({ cfg: defaultCfg(), terrain: w.terrain, log: () => {}, now: () => time, rng: () => 0.5, reflex: false });
    p.watchdog!(w.view, true);
    time = 90001;
    const recovery = p.watchdog!(w.view, true);
    if (recovery === null || !("plan" in recovery)) throw new Error("Expected a watchdog recovery");
    expect(recovery.plan.label).toBe("watchdog: recover at stage 4");
    let descended = false;
    for (let i = 0; i < 20; i++) {
      const command = recovery.plan.step(w.view, w.act);
      if (command?.code === "descend") { descended = true; break; }
      expect(command?.code).toBe("walk");
      const dir = DIRECTIONS.find((d) => d.key === command?.dir)!;
      w.moveTo({ x: w.at().x + dir.dx, y: w.at().y + dir.dy });
      w.advance(10);
    }
    expect(descended).toBe(true);
  });

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
