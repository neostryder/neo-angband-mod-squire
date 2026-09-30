import { describe, expect, it } from "vitest";
import { world } from "../harness.js";
import { defaultCfg } from "../settings.js";
import { createGoalPlanner, type GoalDigest } from "./goals.js";
import type { Answer, ChoiceQuestion } from "./systemone.js";
import type { Question } from "./brain.js";
import { attackOptions, attackOutcome, escapeMana } from "./combat-kit.js";
import { readPack } from "./pack.js";

const CORRIDOR = ["########", "#.@....#", "#.#### #", "########"];

function planner(w: ReturnType<typeof world>) {
  return createGoalPlanner({ cfg: defaultCfg(), terrain: w.terrain, log: () => {}, reflex: false });
}

type Asked = ReturnType<ReturnType<typeof createGoalPlanner>["ask"]>;

function asked(q: Asked): Question<GoalDigest> {
  if ("handBack" in q) throw new Error(`expected a question, got a hand-back: ${q.handBack}`);
  if ("reflex" in q) throw new Error(`expected a question, got a reflex: ${q.reflex}`);
  return q;
}

function pick(choice: string): Readonly<Record<string, Answer>> {
  return { goal: { type: "choice", choice, confidence: 0.9, probabilities: { [choice]: 0.9 } } };
}

/** An archer in a corridor, with the engine able to report the line of fire. */
function archer(projectionPath: (to: { x: number; y: number }) => readonly { x: number; y: number }[]) {
  return world({
    map: CORRIDOR,
    monsters: [{ grid: { x: 5, y: 1 }, race: "cave orc" }],
    pack: ["99 Arrows"],
    worn: ["a Short Bow"],
    projectionPath,
  });
}

describe("volleys", () => {
  it("keeps firing at the held target without asking again", () => {
    const w = archer((to) => [to]);
    const p = planner(w);
    const q = asked(p.ask(w.view));
    expect((q.request.questions["goal"] as ChoiceQuestion).criteria).toHaveProperty("shoot");
    const choice = p.choose(pick("shoot"), q.context, w.view);
    if (!("plan" in choice)) throw new Error("expected a plan");
    expect(choice.plan.step(w.view, w.act)).toEqual({ code: "fire", args: { handle: 1 } });
    expect(choice.plan.step(w.view, w.act)).toEqual({ code: "fire", args: { handle: 1 } });
  });

  it("stops when the target dies", () => {
    const w = archer((to) => [to]);
    const p = planner(w);
    const choice = p.choose(pick("shoot"), asked(p.ask(w.view)).context, w.view);
    if (!("plan" in choice)) throw new Error("expected a plan");
    expect(choice.plan.step(w.view, w.act)).not.toBeNull();
    w.setMonsters([]);
    expect(choice.plan.step(w.view, w.act)).toBeNull();
  });

  it("stops when the target leaves sight", () => {
    const w = archer((to) => [to]);
    const p = planner(w);
    const choice = p.choose(pick("shoot"), asked(p.ask(w.view)).context, w.view);
    if (!("plan" in choice)) throw new Error("expected a plan");
    w.setMonsters([{ grid: { x: 5, y: 1 }, race: "cave orc", visible: false }]);
    expect(choice.plan.step(w.view, w.act)).toBeNull();
  });

  it("stops when the line of fire closes", () => {
    let blocked = false;
    const w = archer((to) => (blocked ? [{ x: 4, y: 1 }] : [to]));
    const p = planner(w);
    const choice = p.choose(pick("shoot"), asked(p.ask(w.view)).context, w.view);
    if (!("plan" in choice)) throw new Error("expected a plan");
    expect(choice.plan.step(w.view, w.act)).not.toBeNull();
    blocked = true;
    expect(choice.plan.step(w.view, w.act)).toBeNull();
  });

  it("stops when the ammunition runs out", () => {
    const w = archer((to) => [to]);
    const p = planner(w);
    const choice = p.choose(pick("shoot"), asked(p.ask(w.view)).context, w.view);
    if (!("plan" in choice)) throw new Error("expected a plan");
    expect(choice.plan.step(w.view, w.act)).not.toBeNull();
    w.setPack([]);
    expect(choice.plan.step(w.view, w.act)).toBeNull();
  });

  it("stops when the mana runs out", () => {
    const w = world({
      map: CORRIDOR,
      monsters: [{ grid: { x: 5, y: 1 }, race: "cave orc", level: 3 }],
      player: { sp: 5, maxSp: 5 },
      spells: [{ name: "Magic Missile", sidx: 0, mana: 2 }],
      projectionPath: (to) => [to],
    });
    const p = planner(w);
    const choice = p.choose(pick("cast_attack"), asked(p.ask(w.view)).context, w.view);
    if (!("plan" in choice)) throw new Error("expected a plan");
    expect(choice.plan.step(w.view, w.act)).toEqual({ code: "cast", args: { spell: 0 } });
    w.setPlayer({ sp: 1 });
    expect(choice.plan.step(w.view, w.act)).toBeNull();
  });

  it("casts a ball spell once, so each cast is aimed afresh", () => {
    const w = world({
      map: CORRIDOR,
      monsters: [{ grid: { x: 5, y: 1 }, race: "cave orc", level: 3 }],
      player: { sp: 20, maxSp: 20 },
      spells: [{ name: "Stinking Cloud", sidx: 4, mana: 3 }],
      projectionPath: (to) => [to],
    });
    const p = planner(w);
    const choice = p.choose(pick("cast_attack"), asked(p.ask(w.view)).context, w.view);
    if (!("plan" in choice)) throw new Error("expected a plan");
    expect(choice.plan.step(w.view, w.act)).toEqual({ code: "cast", args: { spell: 4 } });
    expect(choice.plan.step(w.view, w.act)).toBeNull();
  });

  it("stops when the watcher reports news", () => {
    const w = archer((to) => [to]);
    const p = planner(w);
    const choice = p.choose(pick("shoot"), asked(p.ask(w.view)).context, w.view);
    if (!("plan" in choice)) throw new Error("expected a plan");
    w.setMonsters([
      { grid: { x: 5, y: 1 }, race: "cave orc" },
      { grid: { x: 6, y: 1 }, race: "cave spider" },
    ]);
    expect(p.trigger(w.view, choice.plan)).toContain("cave spider");
  });

  it("fires one shot when the view cannot report the line of fire", () => {
    const w = world({
      map: CORRIDOR,
      monsters: [{ grid: { x: 5, y: 1 }, race: "cave orc" }],
      pack: ["99 Arrows"],
      worn: ["a Short Bow"],
    });
    const p = planner(w);
    const choice = p.choose(pick("shoot"), asked(p.ask(w.view)).context, w.view);
    if (!("plan" in choice)) throw new Error("expected a plan");
    expect(choice.plan.step(w.view, w.act)).toEqual({ code: "fire", args: { handle: 1 } });
    expect(choice.plan.step(w.view, w.act)).toBeNull();
  });
});

describe("combat outcomes and escape reserves", () => {
  function mage(sp = 5) {
    const w = world({ map: CORRIDOR, player: { cls: "Mage", level: 2, hp: 16, maxHp: 16, sp, maxSp: 5 },
      monsters: [{ grid: { x: 5, y: 1 }, race: "white worm mass", hp: 30, raceFlags: ["MULTIPLY"] }],
      spells: [{ name: "Magic Missile", sidx: 0, mana: 2 }, { name: "Phase Door", sidx: 1, mana: 1 }], projectionPath: (to) => [to] });
    Object.assign(w.view, { spellInfo: (sidx: number) => ({ description: sidx === 0 ? "Inflicts an average of 7.5 damage (3d4)." : "Teleports you a short distance.", mana: sidx === 0 ? 2 : 1, failChance: 0, canCastNow: true }) });
    return w;
  }

  it("stops the worm volley before spending the mana needed for Phase Door", () => {
    const w = mage();
    const p = planner(w);
    const choice = p.choose(pick("cast_attack"), asked(p.ask(w.view)).context, w.view);
    if (!("plan" in choice)) throw new Error("expected a plan");
    expect(choice.plan.step(w.view, w.act)).toEqual({ code: "cast", args: { spell: 0 } });
    w.setPlayer({ sp: 3 });
    expect(choice.plan.step(w.view, w.act)).toEqual({ code: "cast", args: { spell: 0 } });
    w.setPlayer({ sp: 2 });
    expect(choice.plan.step(w.view, w.act)).toBeNull();
    expect(escapeMana(w.view)).toBe(1);
    expect(attackOptions(w.view, w.view.monsters()[0]!, "cast_attack")).toEqual([]);
  });

  it("rechecks the mana reserve before a single shot on an older view", () => {
    const w = mage();
    Object.assign(w.view, { projectionPath: undefined });
    const p = planner(w);
    const choice = p.choose(pick("cast_attack"), asked(p.ask(w.view)).context, w.view);
    if (!("plan" in choice)) throw new Error("expected a plan");
    w.setPlayer({ sp: 2 });
    expect(choice.plan.step(w.view, w.act)).toBeNull();
  });

  it("prices the full-mana Mage's killing attack above a futile bat retreat", () => {
    const w = mage(2);
    w.setPlayer({ level: 1, hp: 1, maxHp: 10 });
    w.setMonsters([{ grid: { x: 3, y: 1 }, race: "fruit bat", hp: 3, speed: 120 }]);
    Object.assign(w.view, { monsterRecall: () => ({ text: "It can bite to hurt (1d1, 50%)." }) });
    const p = planner(w);
    const q = asked(p.ask(w.view));
    const attack = q.context.offers.find((offer) => offer.goal === "cast_attack");
    expect(attack?.criteria).toContain("A hit could kill the target now.");
    expect(attack?.criteria).toContain("immediate killing attempt spends the escape mana reserve");
    expect(attack?.risk).toBeLessThan(1);
    expect(q.context.offers.some((offer) => offer.goal === "retreat")).toBe(false);
    expect(attackOptions(w.view, w.view.monsters()[0]!, "cast_attack", { facts: { unseenDamage: 1 } })).toEqual([]);
  });

  it("selects damage per action before damage per mana", () => {
    const w = mage(20);
    w.setPlayer({ maxSp: 20 });
    Object.assign(w.view, { spellbooks: () => [{ name: "book", spells: [
      { name: "Magic Missile", sidx: 0, mana: 2, learned: true, forgotten: false, fail: 0 },
      { name: "Fire Ball", sidx: 2, mana: 8, learned: true, forgotten: false, fail: 0 },
    ] }], spellInfo: (sidx: number) => ({ description: `Inflicts an average of ${sidx === 2 ? "16 fire" : "7.5"} damage.`, mana: sidx === 2 ? 8 : 2, failChance: 0, canCastNow: true }) });
    expect(attackOptions(w.view, w.view.monsters()[0]!, "cast_attack")[0]?.source).toMatchObject({ sidx: 2 });
    w.setMonsters([{ grid: { x: 5, y: 1 }, hp: 30, raceFlags: ["IM_FIRE"] }]);
    expect(attackOptions(w.view, w.view.monsters()[0]!, "cast_attack")[0]?.source).toMatchObject({ sidx: 0 });
  });

  it("keeps a non-immune component of a mixed-element spell", () => {
    const w = mage();
    Object.assign(w.view, { spellInfo: () => ({ description: "Inflicts an average of 12 fire and 5.5 cold damage.", mana: 2, failChance: 0, canCastNow: true }) });
    w.setMonsters([{ grid: { x: 5, y: 1 }, hp: 30, raceFlags: ["IM_FIRE"] }]);
    expect(attackOutcome(w.view, w.view.monsters()[0]!, "cast_attack", readPack(w.view).attackSpell[0]!).damage).toBe(5.5);
  });

  it("stops an oil volley at the last lantern refill", () => {
    const w = world({ map: CORRIDOR, pack: ["2 Flasks of Oil"], worn: ["a Lantern (7000 turns)"], monsters: [{ grid: { x: 5, y: 1 } }], projectionPath: (to) => [to] });
    const p = planner(w);
    const choice = p.choose(pick("throw_oil"), asked(p.ask(w.view)).context, w.view);
    if (!("plan" in choice)) throw new Error("expected a plan");
    expect(choice.plan.step(w.view, w.act)).toEqual({ code: "throw", args: { handle: 1 } });
    w.setPack(["a Flask of Oil"]);
    expect(choice.plan.step(w.view, w.act)).toBeNull();
    const quivered = world({ map: CORRIDOR, quiver: ["2 Flasks of Oil"], worn: ["a Lantern (7000 turns)"], monsters: [{ grid: { x: 5, y: 1 } }] });
    expect(attackOptions(quivered.view, quivered.view.monsters()[0]!, "throw_oil")).toHaveLength(1);
  });

  it("throws the last oil when a torch supplies the light, including at a fire-immune target", () => {
    const w = world({ map: CORRIDOR, pack: ["a Flask of Oil"], worn: ["a Wooden Torch (5000 turns)"], monsters: [{ grid: { x: 5, y: 1 }, raceFlags: ["IM_FIRE"] }] });
    expect(attackOptions(w.view, w.view.monsters()[0]!, "throw_oil")[0]).toMatchObject({ damage: 7.5, fuelReserve: 0 });
  });

  it("stops before the last charge of a device with a known self-teleport effect", () => {
    const w = world({ map: CORRIDOR, pack: ["a Wand of Magic Missile (1 charge)"], monsters: [{ grid: { x: 5, y: 1 } }], inspect: () => "Inflicts an average of 7.5 damage. It teleports you away." });
    expect(attackOptions(w.view, w.view.monsters()[0]!, "aim_wand")).toEqual([]);
    w.setPack(["a Wand of Magic Missile (2 charges)"]);
    expect(attackOptions(w.view, w.view.monsters()[0]!, "aim_wand")).toHaveLength(1);
  });

  it("offers comparable facts for melee, missiles, oil, spells and wands", () => {
    const w = world({ map: CORRIDOR, player: { blows: 200, shots: 10, toDam: 0, sp: 5, maxSp: 5 },
      worn: ["a Dagger (2d4) (+0,+0)", "a Long Bow (x3) (+0,+1)"], pack: ["20 Arrows (1d4) (+0,+0)", "a Flask of Oil", "a Wand of Magic Missile (2 charges)"],
      spells: [{ name: "Magic Missile", sidx: 0, mana: 2 }], monsters: [{ grid: { x: 3, y: 1 }, hp: 12 }],
      inspect: (ref) => ref === 3 ? "Inflicts an average of 20 damage. Your chance of success is 80.0%." : null });
    Object.assign(w.view, { spellInfo: () => ({ description: "Inflicts an average of 15 damage.", mana: 2, failChance: 0, canCastNow: true }) });
    const offers = asked(planner(w).ask(w.view)).context.offers;
    for (const kind of ["fight", "shoot", "throw_oil", "cast_attack", "aim_wand"]) expect(offers.find((offer) => offer.goal === kind)?.criteria).toContain("damage per action");
    expect(offers.find((offer) => offer.goal === "aim_wand")?.criteria).toContain("Estimated damage per action is 16");
    w.setPlayer({ shots: 20 });
    expect(attackOptions(w.view, w.view.monsters()[0]!, "shoot")[0]).toMatchObject({ damage: 21, kill: false });
  });

  it("does not invent a killing attack when the blow count or spell description is missing", () => {
    const w = world({ map: CORRIDOR, player: { blows: 0, sp: 5, maxSp: 5 }, worn: ["a Dagger (1d4) (+0,+0)"], monsters: [{ grid: { x: 3, y: 1 }, hp: 1 }], spells: [{ name: "Magic Missile", sidx: 0 }] });
    expect(attackOutcome(w.view, w.view.monsters()[0]!, "fight")).toMatchObject({ damage: null, kill: false });
    expect(attackOptions(w.view, w.view.monsters()[0]!, "cast_attack")[0]).toMatchObject({ damage: null, kill: false });
  });
});
