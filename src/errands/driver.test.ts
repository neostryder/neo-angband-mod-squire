import { describe, expect, it } from "vitest";
import type { AgentCommand, ControllerKeyPress, StoreView } from "@rpgm-tools/neo-angband-core";
import { createErrandDriver, danger, retreatLine, stateKey, waryAvoid, type DriverDeps, type MenuModel } from "./driver.js";
import type { ErrandId } from "./catalog.js";
import { ERRAND_DONE, ERRAND_TEXT } from "./text.js";
import type { Brain, Plan } from "../brain/brain.js";
import { defaultPersona, type Persona } from "../persona/persona.js";
import { defaultCfg, type SquireCfg } from "../settings.js";
import { FEAT, itemNamed, world, type World } from "../harness.js";

const FREE: AgentCommand = { code: "walk", dir: 2 } as AgentCommand;
const GUARD: AgentCommand = { code: "quaff", args: { handle: 9 } } as AgentCommand;

function press(key: string): ControllerKeyPress {
  return { key, ctrl: false, alt: false, shift: false, meta: false, repeat: false };
}

function fakeBrain(command: AgentCommand | null): Brain & { calls: number } {
  const brain = {
    calls: 0,
    controller: () => {
      brain.calls += 1;
      return command;
    },
    state: () => "idle" as const,
    stoppedBecause: () => null,
    drop: () => {},
  };
  return brain;
}

interface Rig {
  readonly driver: ReturnType<typeof createErrandDriver>;
  readonly w: World;
  readonly logs: string[];
  readonly statuses: string[];
  readonly released: string[];
  readonly handedBack: string[];
  readonly shoppedWith: (Persona | null)[];
  readonly shown: MenuModel[];
  readonly hidden: number[];
  readonly ranks: ((ids: readonly ErrandId[] | null) => void)[];
  readonly safety: ReturnType<typeof fakeBrain>;
  tick(): AgentCommand | null;
  freeCalls(): number;
}

function rig(w: World, options: { cfg?: Partial<SquireCfg>; persona?: Persona; release?: boolean; rank?: boolean; shopping?: () => Plan } = {}): Rig {
  const logs: string[] = [];
  const statuses: string[] = [];
  const released: string[] = [];
  const handedBack: string[] = [];
  const shoppedWith: (Persona | null)[] = [];
  const shown: MenuModel[] = [];
  const hidden: number[] = [];
  const ranks: ((ids: readonly ErrandId[] | null) => void)[] = [];
  const safety = fakeBrain(GUARD);
  let freeCalls = 0;
  const deps: DriverDeps = {
    cfg: { ...defaultCfg(), ...options.cfg },
    terrain: w.terrain,
    log: (message) => logs.push(message),
    errandKey: () => "&",
    persona: () => options.persona ?? defaultPersona(),
    safety: () => safety,
    shopping: (persona) => {
      shoppedWith.push(persona);
      return options.shopping?.() ?? { label: "nothing", step: () => null };
    },
    status: (label, reason) => statuses.push(reason === undefined ? label : `${label} | ${reason}`),
    ...(options.release === false ? {} : { release: (reason: string) => released.push(reason) }),
    menu: { show: (model) => shown.push(model), hide: () => hidden.push(1) },
    ...(options.rank === true ? { rank: () => new Promise<readonly ErrandId[] | null>((resolve) => ranks.push(resolve)) } : {}),
    onHandBack: (source) => handedBack.push(source),
  };
  const driver = createErrandDriver(deps);
  const controller = driver.controller(() => {
    freeCalls += 1;
    return FREE;
  });
  return { driver, w, logs, statuses, released, handedBack, shoppedWith, shown, hidden, ranks, safety, tick: () => controller(w.view, w.act), freeCalls: () => freeCalls };
}

const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

/** A corridor with a down staircase at its east end. */
const CORRIDOR = ["#########", "#<..@..>#", "#########"];

describe("the errand driver", () => {
  it("lets Squire play as usual while no errand is chosen", () => {
    const r = rig(world({ map: CORRIDOR }));
    expect(r.tick()).toEqual(FREE);
    expect(r.driver.mode()).toBe("free");
  });

  it("pauses play while the menu is open, and picks an errand by number", () => {
    const r = rig(world({ map: CORRIDOR }));
    r.tick();
    expect(r.driver.onKey(press("&"))).toEqual({ kind: "keep", message: ERRAND_TEXT.menuHint("&") });
    expect(r.driver.menuOpen()).toBe(true);
    expect(r.shown).toHaveLength(1);
    expect(r.shown[0]?.entries).toHaveLength(8);
    expect(r.tick()).toBeNull();
    expect(r.freeCalls()).toBe(1);
    expect(r.driver.onKey(press("3"))).toEqual({ kind: "keep" });
    expect(r.driver.errand()).toBe("down");
    expect(r.driver.menuOpen()).toBe(false);
    expect(r.hidden).toHaveLength(1);
    expect(r.statuses).toContain(ERRAND_TEXT.running(ERRAND_TEXT.labels.down));
  });

  it("refuses an errand that cannot start, with its reason", () => {
    const r = rig(world({ map: CORRIDOR }));
    r.tick();
    r.driver.onKey(press("&"));
    expect(r.driver.onKey(press("8"))).toEqual({ kind: "keep", message: ERRAND_TEXT.refused(ERRAND_TEXT.reasons.notInTown) });
    expect(r.driver.errand()).toBeNull();
    expect(r.driver.menuOpen()).toBe(true);
  });

  it("refuses a pick before it has seen the game", () => {
    const r = rig(world({ map: CORRIDOR }));
    expect(r.driver.pick(3)).toBe(ERRAND_TEXT.refused(ERRAND_TEXT.reasons.notYet));
    r.tick();
    expect(r.driver.pick(9)).toBe(ERRAND_TEXT.noSuchErrand);
  });

  it("runs the errand, then gives the keyboard back with a status line", () => {
    const r = rig(world({ map: CORRIDOR }));
    r.tick();
    expect(r.driver.pick(3)).toBeNull();
    expect(r.tick()).toEqual({ code: "walk", dir: 6 });
    r.w.moveTo({ x: 7, y: 1 });
    expect(r.tick()).toBeNull();
    const text = ERRAND_TEXT.done(ERRAND_TEXT.labels.down, ERRAND_DONE.down);
    expect(r.released).toEqual([text]);
    expect(r.statuses).toContain(`${ERRAND_TEXT.endedLabel} | ${text}`);
    expect(r.handedBack).toEqual(["the errand ended"]);
    expect(r.driver.mode()).toBe("ended");
    /* Called again, the controller has been handed the keyboard once more, and plays as usual. */
    expect(r.tick()).toEqual(FREE);
    expect(r.driver.mode()).toBe("free");
    expect(r.released).toHaveLength(1);
  });

  it("plays as usual when handed the keyboard again after the player took it mid-errand", () => {
    const r = rig(world({ map: CORRIDOR }));
    r.tick();
    r.driver.pick(3);
    expect(r.tick()).toEqual({ code: "walk", dir: 6 });
    r.driver.handBack("the player took the keyboard");
    expect(r.driver.mode()).toBe("free");
    expect(r.tick()).toEqual(FREE);
  });

  it("leaves a shop screen before giving the keyboard back", () => {
    const general: StoreView = { feat: FEAT.GENERAL, featName: "General Store", isHome: false, owner: { name: "Bilbo", purse: 5000 }, stock: [{ ...itemNamed("a Flask of Oil", 0), index: 0, number: 1, price: 3 }] };
    const w = world({ map: ["#####", "#.G.#", "#####"], player: { depth: 0 }, stores: [general] });
    w.moveTo({ x: 2, y: 1 });
    const r = rig(w);
    r.tick();
    expect(r.driver.pick(8)).toBeNull();
    expect(r.tick()).toEqual(w.act.shopExit());
    expect(r.released).toEqual([]);
    expect(r.tick()).toBeNull();
    expect(r.released).toEqual([ERRAND_TEXT.done(ERRAND_TEXT.labels.restock, ERRAND_DONE.restock)]);
  });

  it("on a game that cannot take the keyboard back for it, says how to take it", () => {
    const r = rig(world({ map: CORRIDOR }), { release: false });
    r.tick();
    r.driver.pick(3);
    r.w.moveTo({ x: 7, y: 1 });
    r.tick();
    expect(r.logs.join("\n")).toContain("press Escape to take it");
    /* Until the player takes the keyboard, the ended errand decides nothing; after that, play is as usual. */
    expect(r.tick()).toBeNull();
    r.driver.handBack("the player took the keyboard");
    expect(r.tick()).toEqual(FREE);
  });

  it("ends the errand on a new level, and when the character dies", () => {
    const r = rig(world({ map: CORRIDOR }));
    r.tick();
    r.driver.pick(3);
    r.tick();
    r.w.setPlayer({ depth: 2 });
    r.tick();
    expect(r.released).toEqual([ERRAND_TEXT.stopped(ERRAND_TEXT.labels.down, "The character is now on level 2.")]);

    const dies = rig(world({ map: CORRIDOR }));
    dies.tick();
    dies.driver.pick(3);
    dies.tick();
    dies.w.setPlayer({ dead: true });
    dies.tick();
    expect(dies.released).toEqual([ERRAND_TEXT.stopped(ERRAND_TEXT.labels.down, "The character died.")]);
  });
});

describe("self-preservation during an errand", () => {
  it("hands the decision to the safety planner while a creature is awake in sight, then resumes", () => {
    const r = rig(world({ map: CORRIDOR }));
    r.tick();
    r.driver.pick(3);
    r.w.setMonsters([{ grid: { x: 2, y: 1 }, race: "cave spider" }]);
    expect(r.tick()).toEqual(GUARD);
    expect(r.safety.calls).toBe(1);
    r.w.setMonsters([]);
    expect(r.tick()).toEqual({ code: "walk", dir: 6 });
    expect(r.logs.join("\n")).toContain("the danger has passed");
  });

  it("takes the safety planner's first step on the call it chooses its plan, never the errand's", () => {
    const r = rig(world({ map: CORRIDOR }));
    r.tick();
    r.driver.pick(3);
    let state: "idle" | "running" = "idle";
    const reflexive = r.safety as unknown as { controller: () => AgentCommand | null; state: () => string };
    reflexive.controller = () => {
      if (state === "idle") {
        state = "running";
        return null;
      }
      return GUARD;
    };
    reflexive.state = () => state;
    r.w.setMonsters([{ grid: { x: 2, y: 1 }, race: "cave spider" }]);
    expect(r.tick()).toEqual(GUARD);
    reflexive.controller = () => null;
    expect(r.tick()).toBeNull();
  });

  it("does not end an errand on its budget while the danger lasts", () => {
    const r = rig(world({ map: CORRIDOR }), { cfg: { errandSteps: 1 } });
    r.tick();
    r.driver.pick(3);
    r.w.setMonsters([{ grid: { x: 2, y: 1 }, race: "cave spider" }]);
    for (let i = 0; i < 15; i += 1) expect(r.tick()).toEqual(GUARD);
    expect(r.released).toEqual([]);
    r.w.setMonsters([]);
    expect(r.tick()).toBeNull();
    expect(r.released).toEqual([ERRAND_TEXT.stopped(ERRAND_TEXT.labels.down, "It took more decisions than an errand is allowed.")]);
  });

  it("counts hit points at the retreat line, afflictions and harmful ground as danger", () => {
    const w = world({ map: ["#####", "#.@~#", "#####"], player: { hp: 10, maxHp: 40 } });
    expect(danger(w.view, w.terrain, 0.3)).toBe("hit points are at the retreat line");
    w.setPlayer({ hp: 40, status: { blind: 3 } });
    expect(danger(w.view, w.terrain, 0.3)).toBe("the character is blind");
    w.setPlayer({ status: { blind: 0 } });
    w.moveTo({ x: 3, y: 1 });
    expect(danger(w.view, w.terrain, 0.3)).toBe("the ground is harmful");
  });

  it("in town, minds only a creature next to the character", () => {
    const w = world({ map: ["#######", "#.@...#", "#######"], player: { depth: 0 }, monsters: [{ grid: { x: 5, y: 1 }, race: "scruffy dog" }] });
    expect(danger(w.view, w.terrain, 0.3)).toBeNull();
    w.setMonsters([{ grid: { x: 3, y: 1 }, race: "scruffy dog" }]);
    expect(danger(w.view, w.terrain, 0.3)).not.toBeNull();
  });
});

describe("compliant by default", () => {
  function bold(): Persona {
    const persona = defaultPersona();
    persona.sliders.boldness = 100;
    persona.sliders.paranoia = 100;
    return persona;
  }

  it("runs an errand the plain way unless the persona setting is on", () => {
    const shop = world({ map: ["#######", "#.@..G#", "#######"], player: { depth: 0 } });
    const plain = rig(shop, { persona: bold() });
    plain.tick();
    plain.driver.pick(8);
    plain.tick();
    expect(plain.shoppedWith).toEqual([null]);

    const coloured = rig(shop, { persona: bold(), cfg: { personaErrands: true } });
    coloured.tick();
    coloured.driver.pick(8);
    coloured.tick();
    expect(coloured.shoppedWith[0]?.sliders.boldness).toBe(100);
  });

  it("is off in the default settings", () => {
    expect(defaultCfg().personaErrands).toBe(false);
  });

  it("keeps the setting's retreat line and route without a persona", () => {
    const cfg = defaultCfg();
    const w = world({ map: CORRIDOR, monsters: [{ grid: { x: 2, y: 1 }, asleep: true }] });
    expect(retreatLine(cfg, null)).toBe(cfg.retreatFraction);
    expect(waryAvoid(w.view, null)).toBeUndefined();
    expect(retreatLine(cfg, bold())).toBeLessThan(cfg.retreatFraction);
    expect(waryAvoid(w.view, bold())?.({ x: 3, y: 1 })).toBe(true);
  });
});

describe("the hand-back epoch", () => {
  it("moves on every errand start and every hand-back", () => {
    const r = rig(world({ map: CORRIDOR }));
    r.tick();
    expect(r.driver.epoch()).toBe(0);
    r.driver.pick(3);
    expect(r.driver.epoch()).toBe(1);
    r.driver.handBack("the player took the keyboard");
    expect(r.driver.epoch()).toBe(2);
  });

  it("drops the errand, the menu and the safety planner on a hand-back", () => {
    const r = rig(world({ map: CORRIDOR }));
    r.tick();
    r.driver.pick(3);
    r.driver.onKey(press("&"));
    r.driver.handBack("the player took the keyboard");
    expect(r.driver.errand()).toBeNull();
    expect(r.driver.menuOpen()).toBe(false);
    expect(r.handedBack).toEqual(["the player took the keyboard"]);
    expect(r.logs.join("\n")).toContain(`errand abandoned: ${ERRAND_TEXT.labels.down}`);
  });

  it("shows a short list that arrives in time", async () => {
    const r = rig(world({ map: CORRIDOR }), { rank: true });
    r.tick();
    r.driver.onKey(press("&"));
    r.ranks[0]?.(["down", "leave"]);
    await flush();
    expect(r.driver.suggested()).toEqual(["down", "leave"]);
    expect(r.shown.at(-1)?.suggested.map((entry) => entry.id)).toEqual(["down", "leave"]);
  });

  it("drops a short list asked under an earlier epoch", async () => {
    const r = rig(world({ map: CORRIDOR }), { rank: true });
    r.tick();
    r.driver.onKey(press("&"));
    r.driver.handBack("the player took the keyboard");
    r.driver.onKey(press("&"));
    r.ranks[0]?.(["down"]);
    await flush();
    expect(r.driver.suggested()).toEqual([]);
    expect(r.logs.join("\n")).toContain("dropped an errand ranking asked before things changed");
  });

  it("drops a short list asked about a state that has since changed", async () => {
    const r = rig(world({ map: CORRIDOR }), { rank: true });
    r.tick();
    r.driver.onKey(press("&"));
    const before = stateKey(r.w.view);
    r.w.moveTo({ x: 5, y: 1 });
    r.tick();
    expect(stateKey(r.w.view)).not.toBe(before);
    r.ranks[0]?.(["down"]);
    await flush();
    expect(r.driver.suggested()).toEqual([]);
  });

  it("leaves the short list out when there is no answer", async () => {
    const r = rig(world({ map: CORRIDOR }), { rank: true });
    r.tick();
    r.driver.onKey(press("&"));
    r.ranks[0]?.(null);
    await flush();
    expect(r.driver.suggested()).toEqual([]);
    expect(r.shown).toHaveLength(1);
  });
});
