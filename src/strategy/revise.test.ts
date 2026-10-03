import type { AgentView, ItemView, SpellbookView } from "@rpgm-tools/neo-angband-core";
import { describe, expect, it } from "vitest";
import { itemNamed, world } from "../harness.js";
import { defaultPersona } from "../persona/persona.js";
import {
  CHECKPOINT_ACTIONS, COMMAND_COUNTS, guardAims, meaningfulAction, nextCheck, openAims, REVISE_BLOCK_TURNS, reviseGoalRequest, reviseThreshold, reviseYes,
  startWatch, usedBy, watchStep, blockFor, type ReviseWatch, type Used,
} from "./revise.js";

const ROOM = ["#####", "#.@.#", "#####"];

const DRANK: Used = { healing: true, escape: false };
const READ: Used = { healing: false, escape: true };

/** A watch that takes each look as it happens and says what fired. Harness views read live state, so each look is stepped at once. */
function watcher(): (view: AgentView, used?: Used) => string[] {
  let watch: ReviseWatch | null = null;
  return (view, used) => {
    if (watch === null) {
      watch = startWatch(view);
      return [];
    }
    const step = watchStep(watch, view, used);
    watch = step.watch;
    return step.fired.map((event) => event.trigger);
  };
}

function withPack(view: AgentView, extra: readonly ItemView[]): AgentView {
  const pack = [...view.inventory(), ...extra];
  return { ...view, inventory: () => pack };
}

function withSpells(view: AgentView, learned: number): AgentView {
  const book: SpellbookView = {
    tval: 90, name: "Magic for Beginners", realm: "arcane",
    spells: [0, 1, 2].map((sidx) => ({ name: `Spell ${String(sidx)}`, sidx, bidx: 0, level: 1, mana: 1, fail: 10, learned: sidx < learned, worked: false, forgotten: false, studyEligible: false, infoLine: "" })),
  };
  return { ...view, spellbooks: () => [book] };
}

describe("revise-goal triggers", () => {
  it("fires a near-death escape once, when hit points fall below a fifth and then come back above half", () => {
    const w = world({ map: ROOM, player: { depth: 3, hp: 100, maxHp: 100 } });
    const look = watcher();
    const fired = [100, 15, 40, 60, 70, 70].map((hp) => {
      w.setPlayer({ hp });
      return look(w.view);
    });
    expect(fired).toEqual([[], [], [], ["near-death"], [], []]);
  });

  it("fires when the last escape is used, and not again while none is carried", () => {
    const w = world({ map: ROOM, player: { depth: 3 }, pack: ["2 Scrolls of Phase Door"] });
    const look = watcher();
    const fired = [look(w.view)];
    w.setPack(["a Scroll of Phase Door"]);
    fired.push(look(w.view, READ));
    w.setPack([]);
    fired.push(look(w.view, READ), look(w.view));
    expect(fired).toEqual([[], [], ["escape"], []]);
  });

  it("does not take a dropped, sold or burnt last escape for a used one", () => {
    const w = world({ map: ROOM, player: { depth: 3 }, pack: ["a Scroll of Phase Door"] });
    const look = watcher();
    const fired = [look(w.view)];
    w.setPack([]);
    fired.push(look(w.view), look(w.view));
    expect(fired.flat()).toEqual([]);
  });

  it("does not fire when the last scroll is read while a reliable escape spell is known", () => {
    const spells = [{ name: "Phase Door", sidx: 0, mana: 2, fail: 10 }];
    const w = world({ map: ROOM, player: { depth: 3, sp: 10, maxSp: 10 }, pack: ["a Scroll of Phase Door"], spells });
    const look = watcher();
    look(w.view);
    w.setPack([]);
    expect(look(w.view, READ)).toEqual([]);
  });

  it("does not fire when an escape spell stops being reliable", () => {
    const steady = world({ map: ROOM, player: { depth: 3, sp: 10, maxSp: 10 }, spells: [{ name: "Phase Door", sidx: 0, mana: 2, fail: 10 }] });
    const shaky = world({ map: ROOM, player: { depth: 3, sp: 10, maxSp: 10 }, spells: [{ name: "Phase Door", sidx: 0, mana: 2, fail: 30 }] });
    const look = watcher();
    look(steady.view);
    expect(look(shaky.view)).toEqual([]);
  });

  it("fires when half the healing potions are drunk, counted from the most held", () => {
    const w = world({ map: ROOM, player: { depth: 3 }, pack: ["4 Potions of Cure Light Wounds"] });
    const look = watcher();
    const fired = [look(w.view)];
    w.setPack(["3 Potions of Cure Light Wounds"]);
    fired.push(look(w.view, DRANK));
    w.setPack(["2 Potions of Cure Light Wounds"]);
    fired.push(look(w.view, DRANK), look(w.view));
    expect(fired).toEqual([[], [], ["loss"], []]);
  });

  it("does not count dropped or destroyed healing potions as drunk", () => {
    const w = world({ map: ROOM, player: { depth: 3 }, pack: ["6 Potions of Cure Light Wounds"] });
    const look = watcher();
    const fired = [look(w.view)];
    w.setPack(["2 Potions of Cure Light Wounds"]);
    fired.push(look(w.view));
    expect(fired.flat()).toEqual([]);
    w.setPack(["a Potion of Cure Light Wounds"]);
    expect(look(w.view, DRANK)).toEqual(["loss"]);
  });

  it("does not count potions sold in town as a loss", () => {
    const w = world({ map: ROOM, player: { depth: 0 }, pack: ["4 Potions of Cure Light Wounds"] });
    const look = watcher();
    const fired = [look(w.view)];
    w.setPack(["a Potion of Cure Light Wounds"]);
    fired.push(look(w.view));
    w.setPlayer({ depth: 1 });
    fired.push(look(w.view));
    expect(fired.flat()).toEqual(["town-out"]);
  });

  it("fires on entering and on leaving the town", () => {
    const w = world({ map: ROOM, player: { depth: 2 } });
    const look = watcher();
    const fired = [look(w.view)];
    w.setPlayer({ depth: 0 });
    fired.push(look(w.view), look(w.view));
    w.setPlayer({ depth: 1 });
    fired.push(look(w.view), look(w.view));
    expect(fired).toEqual([[], ["town-in"], [], ["town-out"], []]);
  });

  it("fires once per new depth band of five levels", () => {
    const w = world({ map: ROOM, player: { depth: 4, maxDepth: 4 } });
    const look = watcher();
    const fired = [look(w.view)];
    let deepest = 4;
    for (const depth of [5, 6, 4, 9, 10]) {
      deepest = Math.max(deepest, depth);
      w.setPlayer({ depth, maxDepth: deepest });
      fired.push(look(w.view));
    }
    expect(fired).toEqual([[], ["band"], [], [], [], ["band"]]);
  });

  it("fires once for a dangerous unique in view, and ignores one the character cannot see", () => {
    const fang = { grid: { x: 3, y: 1 }, race: "Fang", level: 1, speed: 140, raceFlags: ["UNIQUE"] };
    const w = world({ map: ROOM, player: { level: 3, hp: 40, maxHp: 40, depth: 2 } });
    const look = watcher();
    const fired = [look(w.view)];
    w.setMonsters([{ ...fang, visible: false }]);
    fired.push(look(w.view));
    w.setMonsters([fang]);
    fired.push(look(w.view), look(w.view));
    w.setMonsters([]);
    fired.push(look(w.view));
    w.setMonsters([fang]);
    fired.push(look(w.view));
    expect(fired).toEqual([[], [], ["unique"], [], [], []]);
  });

  it("fires for a newly known artifact or ego item, not for one already carried or still unknown", () => {
    const w = world({ map: ROOM, player: { depth: 2 } });
    const old = { ...itemNamed("a Dagger of Slay Orc", 1), egoName: "of Slay Orc", kindKey: "1" } as ItemView;
    const unknown = { ...itemNamed("a Cloak", 2) } as ItemView;
    const found = { ...itemNamed("the Phial of Galadriel", 3), artifactName: "of Galadriel", kindKey: "3" } as ItemView;
    const look = watcher();
    const packs = [[old], [old, unknown], [old, unknown, found], [old, unknown, found], [old], [old, found]];
    expect(packs.map((pack) => look(withPack(w.view, pack)))).toEqual([[], [], ["treasure"], [], [], []]);
  });

  it("fires for a newly learned rune from the game's message, once per rune", () => {
    const w = world({ map: ROOM, player: { depth: 2 } });
    const look = watcher();
    const fired = [look(w.view)];
    w.setMessages(["You have learned the rune of fire resistance."]);
    fired.push(look(w.view), look(w.view));
    w.setMessages([]);
    fired.push(look(w.view));
    expect(fired).toEqual([[], ["rune"], [], []]);
  });

  it("fires when the learned-spell count rises", () => {
    const w = world({ map: ROOM, player: { depth: 2 } });
    const look = watcher();
    expect([1, 1, 2, 2].map((learned) => look(withSpells(w.view, learned)))).toEqual([[], [], ["spell"], []]);
  });

  it("orders triggers that fire together, near-death first", () => {
    const w = world({ map: ROOM, player: { depth: 0, hp: 10, maxHp: 100 } });
    const look = watcher();
    look(w.view);
    w.setPlayer({ depth: 1, hp: 80 });
    expect(look(w.view)).toEqual(["near-death", "town-out"]);
  });
});

describe("meaningful actions", () => {
  it("decides every command code Squire gives", () => {
    /* The codes behind the action helpers Squire calls, and the ones it passes to act.raw. */
    const given = [
      "walk", "hold", "rest", "descend", "ascend", "tunnel", "open", "close", "disarm", "quaff", "read", "eat", "wield", "drop", "pickup",
      "aim-wand", "zap-rod", "use-staff", "activate", "fire", "throw", "cast", "shop-buy", "shop-sell", "shop-exit",
      "study", "navigate-down", "navigate-up", "run", "pathfind",
    ];
    expect(Object.keys(COMMAND_COUNTS).sort()).toEqual([...given].sort());
  });

  it("counts moving, fighting, casting, studying, using and trading, and not resting, holding still or leaving a shop", () => {
    for (const code of ["walk", "run", "pathfind", "navigate-up", "navigate-down", "fire", "cast", "study", "quaff", "read", "wield", "shop-buy", "descend"]) {
      expect(meaningfulAction({ code })).toBe(true);
    }
    for (const code of ["rest", "hold", "shop-exit", "unreachable"]) expect(meaningfulAction({ code })).toBe(false);
  });

  it("counts down to the checkpoint and caps the count on a level with two drops", () => {
    expect(nextCheck(0, 3, 0)).toEqual({ actions: CHECKPOINT_ACTIONS, depth: 5, capped: false });
    expect(nextCheck(140, 5, 1)).toEqual({ actions: 10, depth: 10, capped: false });
    expect(nextCheck(10, 5, 2).capped).toBe(true);
  });
});

describe("what a command uses up", () => {
  const pack = ["3 Potions of Cure Light Wounds", "a Scroll of Phase Door", "a Staff of Teleportation (5 charges)", "a Potion of Speed", "2 Scrolls of Light"];

  it("reads the item the command names: a healing potion drunk, an escape scroll read or a teleport staff used", () => {
    const w = world({ map: ROOM, player: { depth: 2 }, pack });
    expect(usedBy(w.view, { code: "quaff", args: { handle: 1 } })).toEqual({ healing: true, escape: false });
    expect(usedBy(w.view, { code: "read", args: { handle: 2 } })).toEqual({ healing: false, escape: true });
    expect(usedBy(w.view, { code: "use-staff", args: { handle: 3 } })).toEqual({ healing: false, escape: true });
  });

  it("uses up nothing on a drop, a sale, another potion or scroll, or a command without an item", () => {
    const w = world({ map: ROOM, player: { depth: 2 }, pack });
    for (const command of [
      { code: "drop", args: { handle: 1 } }, { code: "shop-sell", args: { handle: 2 } }, { code: "quaff", args: { handle: 4 } },
      { code: "read", args: { handle: 5 } }, { code: "walk", dir: 6 },
    ]) expect(usedBy(w.view, command)).toEqual({ healing: false, escape: false });
  });
});

describe("the revise threshold", () => {
  it("needs 0.5 by default and 0.65 from a persona with Stubbornness above 0.7", () => {
    const plain = defaultPersona("Plain");
    const stubborn = { ...plain, sliders: { ...plain.sliders, stubbornness: 85 } };
    const edge = { ...plain, sliders: { ...plain.sliders, stubbornness: 70 } };
    expect(reviseThreshold(null)).toBe(0.5);
    expect(reviseThreshold(plain)).toBe(0.5);
    expect(reviseThreshold(edge)).toBe(0.5);
    expect(reviseThreshold(stubborn)).toBe(0.65);
    const answer = { type: "noul" as const, p: 0.6 };
    expect(reviseYes(answer, reviseThreshold(plain))).toBe(true);
    expect(reviseYes(answer, reviseThreshold(stubborn))).toBe(false);
    expect(reviseYes({ type: "noul", p: 0.65 }, reviseThreshold(stubborn))).toBe(true);
    expect(reviseYes(null, 0.5)).toBeNull();
  });
});

describe("the oscillation guard", () => {
  const aims = [{ kind: "lantern" }, { kind: "depth" }, { kind: "armour" }];

  it("keeps a dropped goal out of the choice for 2,000 game turns", () => {
    const blocks = [blockFor("lantern", 100)];
    expect(openAims(aims, blocks, 100).map((aim) => aim.kind)).toEqual(["depth", "armour"]);
    expect(guardAims(aims, blocks, 100 + REVISE_BLOCK_TURNS - 1).map((aim) => aim.kind)).toEqual(["depth", "armour", "lantern"]);
    expect(openAims(aims, blocks, 100 + REVISE_BLOCK_TURNS).map((aim) => aim.kind)).toEqual(["lantern", "depth", "armour"]);
  });

  it("lets a dropped goal back when it is the only candidate", () => {
    const blocks = [blockFor("lantern", 100)];
    expect(openAims([{ kind: "lantern" }], blocks, 200).map((aim) => aim.kind)).toEqual(["lantern"]);
    expect(guardAims([{ kind: "lantern" }], blocks, 200).map((aim) => aim.kind)).toEqual(["lantern"]);
  });
});

describe("the revise request", () => {
  it("asks one yes/no question with the goal, the moment and the other aims", () => {
    const w = world({ map: ROOM, player: { depth: 2 } });
    const request = reviseGoalRequest(w.view, "Depth target. Chosen on reaching a new level.", "the character learned a new spell", ["lantern over torch"]);
    expect(Object.keys(request.questions)).toEqual(["revise_goal"]);
    expect(request.questions["revise_goal"]).toMatchObject({ type: "noul", instructions: "Should the character drop its current mid-term goal and choose again?" });
    expect(request.state["moment"]).toBe("This check comes because the character learned a new spell.");
    expect(request.state["other_aims"]).toBe("lantern over torch");
  });
});
