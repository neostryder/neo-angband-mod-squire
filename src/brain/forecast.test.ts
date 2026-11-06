import { describe, expect, it } from "vitest";
import { world } from "../harness.js";
import { attackOptions, attackOutcome, healingStatus, targetHp } from "./combat-kit.js";
import { readPack } from "./pack.js";
import { attackLaw, forecastFight, forecastHeal, forecastPhase, forecastWalk, stationaryTtk, tacticalFrame, tacticalKey } from "./forecast.js";

const ROOM = ["############", "#..........#", "#.@........#", "#..........#", "############"];

describe("target HP intervals", () => {
  it.each(["somewhat", "wounded", "badly", "almost"] as const)("keeps %s HP endpoints rather than a midpoint kill", (health) => {
    const w = world({ map: ROOM, pack: ["5 Flasks of Oil"], monsters: [{ grid: { x: 5, y: 2 }, hp: 1, maxHp: 100,
      knownCombat: { blows: [], averageHp: 100, health, status: [], spellFrequency: null, innateFrequency: null } }] });
    const target = w.view.monsters()[0]!;
    const hp = targetHp(target);
    expect(hp.low).toBeGreaterThanOrEqual(1);
    expect(hp.high).toBeGreaterThan(hp.mean);
    expect(hp.exact).toBe(false);
    expect(attackOptions(w.view, target, "throw_oil")[0]!.kill).toBe(false);
  });

  it("labels absent average HP as a prior while retaining the health band", () => {
    const w = world({ map: ROOM, monsters: [{ grid: { x: 5, y: 2 }, level: 1,
      knownCombat: { blows: [], averageHp: null, health: "wounded", status: [], spellFrequency: null, innateFrequency: null } }] });
    expect(targetHp(w.view.monsters()[0]!)).toMatchObject({ exact: false, prior: true, mean: 6.8 });
  });

  it("retains a miss after an apparent killing oil hit", () => {
    const w = world({ map: ROOM, pack: ["5 Flasks of Oil"], monsters: [{ grid: { x: 3, y: 2 }, hp: 3, maxHp: 3 }] });
    const attack = attackOptions(w.view, w.view.monsters()[0]!, "throw_oil")[0]!;
    const law = attackLaw(w.view, attack).law;
    expect(law).toContainEqual([0, 0.5]);
    expect(stationaryTtk(3, law)).toBe(2);
    expect(stationaryTtk(20, [[0, 1]])).toBe(Infinity);
  });
});

describe("resource-limited TTK", () => {
  it("matches an independently enumerated two-hit oil expectation", () => {
    const law = [[0, 0.5], [3, 0.125], [6, 0.125], [9, 0.125], [12, 0.125]] as const;
    // At HP 4, a roll of 3 needs another successful hit and a miss restarts the attempt.
    expect(stationaryTtk(4, law)).toBe(2.5);
  });

  it.each(["fight", "throw_oil", "shoot", "cast_attack"] as const)("forecasts %s over normal-action energy", (kind) => {
    const w = world({ map: ROOM, player: { hp: 80, maxHp: 80, blows: 100, shots: 20, toDam: 0, sp: 10, maxSp: 10 },
      worn: ["a Dagger (1d4) (+0,+0)", "a Short Bow (x2) (+0,+0)"], pack: ["20 Arrows (1d4) (+0,+0)", "10 Flasks of Oil"],
      spells: [{ name: "Magic Missile", sidx: 0, mana: 1, fail: 10 }], monsters: [{ grid: { x: 3, y: 2 }, hp: 6, maxHp: 6 }], monsterRecall: () => "It can hit to hurt (1d1)." });
    Object.assign(w.view, { spellInfo: () => ({ mana: 1, failChance: 10, canCastNow: true, description: "Inflicts 1d8 damage." }) });
    const target = w.view.monsters()[0]!;
    const attack = attackOptions(w.view, target, kind)[0]!;
    const forecast = forecastFight(tacticalFrame(w.view, { terrain: w.terrain }), target, attack);
    expect(forecast.commands.mean).toBeGreaterThan(0);
    expect(forecast.actions).toBeCloseTo(forecast.commands.mean * (kind === "shoot" ? 0.5 : 1));
    expect(forecast.loss.upper).toBeGreaterThanOrEqual(forecast.loss.mean);
    expect(forecast.viable).toBe(true);
  });

  it("does not certify a cheap fight on ground with unquantified damage", () => {
    const w = world({ map: ["######", "#.@~.#", "######"], player: { blows: 100 }, worn: ["a Dagger (2d4) (+0,+0)"], monsters: [{ grid: { x: 4, y: 1 }, hp: 2 }], monsterRecall: () => "It can hit to hurt (1d1)." });
    w.moveTo({ x: 3, y: 1 });
    const target = w.view.monsters()[0]!;
    const forecast = forecastFight(tacticalFrame(w.view, { terrain: w.terrain }), target, attackOptions(w.view, target, "fight")[0]!);
    expect(forecast.unknown).toContain("terrain-damage");
    expect(forecast.viable).toBe(false);
  });

  it("keeps mean exposure separate from the high-HP terminal scenario", () => {
    const w = world({ map: ROOM, player: { hp: 100, maxHp: 100 }, pack: ["20 Flasks of Oil"], monsters: [{ grid: { x: 5, y: 2 }, raceFlags: ["NEVER_BLOW", "NEVER_MOVE"],
      knownCombat: { blows: [], averageHp: 10, health: "unhurt", status: [], spellFrequency: null, innateFrequency: null } }] });
    const target = w.view.monsters()[0]!;
    const attack = attackOptions(w.view, target, "throw_oil")[0]!;
    const forecast = forecastFight(tacticalFrame(w.view, { terrain: w.terrain, facts: { unseenDamage: 1 } }), target, attack);
    expect(forecast.loss.mean).toBeCloseTo(forecast.commands.mean);
    expect(forecast.loss.upper).toBeGreaterThan(forecast.loss.mean);
  });

  it("prices fractional melee and missile commands using spent energy", () => {
    const w = world({ map: ROOM, player: { blows: 250, shots: 25 }, worn: ["a Dagger (1d4) (+0,+0)", "a Short Bow (x2)"], pack: ["20 Arrows (1d4)"], monsters: [{ grid: { x: 3, y: 2 } }] });
    const target = w.view.monsters()[0]!;
    expect(attackOutcome(w.view, target, "fight").energy).toBe(80);
    expect(attackOptions(w.view, target, "shoot")[0]!.energy).toBe(40);
  });

  it("rejects a spell encounter after affordable mana runs out", () => {
    const w = world({ map: ROOM, player: { hp: 80, maxHp: 80, sp: 1, maxSp: 10 }, spells: [{ name: "Magic Missile", sidx: 0, mana: 1 }],
      monsters: [{ grid: { x: 5, y: 2 }, hp: 30, maxHp: 30 }] });
    Object.assign(w.view, { spellInfo: () => ({ mana: 1, failChance: 0, canCastNow: true, description: "Inflicts 1d4 damage." }) });
    const target = w.view.monsters()[0]!;
    const attack = attackOptions(w.view, target, "cast_attack")[0]!;
    const forecast = forecastFight(tacticalFrame(w.view, { terrain: w.terrain }), target, attack);
    expect(forecast.limit).toBe(1);
    expect(forecast.viable).toBe(false);
  });

  it("keeps an immune target unkillable by the immune attack", () => {
    const w = world({ map: ROOM, player: { sp: 10, maxSp: 10 }, spells: [{ name: "Fire Bolt", sidx: 0 }], monsters: [{ grid: { x: 5, y: 2 }, raceFlags: ["IM_FIRE"] }] });
    Object.assign(w.view, { spellInfo: () => ({ mana: 1, failChance: 0, canCastNow: true, description: "Inflicts 1d8 fire damage." }) });
    const target = w.view.monsters()[0]!;
    const attack = attackOutcome(w.view, target, "cast_attack", readPack(w.view).attackSpell[0]!);
    expect(forecastFight(tacticalFrame(w.view, { terrain: w.terrain }), target, attack).commands.mean).toBe(Infinity);
  });
});

describe("healing and escape continuations", () => {
  it("rejects a cure that loses the exchange while a phase remains viable", () => {
    const w = world({ map: ROOM, player: { hp: 12, maxHp: 40 }, pack: ["2 Scrolls of Phase Door"], monsters: [{ grid: { x: 3, y: 2 }, hp: 100, maxHp: 100, raceFlags: ["NEVER_MOVE"] }], monsterRecall: () => "It can hit to hurt (2d8)." });
    const frame = tacticalFrame(w.view, { terrain: w.terrain });
    expect(forecastHeal(frame, 3).viable).toBe(false);
    expect(forecastPhase(frame).viable).toBe(true);
  });

  it("does not invent a usable phase after healing without an escape source", () => {
    const w = world({ map: ROOM, player: { hp: 12, maxHp: 40 }, monsters: [{ grid: { x: 3, y: 2 }, hp: 100, maxHp: 100 }] });
    expect(forecastHeal(tacticalFrame(w.view, { terrain: w.terrain }), 10).viable).toBe(false);
  });

  it("keeps partial cure timers unknown under API 2", () => {
    const w = world({ map: ROOM, player: { status: { confused: 1, poisoned: 1, cut: 1, blind: 1 } } });
    Object.assign(w.view, { apiVersion: "2.0.0" });
    const light = healingStatus(w.view, { handle: 1, name: "a Potion of Cure Light Wounds", power: 1 });
    expect(light).toMatchObject({ blind: 0, confused: 1, poisoned: 1, cut: 1 });
    expect(healingStatus(w.view, { handle: 1, name: "a Potion of Cure Critical Wounds", power: 3 })).toMatchObject({ confused: 0, poisoned: 0, cut: 0 });
  });

  it("reports no healing gain at full HP", () => {
    const w = world({ map: ROOM });
    expect(forecastHeal(tacticalFrame(w.view, { terrain: w.terrain }), 15).net).toBe(0);
  });

  it("keeps the failed-cast origin branch and an uncertain landing", () => {
    const w = world({ map: ROOM, player: { hp: 10, maxHp: 40 }, monsters: [{ grid: { x: 3, y: 2 }, speed: 120 }], monsterRecall: () => "It can bite to hurt (2d6)." });
    const forecast = forecastPhase(tacticalFrame(w.view, { terrain: w.terrain }), 0.25);
    expect(forecast.loss.upper).toBeGreaterThanOrEqual(24);
    expect(forecast.viable).toBe(false);
    expect(forecast.complete).toBe(false);
    expect(forecast.loss.unknown).toContain("landing");
  });

  it("does not call a fast dog's one-step sight break an escape", () => {
    const w = world({ map: ["########", "#...#..#", "#.@....#", "########"], monsters: [{ grid: { x: 5, y: 2 }, speed: 120 }], monsterRecall: () => "It can bite to hurt (1d4)." });
    const walk = forecastWalk(tacticalFrame(w.view, { terrain: w.terrain }), [{ x: 2, y: 1 }]);
    expect(walk.escaped).toBe(false);
    expect(walk.recontact).toBeGreaterThan(0);
  });

  it("accepts a checked stair with enough HP and invalidates a stale binding", () => {
    const w = world({ map: ["######", "#.@>.#", "######"] });
    const frame = tacticalFrame(w.view, { terrain: w.terrain });
    expect(forecastWalk(frame, [{ x: 3, y: 1 }], true)).toMatchObject({ escaped: true, viable: true });
    w.setPlayer({ hp: 12 });
    expect(tacticalKey(w.view)).not.toBe(frame.key);
  });
});
