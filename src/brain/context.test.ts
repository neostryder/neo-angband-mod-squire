import { describe, expect, it } from "vitest";
import { suppliedWorld, world, type WorldSpec } from "../harness.js";
import { defaultCfg } from "../settings.js";
import { archetype } from "../persona/persona.js";
import { createGoalPlanner, type GoalPlannerOptions } from "./goals.js";
import { LAYERS, LAYA_STATE_TOKENS, STATE_TOKEN_CAP, contextOf, entriesOf, fitToBudget, layerOf, stateHash, stateOf, stateTokens } from "./context.js";

type Options = Partial<Omit<GoalPlannerOptions, "terrain" | "log">>;

/** The request the goal planner sends for one world, after any warm-up steps. */
function requestFor(spec: WorldSpec, options: Options = {}, supplied = true, warm?: (w: ReturnType<typeof world>, ask: () => void) => void) {
  const w = supplied ? suppliedWorld(spec) : world(spec);
  const p = createGoalPlanner({ cfg: defaultCfg(), terrain: w.terrain, log: () => {}, reflex: false, rng: () => 0.5, ...options });
  warm?.(w, () => { p.ask(w.view); });
  const q = p.ask(w.view);
  if ("handBack" in q || "reflex" in q) throw new Error("expected a question");
  return q;
}

const ROOM = ["##########", "#........#", "#..@.....#", "#........#", "#.......>#", "##########"];

const SCENARIOS: readonly [string, () => ReturnType<typeof requestFor>][] = [
  ["town with a full pack", () => requestFor({ map: ROOM, player: { depth: 0, gold: 900 }, pack: ["5 Flasks of Oil", "2 Scrolls of Word of Recall"] })],
  ["poisoned at low HP with no potions", () => requestFor({ map: ROOM, player: { depth: 3, hp: 6, maxHp: 30, status: { poisoned: 5 } }, monsters: [{ grid: { x: 5, y: 2 }, race: "Grip, Farmer Maggot's Dog", level: 2 }] }, {}, false)],
  ["a unique in view", () => requestFor({ map: ROOM, player: { depth: 5 }, monsters: [{ grid: { x: 7, y: 2 }, race: "Bullroarer the Hobbit", level: 10, raceFlags: ["UNIQUE"], unique: true, speed: 120 }] })],
  ["a breeder level", () => requestFor({ map: ROOM, player: { depth: 2 }, monsters: [3, 4, 5].map((x) => ({ grid: { x, y: 4 }, race: "giant white mouse", level: 1, raceFlags: ["MULTIPLY"] })) })],
  ["a persona with a grudge", () => requestFor({ map: ROOM, player: { depth: 4 }, monsters: [{ grid: { x: 6, y: 2 }, race: "cave spider", level: 2 }] }, { persona: archetype("berserker"), grudges: () => [{ name: "cave spider", unique: false, kind: "hatred", intensity: "strong", count: 2 }] })],
  ["a cautious persona with lessons", () => requestFor({ map: ROOM, player: { depth: 1 } }, { persona: archetype("coward"), lessons: () => ["Floating eyes paralyse in melee.", "Grip is fast."] })],
  ["a hungry character in the dark", () => requestFor({ map: ROOM, player: { depth: 1, light: 0, status: { food: 100 } } }, {}, false)],
  ["a mage with spells and mana", () => requestFor({ map: ROOM, player: { depth: 2, cls: "Mage", sp: 6, maxSp: 8 }, spells: [{ name: "Magic Missile", sidx: 0, mana: 1, fail: 22 }], monsters: [{ grid: { x: 7, y: 3 }, race: "kobold", level: 2 }] })],
  ["a sleeping monster", () => requestFor({ map: ROOM, player: { depth: 3 }, monsters: [{ grid: { x: 7, y: 1 }, race: "cave bear", level: 9, asleep: true }] })],
  ["a stationary floating eye", () => requestFor({ map: ROOM, player: { depth: 1 }, monsters: [{ grid: { x: 4, y: 2 }, race: "floating eye", level: 1, raceFlags: ["NEVER_MOVE"] }] })],
  ["a pack of faster creatures", () => requestFor({ map: ROOM, player: { depth: 6 }, monsters: [6, 7, 8].map((x) => ({ grid: { x, y: 1 }, race: "jackal", level: 1, speed: 120 })) })],
  ["an unseen attacker", () => requestFor({ map: ["#########", "#<.@...,#", "#########"] }, {}, true, (w, ask) => { ask(); w.advance(10); w.setPlayer({ hp: w.view.player().hp - 4 }); })],
];

describe("decision context", () => {
  /* A change to one of these state snapshots changes what the trained adapters see. */
  it.each(SCENARIOS)("compiles %s into layers and the same state", (_name, make) => {
    const q = make();
    const context = q.context.layers;
    expect(context).toBeDefined();
    if (context === undefined) return;
    expect(q.context.stateHash).toBe(stateHash(q.request.state));
    expect(stateTokens(q.request.state)).toBeLessThan(STATE_TOKEN_CAP);
    expect(Object.fromEntries(LAYERS.map((layer) => [layer, Object.keys(layerOf(context, layer))]))).toMatchSnapshot("layers");
    expect(q.request.state).toMatchSnapshot("state");
  });

  it("puts the situation first and the rules primer last", () => {
    const keys = Object.keys(requestFor({ map: ROOM, player: { depth: 3 }, monsters: [{ grid: { x: 7, y: 3 }, race: "kobold", level: 2 }] }).request.state);
    expect(keys[0]).toBe("character");
    expect(keys.at(-1)).toBe("rules");
    expect(keys.indexOf("incoming")).toBeLessThan(keys.indexOf("rules"));
  });

  it("keeps a Laya state inside its budget by leaving out the steadiest layers", () => {
    const lessons = () => Array.from({ length: 60 }, (_, i) => `Lesson ${String(i)}: a cave spider swarm on level ${String(i)} cost the line a character.`);
    const spec: WorldSpec = { map: ROOM, player: { depth: 4 }, monsters: [{ grid: { x: 6, y: 2 }, race: "cave spider", level: 2 }] };
    const full = requestFor(spec, { lessons });
    expect(stateTokens(full.request.state)).toBeGreaterThan(LAYA_STATE_TOKENS);
    const small = requestFor(spec, { lessons, stateTokens: LAYA_STATE_TOKENS });
    expect(stateTokens(small.request.state)).toBeLessThanOrEqual(LAYA_STATE_TOKENS);
    expect(Object.keys(small.request.state).slice(0, 4)).toEqual(["character", "health", "creatures", "incoming"]);
  });

  it("keeps the context the same when only hidden truth changes", () => {
    const base: WorldSpec = { map: ROOM, player: { depth: 3 }, monsters: [{ grid: { x: 7, y: 3 }, race: "kobold", level: 2 }] };
    const plain = requestFor(base);
    const hidden = requestFor({ ...base, monsters: [...(base.monsters ?? []), { grid: { x: 8, y: 1 }, race: "poltergeist", level: 3, visible: false, speed: 140 }] });
    expect(hidden.request.state).toEqual(plain.request.state);
    expect(hidden.context.stateHash).toBe(plain.context.stateHash);
  });

  it("keeps the context the same when a creature has abilities the character has not learned", () => {
    const kobold = { grid: { x: 7, y: 3 }, race: "kobold", level: 2 };
    const recall = () => "Nothing is known about its attacks.";
    const plain = requestFor({ map: ROOM, player: { depth: 3 }, monsters: [kobold], monsterRecall: recall });
    const gifted = requestFor({ map: ROOM, player: { depth: 3 }, monsters: [{ ...kobold, spellFlags: ["BO_FIRE", "BLINK", "SCARE"] }], monsterRecall: recall });
    expect(gifted.request.state).toEqual(plain.request.state);
    expect(gifted.context.stateHash).toBe(plain.context.stateHash);
  });

  it("files each goal sentence on its own layer", () => {
    const longGoal = "Win the game. Chosen on the first look at this character.";
    const midGoal = "Depth target. Chosen on reaching a new level.";
    const nearGoal = "Explore this level. Chosen on reaching a new level.";
    const recent = "The near-term goal explore this level was met after 4 turns on dungeon level 2, because the level has no unexplored frontier.";
    const q = requestFor({ map: ROOM, player: { depth: 2 } }, {
      strategy: () => ({ aims: [], tripAllowed: () => false, longGoal, midGoal, nearGoal, outcomes: [recent] }),
    });
    const context = q.context.layers;
    expect(context).toBeDefined();
    if (context === undefined) return;
    expect(layerOf(context, "long_goal")).toEqual({ long_goal: longGoal });
    expect(layerOf(context, "mid_goal")).toEqual({ mid_goal: midGoal });
    expect(layerOf(context, "near_goal")).toEqual({ near_goal: nearGoal });
    expect(layerOf(context, "outcomes")["recent"]).toBe(recent);
  });

  it("files each key once and leaves undefined facts out", () => {
    const context = contextOf([["manual", "rules", "r"], ["memory", "hunger", undefined], ...entriesOf("knowledge", { lessons: "l" })]);
    expect(stateOf(context)).toEqual({ rules: "r", lessons: "l" });
    expect(layerOf(context, "knowledge")).toEqual({ lessons: "l" });
    expect(() => contextOf([["manual", "rules", 1], ["memory", "rules", 2]])).toThrow(/twice/);
  });

  it("drops whole layers, least needed first, only when a state is over budget", () => {
    const context = contextOf([["memory", "status", "s".repeat(400)], ["persona", "persona", "p".repeat(400)], ["knowledge", "lessons", "l".repeat(400)], ["manual", "rules", "r".repeat(400)]]);
    expect(fitToBudget(context, 1_000)).toEqual({ context, shed: [], over: false });
    const fitted = fitToBudget(context, 350);
    expect(fitted).toMatchObject({ shed: ["knowledge"], over: false });
    expect(Object.keys(stateOf(fitted.context))).toEqual(["status", "persona", "rules"]);
    expect(fitToBudget(context, 250)).toMatchObject({ shed: ["knowledge", "manual"], over: false });
    expect(fitToBudget(context, 100)).toMatchObject({ shed: ["knowledge", "manual"], over: true });
  });

  it("hashes equal states alike and different states apart", () => {
    expect(stateHash({ a: 1 })).toBe(stateHash({ a: 1 }));
    expect(stateHash({ a: 1 })).not.toBe(stateHash({ a: 2 }));
    expect(stateHash({ a: 1 })).toMatch(/^[0-9a-f]{16}$/);
  });
});
