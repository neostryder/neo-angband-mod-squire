import { describe, expect, it } from "vitest";
import { FEAT, suppliedWorld, world, type WorldSpec } from "../harness.js";
import { defaultCfg } from "../settings.js";
import { attackOptions } from "./combat-kit.js";
import { createGoalPlanner } from "./goals.js";
import { DIRECTIONS } from "../grid.js";
import { Session } from "node:inspector/promises";
import { createBrain, type Planner } from "./brain.js";
import type { GoalDigest } from "./goals.js";
import { JEV } from "./backend.js";
import { createTally } from "./tally.js";
import { archetype, defaultPersona } from "../persona/persona.js";
import { breedersOverwhelm } from "../strategy/journey.js";

describe("round 10 command liveness", () => {
  it.each([{}, { afraid: 10 }, { confused: 10 }, { blind: 10 }, { poisoned: 10 }, { paralyzed: 10 }])("logs empty goals and issues recovery on the next tick at status %j", (status) => {
    const w = suppliedWorld({ map: ["###", "#@#", "###"], player: { depth: 2, level: 3, hp: 30, maxHp: 30, status } });
    const logs: string[] = [];
    const source = createGoalPlanner({ cfg: defaultCfg(), terrain: w.terrain, log: (line) => logs.push(line), now: () => 0 });
    let decisions = 0;
    const empty = () => ({ reflex: "empty replay", plan: { label: `empty ${String(++decisions)}`, step: () => null }, context: { depth: 2, newCreatures: 0, offers: [] }, answers: {} });
    const p: Planner<GoalDigest> = { ...source, ask: empty, rules: empty, watchdog: () => null, trigger: () => null };
    const brain = createBrain({ backend: JEV, rulesOnly: true, planner: p, tally: createTally({ perSessionUsd: 0, perDayUsd: 0 }),
      send: () => { throw new Error("The replay uses rules."); }, token: () => null, now: () => 0, log: (line) => logs.push(line), status: () => {} });
    for (let tick = 0; tick < 4; tick++) {
      const before = logs.length;
      expect(brain.controller(w.view, w.act)).toBeNull();
      expect(logs.slice(before).some((line) => line.includes("controller issued no command"))).toBe(true);
    }
    expect(brain.noOpGoals()).toEqual({ last100: 3, consecutive: 3 });
    expect(brain.controller(w.view, w.act)).not.toBeNull();
    expect(brain.noOpGoals().consecutive).toBe(0);
  });

  it("replays a blocked frontier, an unreachable dog and a missing town reserve without dormancy", () => {
    const w = suppliedWorld({ map: ["############", "#<@....,..##", "#......#####", "##########.#", "############"],
      player: { depth: 2, level: 3, maxLevel: 3, hp: 30, maxHp: 30 },
      pack: ["5 Rations of Food", "2 Wooden Torches (5000 turns)"],
      monsters: [{ id: 1, grid: { x: 10, y: 3 }, race: "Grip, Farmer Maggot's Dog", raceFlags: ["UNIQUE"], speed: 120 }] });
    const logs: string[] = [];
    const p = createGoalPlanner({ cfg: defaultCfg(), terrain: w.terrain, log: (line) => logs.push(line), now: () => 1234, rng: () => 0.5 });
    const brain = createBrain({ backend: JEV, rulesOnly: true, planner: p, tally: createTally({ perSessionUsd: 0, perDayUsd: 0 }),
      send: () => { throw new Error("The replay uses rules."); }, token: () => ({ epoch: 1, revision: 1 }), now: () => 1234, log: (line) => logs.push(line), status: () => {},
      gauge: (view) => ({ turn: view.turn(), hp: view.player().hp, depth: view.player().depth }) });
    let commands = 0;
    let moved = false;
    let refused = false;
    for (let tick = 0; tick < 60; tick++) {
      const before = logs.length;
      const command = brain.controller(w.view, w.act);
      if (command === null) {
        expect(logs.slice(before).some((line) => /no command|ended without a command/.test(line))).toBe(true);
        continue;
      }
      commands++;
      if (command.code === "walk") {
        if (!refused) { refused = true; continue; }
        const direction = DIRECTIONS.find((dir) => dir.key === command.dir)!;
        const to = { x: w.at().x + direction.dx, y: w.at().y + direction.dy };
        if (w.view.cell(to.x, to.y)?.passable) { w.moveTo(to); moved = true; }
      }
      w.advance(10);
    }
    expect(refused).toBe(true);
    expect(moved).toBe(true);
    expect(commands).toBeGreaterThan(10);
    expect(brain.stoppedBecause()).toBeNull();
  });

  it.each([3, 5])("keeps a group of %i mice executable and prices the swarm through the persona", (count) => {
    const decisions: string[] = [];
    const pressures: boolean[] = [];
    for (const persona of [archetype("coward"), defaultPersona(), archetype("diver")]) {
      const w = suppliedWorld({ map: ["##########", "#<@.....,#", "#........#", "##########"], player: { depth: 1, level: 2, maxLevel: 2, hp: 13, maxHp: 13, blows: 100, skills: [0, 0, 0, 0, 0, 0, 35] }, monsterRecall: () => "It has an armor rating of 6.",
        worn: ["a Dagger (1d4) (+0,+0)"],
        monsters: Array.from({ length: count }, (_, i) => i + 3).map((x, i) => ({ id: i + 1, grid: { x, y: 1 }, race: "giant white mouse", level: 1, hp: 1, maxHp: 1, raceFlags: ["MULTIPLY"],
          knownCombat: { averageHp: 1, health: "unhurt" as const, blows: [{ method: "BITE", effect: "HURT", damage: { base: 0, dice: 1, sides: 2, mBonus: 0 } }], spellFrequency: null, innateFrequency: null, status: [] } })) });
      Object.assign(w.view, { blowRules: { effects: new Map([["HURT", 60]]), methods: new Map([["BITE", true]]) } });
      pressures.push(breedersOverwhelm(w.view, w.terrain, persona));
      const p = createGoalPlanner({ cfg: defaultCfg(), terrain: w.terrain, persona: () => persona, log: () => {}, now: () => 1234, rng: () => 0.5 });
      const choice = p.rules!(w.view, "mouse replay");
      if (!("plan" in choice)) throw new Error(choice.handBack);
      const command = choice.plan.step(w.view, w.act);
      expect(command).not.toBeNull();
      decisions.push(command!.code);
    }
    if (count === 3) {
      expect(pressures).toEqual([true, false, false]);
      expect(decisions).toEqual(["read", "melee", "melee"]);
    } else {
      expect(pressures).toEqual([true, true, false]);
      expect(decisions).toEqual(["read", "walk", "melee"]);
    }
  });
});

function largeDecision() {
  const grids = Array.from({ length: 66 }, () => Array<string>(198).fill("#"));
  for (let y = 25; y <= 40; y++) for (let x = 1; x <= 28; x++) grids[y]![x] = ".";
  for (let x = 1; x <= 151; x++) grids[32]![x] = x === 151 ? "," : ".";
  for (let i = 0; i < 20; i++) {
    for (let y = 27 + i % 8; y <= 34 + i % 8; y++) for (let x = 7 + i * 6; x <= 10 + i * 6; x++) grids[y]![x] = ".";
  }
  grids[32]![1] = "<";
  grids[32]![2] = "@";
  const map = grids.map((row) => row.join(""));
  const monsters = Array.from({ length: 20 }, (_, i) => ({ id: i + 1, raceIndex: i + 1, race: `creature ${i}`, grid: { x: 8 + i * 6, y: 28 + i % 8 },
    level: 1, asleep: i % 3 === 0, raceFlags: i % 4 === 0 ? ["NEVER_MOVE"] : [] }));
  const w = suppliedWorld({ map, player: { depth: 1, level: 3, maxLevel: 3, hp: 40, maxHp: 40 }, monsters });
  const snapshot = () => {
    const turn = w.view.turn();
    const player = w.view.player();
    const creatures = w.view.monsters();
    const cells = Array.from({ length: 66 }, (_, y) => Array.from({ length: 198 }, (_, x) => w.view.cell(x, y)));
    return { ...w.view, apiVersion: "2.0.0", turn: () => turn, player: () => player, monsters: () => creatures,
      cell: (x: number, y: number) => cells[y]?.[x] ?? null };
  };
  const seed = snapshot();
  w.setMonsters(monsters.slice(0, 10));
  w.advance(300);
  const current = snapshot();
  return () => {
    const planner = createGoalPlanner({ cfg: defaultCfg(), terrain: w.terrain, log: () => {}, now: () => 1234, rng: () => 0.5, reflex: false });
    planner.ask({ ...seed });
    const view = { ...current };
    return { view, run: () => {
      const question = planner.ask(view);
      if ("handBack" in question) throw new Error(question.handBack);
      const goal = question.context.offers.find((offer) => offer.goal === "explore")?.goal ?? question.context.offers[0]!.goal;
      const choice = planner.choose({ goal: { type: "choice", choice: goal, confidence: 1, probabilities: { [goal]: 1 } } }, question.context, view);
      if (!("plan" in choice)) throw new Error(choice.handBack);
      return { goal, command: choice.plan.step(view, w.act) };
    } };
  };
}

describe("large snapshot decision cost", () => {
  it("bounds threat searches and snapshot reads through goals and journey", async () => {
    const { view, run } = largeDecision()();
    let playerReads = 0;
    let monsterReads = 0;
    const player = view.player;
    const creatures = view.monsters;
    view.player = () => { playerReads++; return player(); };
    view.monsters = () => { monsterReads++; return creatures(); };
    const session = new Session();
    session.connect();
    try {
      await session.post("Profiler.enable");
      await session.post("Profiler.startPreciseCoverage", { callCount: true, detailed: false });
      await session.post("Profiler.start");
      const start = performance.now();
      const result = run();
      const elapsed = performance.now() - start;
      const { profile } = await session.post("Profiler.stop");
      const coverage = await session.post("Profiler.takePreciseCoverage");
      const calls = (name: string) => coverage.result.flatMap((script) => script.functions).filter((fn) => fn.functionName === name).reduce((sum, fn) => sum + fn.ranges[0]!.count, 0);
      const samples = new Map<number, number>();
      for (const id of profile.samples ?? []) samples.set(id, (samples.get(id) ?? 0) + 1);
      const hot = profile.nodes.map((node) => ({ name: node.callFrame.functionName, line: node.callFrame.lineNumber + 1, samples: samples.get(node.id) ?? 0 })).sort((a, b) => b.samples - a.samples).slice(0, 8);
      console.log(JSON.stringify({ elapsed, playerReads, monsterReads, attackPositions: calls("attackPositions"), incomingDamage: calls("incomingDamage"), ...result, hot }));
      expect(result).toMatchObject({ goal: "explore", command: { code: "walk", dir: 6 } });
      expect(calls("attackPositions")).toBeLessThanOrEqual(40);
      expect(calls("incomingDamage")).toBeLessThanOrEqual(500);
      expect(playerReads).toBeLessThanOrEqual(1000);
      expect(monsterReads).toBeLessThanOrEqual(500);
    } finally {
      await session.post("Profiler.stopPreciseCoverage");
      session.disconnect();
    }
  }, 120000);

  // The isolated run avoids measuring contention from the other test workers.
  it.runIf(process.env["SQUIRE_BENCHMARK"] === "1")("keeps a warm decision below 20 ms on fresh snapshots", () => {
    const setup = largeDecision();
    const timings: number[] = [];
    for (let i = 0; i < 25; i++) {
      const { run } = setup();
      const start = performance.now();
      const result = run();
      const elapsed = performance.now() - start;
      expect(result).toMatchObject({ goal: "explore", command: { code: "walk", dir: 6 } });
      if (i >= 10) timings.push(elapsed);
    }
    timings.sort((a, b) => a - b);
    const median = timings[Math.floor(timings.length / 2)]!;
    console.log(JSON.stringify({ median, min: timings[0], max: timings.at(-1), timings }));
    expect(median).toBeLessThan(20);
  });
});

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
