import { describe, expect, it } from "vitest";
import type { AgentView, LoadoutSimulation } from "@rpgm-tools/neo-angband-core";
import { adjustDamArmor, hitChance, turnEnergy } from "@rpgm-tools/neo-angband-core";
import { world } from "../harness.js";
import { armorDamage, castingMixture, forecastExposure, harmlessKind, hitProbability, meleeMoments, assessThreat, bestBallAim, breederBlow, clearShot, incomingDamage, knownCapability, knownSpellFlags, monsterActions, pickAttackSpell, threatWindow, unseenDamageAt } from "./threat-model.js";
import { createGoalPlanner } from "./goals.js";
import { defaultCfg } from "../settings.js";
import { defaultPersona } from "../persona/persona.js";
import { riskQuantile } from "./threat-model.js";

describe("round 8 early creature damage", () => {
  const races = ["filthy street urchin", "scruffy little dog", "scrawny cat", "village idiot", "blubbering idiot", "mean-looking mercenary", "mangy-looking leper", "rock lizard", "giant white mouse"];

  it.each([0, 1, 2])("does not invent lethal damage from unseen blows at DL%i", (depth) => {
    for (const race of races) for (const hp of [10, 13, 15]) for (const x of [3, 5]) {
      const w = world({ map: ["########", "#.@....#", "########"], player: { depth, level: 1, hp, maxHp: hp },
        monsters: [{ grid: { x, y: 1 }, race, level: race === "rock lizard" || race === "giant white mouse" ? 1 : 0,
          knownCombat: { blows: [], averageHp: null, health: "unhurt", status: [], spellFrequency: null, innateFrequency: null } }] });
      const exposure = forecastExposure(w.view, w.at(), 1, w.terrain);
      expect(exposure.upper, `${race} at DL${depth}`).toBeLessThan(hp);
      if (x === 5) expect(exposure.upper).toBe(0);
      expect(exposure.unknown).toContain("blows");
    }
  });

  it("does not turn a learned begging or stealing touch into HP damage", () => {
    const w = world({ map: ["#####", "#.@.#", "#####"], player: { hp: 10, maxHp: 10, level: 1 },
      monsters: [{ grid: { x: 3, y: 1 }, race: "filthy street urchin", level: 0,
        knownCombat: { blows: [{ method: "BEG", effect: "NONE", damage: null }, { method: "TOUCH", effect: "EAT_GOLD", damage: null }], averageHp: null, health: "unhurt", status: [], spellFrequency: null, innateFrequency: null } }] });
    expect(forecastExposure(w.view).upper).toBe(0);
  });

  it.each([0, 1, 2])("bounds learned early creature damage by its actual dice at DL%i", (depth) => {
    const creatures = [
      ["filthy street urchin", 0, 110, "TOUCH", "EAT_GOLD", 0], ["scruffy little dog", 0, 110, "BITE", "HURT", 1],
      ["scrawny cat", 0, 110, "CLAW", "HURT", 1], ["village idiot", 0, 120, "DROOL", "NONE", 0],
      ["blubbering idiot", 0, 110, "DROOL", "NONE", 0], ["mean-looking mercenary", 0, 110, "HIT", "HURT", 10],
      ["mangy-looking leper", 0, 110, "BEG", "NONE", 0], ["rock lizard", 1, 110, "BITE", "HURT", 1],
      ["giant white mouse", 1, 110, "BITE", "HURT", 2],
    ] as const;
    for (const [race, level, speed, method, effect, sides] of creatures) for (const hp of [10, 13, 15]) {
      const w = world({ map: ["########", "#.@....#", "########"], player: { depth, level: 1, hp, maxHp: hp },
        monsters: [{ grid: { x: 3, y: 1 }, race, level, speed,
          knownCombat: { blows: [{ method, effect, damage: sides === 0 ? null : { base: 0, dice: 1, sides, mBonus: 0 } }], averageHp: null, health: "unhurt", status: [], spellFrequency: null, innateFrequency: null } }] });
      const exposure = forecastExposure(w.view);
      expect(exposure.upper, race).toBeLessThan(hp);
      expect(exposure.upper, race).toBeLessThanOrEqual(sides * (speed === 120 ? 2 : 1));
    }
  });

  it("retains learned damage from a random-moving town attacker", () => {
    const w = world({ map: ["#####", "#.@.#", "#####"], player: { depth: 0 },
      monsters: [{ grid: { x: 3, y: 1 }, raceFlags: ["RAND_50"], level: 0,
        knownCombat: { blows: [{ method: "HIT", effect: "HURT", damage: { base: 0, dice: 1, sides: 10, mBonus: 0 } }], averageHp: null, health: "unhurt", status: [], spellFrequency: null, innateFrequency: null } }] });
    expect(harmlessKind(w.view.monsters()[0]!, w.view, 10)).toBe(false);
  });

  it("separates expected, persona scenario and known maximum damage", () => {
    const w = world({ map: ["#####", "#.@.#", "#####"], player: { hp: 10, maxHp: 10, level: 1, ac: 0 },
      monsters: [{ grid: { x: 3, y: 1 }, race: "mean-looking mercenary", level: 0,
        knownCombat: { blows: [{ method: "HIT", effect: "HURT", damage: { base: 0, dice: 1, sides: 10, mBonus: 0 } }], averageHp: null, health: "unhurt", status: [], spellFrequency: null, innateFrequency: null } }] });
    Object.assign(w.view, { blowRules: { effects: new Map([["HURT", 40]]), methods: new Map([["HIT", true]]) } });
    const bold = defaultPersona();
    bold.sliders.boldness = 100; bold.sliders.selfpreservation = 0; bold.sliders.paranoia = 0;
    const timid = defaultPersona();
    timid.sliders.boldness = 0; timid.sliders.selfpreservation = 100; timid.sliders.paranoia = 100;
    const a = forecastExposure(w.view, w.at(), 1, w.terrain, { quantile: riskQuantile(bold) });
    const b = forecastExposure(w.view, w.at(), 1, w.terrain, { quantile: riskQuantile(timid) });
    expect(a.mean).toBeLessThan(a.upper);
    expect(a.upper).toBeLessThan(b.upper);
    expect(b.upper).toBeLessThanOrEqual(b.worst!);
    expect(b.worst).toBe(10);
  });

  it.each(["cave spider", "Fang, Farmer Maggot's Dog", "Grip, Farmer Maggot's Dog", "jackal"])("retains known %s damage and swarm exposure", (race) => {
    const w = world({ map: ["#######", "#.....#", "#..@..#", "#.....#", "#######"], player: { hp: 10, maxHp: 10, level: 1 },
      monsters: [{ grid: { x: 4, y: 2 }, race, level: 2, speed: 120 }], monsterRecall: () => "It can bite to hurt (1d4)." });
    expect(forecastExposure(w.view).upper).toBe(8);
    w.setPlayer({ hp: 8 });
    expect(forecastExposure(w.view).upper).toBeGreaterThanOrEqual(w.view.player().hp);
    w.setMonsters([{ grid: { x: 4, y: 2 }, race, level: 2, speed: 120 }, { grid: { x: 2, y: 2 }, race, level: 2, speed: 120 }]);
    expect(forecastExposure(w.view).upper).toBeGreaterThan(10);
  });
});

describe("physical forecast parity", () => {
  it.each([0, 10, 70, 150, 240, 300])("matches Core hit and armor arithmetic at AC %i", (ac) => {
    for (const toHit of [0, 9, 40, 120]) {
      const core = hitChance(toHit, ac);
      expect(hitProbability(toHit, ac)).toBe(core.numerator / core.denominator);
    }
    for (let damage = 1; damage <= 60; damage++) expect(armorDamage(damage, ac)).toBe(adjustDamArmor(damage, ac));
  });

  it("applies armor to every integer die outcome before averaging", () => {
    const w = world({ map: ["#####", "#.@.#", "#####"], player: { ac: 100 }, monsters: [{ grid: { x: 3, y: 1 }, level: 2,
      knownCombat: { blows: [{ method: "HIT", effect: "HURT", damage: { base: 0, dice: 1, sides: 4, mBonus: 0 } }], health: "unhurt", averageHp: 10, spellFrequency: null, innateFrequency: null, status: [] } }] });
    Object.assign(w.view, { blowRules: { effects: new Map([["HURT", 40]]), methods: new Map([["HIT", true]]) } });
    const m = w.view.monsters()[0]!;
    const first = meleeMoments(w.view, m)!;
    expect(first.mean).toBeCloseTo((1 + 2 + 3 + 3) / 4 * hitProbability(46, 100));
    expect(first.upper).toBe(3);
    expect(first.variance).toBeGreaterThan(0);
    w.setPlayer({ ac: 0 });
    expect(meleeMoments(w.view, m)!.mean).toBeGreaterThan(first.mean);
  });

  it("keeps a physical elemental component through immunity", () => {
    const w = world({ map: ["#####", "#.@.#", "#####"], player: { ac: 100, status: { resFire: 1 } }, monsters: [{ grid: { x: 3, y: 1 }, level: 1,
      knownCombat: { blows: [{ method: "HIT", effect: "FIRE", damage: { base: 12, dice: 0, sides: 0, mBonus: 0 } }], health: "unhurt", averageHp: null, spellFrequency: null, innateFrequency: null, status: [] } }] });
    Object.assign(w.view, { blowRules: { effects: new Map([["FIRE", 10]]), methods: new Map([["HIT", true]]) },
      simulateLoadout: () => ({ before: { stats: { resistElements: ["FIRE"], resists: [3] } } }) as unknown as LoadoutSimulation });
    expect(meleeMoments(w.view, w.view.monsters()[0]!)!.upper).toBe(adjustDamArmor(12, 150));
  });

  it("keeps unsupported dice components and absent effect definitions uncertain", () => {
    const w = world({ map: ["#####", "#.@.#", "#####"], monsters: [{ grid: { x: 3, y: 1 }, knownCombat: { blows: [{ method: "HIT", effect: "HURT", damage: { base: 0, dice: 1, sides: 4, mBonus: 2 } }], health: "unhurt", averageHp: null, spellFrequency: null, innateFrequency: null, status: [] } }] });
    expect(meleeMoments(w.view, w.view.monsters()[0]!)!.uncertain).toBe(true);
    expect(forecastExposure(w.view).unknown).toContain("blows");
  });
});

describe("casting mixture", () => {
  it("tries non-innate before innate and spends failed casting turns", () => {
    const w = world({ map: ["#####", "#.@.#", "#####"], monsters: [{ grid: { x: 3, y: 1 }, knownCombat: { blows: [], health: "unhurt", averageHp: null, spellFrequency: { percent: 20, exact: true }, innateFrequency: { percent: 50, exact: true }, status: [] } }] });
    const mixture = castingMixture(w.view.monsters()[0]!, ["HOLD", "BR_FIRE"], 1);
    expect(mixture).toMatchObject({ spell: 0.2, innate: 0.4, damageSpell: 0, melee: 0.4 });
  });

  it("treats rounded and absent frequencies as uncertain rates", () => {
    const w = world({ map: ["#####", "#.@.#", "#####"], monsters: [{ grid: { x: 3, y: 1 } }] });
    expect(castingMixture(w.view.monsters()[0]!, ["HOLD"])).toMatchObject({ spell: 0.1, high: 0.6 });
    expect(castingMixture(w.view.monsters()[0]!, [])).toMatchObject({ spell: 0, innate: 0, melee: 1 });
    const monster = { ...w.view.monsters()[0]!, knownCombat: { blows: [], averageHp: null, health: "unhurt" as const, status: [], spellFrequency: { percent: 20, exact: false }, innateFrequency: null } };
    expect(castingMixture(monster, ["HOLD"])).toMatchObject({ spell: 0.155, high: 0.4 });
  });
});

describe("moving exposure forecast", () => {
  it("charges a remembered pursuer across a corner and keeps background loss separate", () => {
    const w = world({ map: ["########", "#.@#...#", "#......#", "########"], player: { status: { poisoned: 5 } }, monsters: [{ id: 1, grid: { x: 5, y: 1 }, visible: false, speed: 120 }], monsterRecall: () => "It can bite to hurt (1d4)." });
    const facts = { monsters: w.view.monsters(), lastSeen: new Map([[1, 0]]), energy: turnEnergy };
    w.advance(30);
    const seen = forecastExposure(w.view, w.at(), 2, w.terrain, facts);
    expect(seen.upper).toBeGreaterThan(2);
    expect(seen.unknown).toContain("remembered-position");
    expect(forecastExposure(w.view, w.at(), 2, w.terrain, { ...facts, monsters: [] }).upper).toBe(2);
  });

  it("retains an unknown-region threat when remembered reach exhausts its budget", () => {
    const rows = Array.from({ length: 80 }, () => " ".repeat(80));
    rows[77] = " ".repeat(76) + ".@." + " ";
    const w = world({ map: rows, monsters: [{ grid: { x: 1, y: 1 }, id: 1, visible: false }], monsterRecall: () => "It can hit to hurt (1d4)." });
    w.advance(10000);
    const exposure = forecastExposure(w.view, w.at(), 1, w.terrain, { monsters: w.view.monsters(), lastSeen: new Map([[1, 0]]), energy: turnEnergy });
    expect(exposure.upper).toBeGreaterThan(0);
    expect(exposure.unknown).toContain("position-budget");
  });

  it("keeps the fractional initiative phase in the expected exposure", () => {
    const w = world({ map: ["#####", "#.@.#", "#####"], monsters: [{ grid: { x: 3, y: 1 }, speed: 110 }], monsterRecall: () => "It can hit to hurt (1d1)." });
    const half = forecastExposure(w.view, w.at(), 0.5, w.terrain, { energy: turnEnergy });
    expect(half.mean).toBe(0.5);
    expect(half.upper).toBe(1);
    w.setMonsters([{ grid: { x: 3, y: 1 }, speed: 120 }]);
    expect(forecastExposure(w.view, w.at(), 0.5, w.terrain, { energy: turnEnergy }).mean).toBe(1);
  });

  it("queues corridor attackers and increases exposure over two actions", () => {
    const w = world({ map: ["########", "#.@....#", "########"], monsters: [{ grid: { x: 3, y: 1 } }, { grid: { x: 4, y: 1 } }], monsterRecall: () => "It can bite to hurt (1d4)." });
    const one = forecastExposure(w.view, w.at(), 1, w.terrain);
    const two = forecastExposure(w.view, w.at(), 2, w.terrain);
    expect(one.upper).toBe(4);
    expect(two.upper).toBe(8);
    expect(one.mean).toBeLessThan(one.upper);
    expect(forecastExposure(w.view, w.at(), 1, w.terrain, { monsters: [] }).upper).toBeLessThanOrEqual(one.upper);
  });
});

describe("starvation attribution", () => {
  it.each([[100, 0], [90, 1], [50, 5], [0, 10]])("prices food %i as %i known damage per action", (food, damage) => {
    const w = world({ map: ["#####", "#.@.#", "#####"], player: { status: { food } } });
    expect(incomingDamage(w.view).damage).toBe(damage);
    expect(incomingDamage(w.view, w.at(), 2).damage).toBe(2 * damage);
    expect(incomingDamage(w.view, w.at(), 1, w.terrain, { creaturesOnly: true }).damage).toBe(0);
    expect(incomingDamage(w.view).uncertainty).toBe(0);
  });
});

describe("breeder damage evidence", () => {
  it("uses observed one-point blows rather than the unknown-attack ceiling", () => {
    const w = world({ map: ["######", "#.@..#", "######"], player: { hp: 60, maxHp: 60 }, monsters: [{ grid: { x: 3, y: 1 }, race: "giant white louse", level: 1, raceFlags: ["MULTIPLY"] }] });
    const m = w.view.monsters()[0]!;
    const seen = new Map([[m.race, 1]]);
    expect(breederBlow(w.view, m, seen)).toBe(1);
    expect(incomingDamage(w.view, w.at(), 1, w.terrain, { observedDamage: seen }).damage).toBe(1);
    const unknown = incomingDamage(w.view, w.at(), 1, w.terrain).damage;
    expect(unknown).toBe(4);
    w.setPlayer({ hp: 20, maxHp: 20 });
    expect(incomingDamage(w.view, w.at(), 1, w.terrain).damage).toBe(3);
  });

  it.each(["poison", "acid", "paralyse", "confuse"])("retains danger for a breeder whose recall shows %s", (effect) => {
    const w = world({ map: MAP, monsters: [{ grid: { x: 3, y: 1 }, race: "worm mass", level: 1, raceFlags: ["MULTIPLY"] }], monsterRecall: () => `It can touch to ${effect} (1d1).` });
    expect(breederBlow(w.view, w.view.monsters()[0]!, new Map([["worm mass", 1]]))).toBeNull();
  });

  it("does not cap a higher level breeder, a unique or a creature with magic", () => {
    for (const monster of [
      { level: 3, raceFlags: ["MULTIPLY"], spellFlags: [] },
      { level: 1, raceFlags: ["MULTIPLY", "UNIQUE"], spellFlags: [] },
      { level: 1, raceFlags: ["MULTIPLY"], spellFlags: ["HOLD"] },
    ]) {
      const w = world({ map: MAP, monsters: [{ grid: { x: 3, y: 1 }, ...monster, race: "worm mass" }], monsterRecall: () => "It can bite to hurt (1d1)." });
      expect(breederBlow(w.view, w.view.monsters()[0]!)).toBeNull();
    }
  });
});

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

  it("raises lethality with lost health and faster enemies", () => {
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

  it("keeps a mild prior for unseen level zero blows", () => {
    const w = world({ map: MAP, player: { level: 1, hp: 10 }, monsters: [{ grid: { x: 3, y: 1 }, level: 0 }] });
    expect(assessThreat(w.view.monsters()[0]!, w.view.player(), w.view.monsters(), w.view).band).toBe(0);
    w.setPlayer({ hp: 8 });
    expect(assessThreat(w.view.monsters()[0]!, w.view.player(), w.view.monsters(), w.view).band).toBe(0);
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
    expect(rate()).toBe(0);
    w.setPlayer({ hp: 13 });
    w.setMonsters([{ grid: { x: 6, y: 1 }, race: "mean-looking mercenary", level: 0 }]);
    expect(rate()).toBe(0);
    w.setPlayer({ hp: 3 });
    expect(rate()).toBe(0);
    w.setMonsters([{ grid: { x: 3, y: 1 }, race: "mean-looking mercenary", level: 0 }]);
    recall(w.view, "He can hit to hurt (1d10).");
    expect(rate()).toBeGreaterThanOrEqual(2);
  });

  it("keeps the population prior for a level 0 creature below town", () => {
    const w = world({ map: MAP, player: { level: 1, hp: 7, maxHp: 13 }, monsters: [{ grid: { x: 3, y: 1 }, level: 0 }] });
    recall(w.view, "Nothing is known about his attack.");
    expect(assessThreat(w.view.monsters()[0]!, w.view.player(), w.view.monsters(), w.view).band).toBe(0);
    w.setPlayer({ hp: 4 });
    expect(assessThreat(w.view.monsters()[0]!, w.view.player(), w.view.monsters(), w.view).band).toBe(0);
  });

  it("rates each creature alone, so a crowd does not raise a distant one's band", () => {
    const eye = { grid: { x: 6, y: 1 }, race: "floating eye", level: 1, raceFlags: ["NEVER_MOVE"] };
    const dogs = [3, 4].map((x) => ({ grid: { x, y: 1 }, race: "wild dog", level: 1 }));
    const w = world({ map: MAP, player: { level: 1, hp: 8, maxHp: 12 }, monsters: [eye, ...dogs] });
    const band = () => assessThreat(w.view.monsters()[0]!, w.view.player(), w.view.monsters(), w.view).band;
    const crowded = band();
    w.setMonsters([eye]);
    expect(crowded).toBe(band());
    expect(crowded).toBeLessThan(3);
  });

  it("does not rate a crowd of townspeople deadly to a level 1 mage", () => {
    const folk = [3, 4, 5].map((x) => ({ grid: { x, y: 1 }, race: "village idiot", level: 0 }));
    const w = world({ map: MAP, player: { level: 1, cls: "Mage", hp: 9, maxHp: 9, depth: 0 }, monsters: folk });
    recall(w.view, "Nothing is known about his attack.");
    for (const monster of w.view.monsters()) expect(assessThreat(monster, w.view.player(), w.view.monsters(), w.view).band).toBe(0);
  });
});

describe("incoming damage windows", () => {
  it.each(["floating eye", "grey mold"])("keeps a known stationary %s out of melee range without a learned movement flag", (race) => {
    const w = world({ map: MAP, monsters: [{ grid: { x: 4, y: 1 }, race }], monsterRecall: () => race === "grey mold" ? "It does not deign to chase intruders. It can hit to hurt (1d4)." : "" });
    expect(incomingDamage(w.view, w.at(), 2, w.terrain)).toMatchObject({ damage: 0, status: 0 });
    expect(incomingDamage(w.view, { x: 3, y: 1 }, 1, w.terrain).damage).toBeGreaterThan(0);
  });

  it("uses learned API 2 spell flags without requiring a recall sentence", () => {
    const w = world({ map: MAP, monsters: [{ grid: { x: 6, y: 1 }, raceFlags: ["NEVER_BLOW", "NEVER_MOVE"], spellFlags: ["HOLD"], knownSpellFlags: ["HOLD"] }] });
    expect(knownSpellFlags(w.view, w.view.monsters()[0]!)).toEqual(["HOLD"]);
    expect(incomingDamage(w.view).status).toBe(150);
  });

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
    const w = world({ map: MAP, monsters: [{ grid: { x: 7, y: 1 }, level: 2, spellFlags: ["BO_FIRE"], raceFlags: ["NEVER_BLOW"] }], monsterRecall: () => "It may cast spells." });
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
    const info: NonNullable<AgentView["spellInfo"]> = (index) => ({
      token: { epoch: 0, revision: 0 }, name: index === 1 ? "Stinking Cloud" : "Magic Missile", level: 1,
      /* Magic Missile's 3d4 averages 7.5, and the engine writes the decimal. */
      description: `Inflicts an average of ${index === 1 ? "16" : "7.5"} damage.`,
      mana: index === 1 ? 8 : 2, failChance: 10, canCastNow: true,
    });
    expect(pickAttackSpell(spells, info)?.sidx).toBe(1);
    expect(pickAttackSpell(spells)?.sidx).toBe(1);
    expect(w.view.spellInfo).toBeUndefined();
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
    Object.assign(castWorld.view, { projectionPath: w.view.projectionPath, blastArea: w.view.blastArea });
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
