import { describe, expect, it } from "vitest";
import { world } from "../harness.js";
import { createTally } from "../brain/tally.js";
import type { Answer } from "../brain/systemone.js";
import { createGoalPlanner } from "../brain/goals.js";
import { defaultCfg } from "../settings.js";
import { defaultConfig, MAX_INSTRUCTIONS_KEPT, MIN_INSTRUCTIONS_KEPT, readConfig, writeConfig } from "../config.js";
import { inherit, type Lineage } from "../learning/lineage.js";
import { defaultPersona, type Persona } from "../persona/persona.js";
import { createOrders, type Orders } from "./book.js";
import { CREED_FORMAT, exportCreed, importCreed, inheritCreeds, loadCreed } from "./creed.js";
import { queueInstruction } from "./input.js";
import { ORDERS_EMPTY, ORDERS_HEADING, kindLabel, orderLines, sortedLine } from "./panel.js";
import { readInstructions } from "./read.js";
import { sortByCode } from "./sort.js";
import { STATE_LABELS, type Instruction } from "./types.js";

function book(persona: Persona = defaultPersona("T")): { orders: Orders; persona: Persona; notes: string[] } {
  const notes: string[] = [];
  const orders = createOrders({
    backend: () => null,
    send: () => Promise.reject(new Error("no model")),
    tally: createTally({ perSessionUsd: 0, perDayUsd: 0 }),
    now: () => 0,
    persona: () => persona,
    setPersona: () => {},
    kept: () => 50,
    note: (text) => { notes.push(text); },
    log: () => {},
    save: () => {},
    rng: () => 0.5,
  });
  return { orders, persona, notes };
}

function keen(p: Persona): Persona {
  p.sliders.devotion = 100;
  p.sliders.resentment = 0;
  p.sliders.stubbornness = 0;
  p.sliders.strength = 100;
  return p;
}

describe("the Orders box", () => {
  it("names every state the design lists", () => {
    expect(STATE_LABELS).toEqual({
      following: "following", grudgingly: "grudgingly", ignoring: "ignoring", forgotten: "forgotten", done: "done", abandoned: "abandoned",
    });
  });

  it("shows the empty text with no instructions", () => {
    expect(orderLines([])).toEqual([ORDERS_EMPTY]);
    expect(ORDERS_HEADING).toBe("Orders");
  });

  it("shows each instruction with its state, kind, words and sorted form", () => {
    const { orders } = book(keen(defaultPersona("T")));
    orders.give("Reach 500 ft before level 15", "panel", { kind: "order" });
    orders.give("Always run away the first time you see a unique", "panel", { familyCreed: true });
    const lines = orderLines(orders.list());
    expect(lines).toHaveLength(2);
    expect(lines[0]).toMatch(/^(following|grudgingly|ignoring) - Order: Reach 500 ft before level 15 \[aim: depth 500 ft/);
    expect(lines[1]).toContain("Standing (family creed): Always run away the first time you see a unique");
    expect(lines[1]).toContain("how often: the first time");
  });

  it("shows ended states and keeps unsortable text as written", () => {
    const { orders } = book();
    const r = orders.give("Sing to the moon", "panel");
    if (!r.ok) throw new Error("not taken");
    orders.retire(r.instruction.id);
    expect(orderLines(orders.list())[0]).toMatch(/^abandoned - Order: Sing to the moon \[kept as written\]$/);
    expect(sortedLine(sortByCode("Sing to the moon").sorted)).toBe("kept as written");
    expect(kindLabel("standing")).toBe("Standing");
  });
});

describe("creed files", () => {
  it("round-trips standing instructions in the house envelope", () => {
    const a = book(keen(defaultPersona("T")));
    a.orders.give("Always rest when you are wounded", "panel", { familyCreed: true });
    a.orders.give("Never fight when you are wounded", "panel");
    a.orders.give("Reach 500 ft", "panel", { kind: "order" });
    const text = exportCreed("House Ada", a.orders.list());
    const parsed = JSON.parse(text) as Record<string, unknown>;
    expect(Object.keys(parsed)).toEqual(["format", "schemaVersion", "data"]);
    expect(parsed["format"]).toBe(CREED_FORMAT);
    expect(text).not.toContain("Reach 500 ft");

    const b = book();
    expect(loadCreed(b.orders, text)).toEqual({ ok: true, taken: 2 });
    expect(b.orders.list().map((i) => [i.text, i.kind, i.familyCreed, i.source])).toEqual([
      ["Always rest when you are wounded", "standing", true, "creed"],
      ["Never fight when you are wounded", "standing", false, "creed"],
    ]);
    expect(b.notes[0]).toBe("New standing instruction: Always rest when you are wounded");
  });

  it("refuses files that are not creeds", () => {
    expect(importCreed("not json")).toEqual({ ok: false, problem: "That file isn't a creed file." });
    expect(importCreed(JSON.stringify({ format: "other", schemaVersion: 1, data: {} }))).toEqual({ ok: false, problem: "That file isn't a creed file." });
    expect(importCreed(JSON.stringify({ format: CREED_FORMAT, schemaVersion: 99, data: { instructions: [] } }))).toEqual({ ok: false, problem: "That creed file needs a newer version of Squire." });
    expect(importCreed(JSON.stringify({ format: CREED_FORMAT, schemaVersion: 1, data: {} }))).toEqual({ ok: false, problem: "That creed file has no instructions in it." });
  });

  it("skips blank and malformed lines", () => {
    const read = importCreed(JSON.stringify({ format: CREED_FORMAT, schemaVersion: 1, data: { name: "x", instructions: [{ text: "  " }, 7, { text: "Keep two Flasks of Oil", familyCreed: true }] } }));
    expect(read).toMatchObject({ ok: true, entries: [{ text: "Keep two Flasks of Oil", familyCreed: true }] });
  });
});

describe("the channel input", () => {
  it("queues as the panel does, with its own source and a viewer's weaker pull", () => {
    const a = book();
    const b = book();
    const p = queueInstruction(a.orders, "Reach 500 ft", "panel");
    const c = queueInstruction(b.orders, "Reach 500 ft", "channel");
    if (!p.ok || !c.ok) throw new Error("not taken");
    const { adherence: pa, state: _ps, ...panelRest } = p.instruction;
    const { adherence: ca, state: _cs, ...channelRest } = c.instruction;
    expect({ ...channelRest, source: "panel" }).toEqual(panelRest);
    expect(ca).toBeLessThan(pa);
    expect(c.instruction.source).toBe("channel");
    expect(b.notes).toEqual(a.notes);
  });

  it("takes a viewer's request as seriously as the patron's word only at very high Devotion", () => {
    const a = book(keen(defaultPersona("T")));
    const b = book(keen(defaultPersona("T")));
    const p = queueInstruction(a.orders, "Reach 500 ft", "panel");
    const c = queueInstruction(b.orders, "Reach 500 ft", "channel");
    if (!p.ok || !c.ok) throw new Error("not taken");
    expect(c.instruction.adherence).toBe(p.instruction.adherence);
  });

  it("accepts each of the four sources and refuses anything else", () => {
    const { orders } = book();
    for (const [n, source] of (["panel", "hotkey", "creed", "channel"] as const).entries()) {
      expect(queueInstruction(orders, `Reach ${String(n + 1)}00 ft`, source).ok).toBe(true);
    }
    expect(queueInstruction(orders, "Reach 900 ft", "discord" as never)).toEqual({ ok: false, problem: "Instructions can only come from the panel, the hotkey, a creed file or a channel." });
    expect(queueInstruction(orders, 5 as never, "channel")).toEqual({ ok: false, problem: "Write the instruction first." });
    expect(queueInstruction(orders, "", "channel").ok).toBe(false);
  });
});

describe("heirs", () => {
  const mk = (id: string, text: string, kind: Instruction["kind"], familyCreed: boolean, memory = 1): Instruction => ({
    id, text, kind, familyCreed, memory, source: "panel", sorted: sortByCode(text).sorted, state: "following", adherence: 0.5,
    createdTurn: 0, seenTurn: 0, acted: 0, lowReviews: 0, disliked: false,
  });
  const parentBook = (): Instruction[] => {
    const { orders } = book();
    orders.give("Always rest when you are wounded", "panel", { familyCreed: true });
    orders.give("Keep two Flasks of Oil", "panel", { familyCreed: false });
    orders.give("Reach 500 ft", "panel", { kind: "order", familyCreed: true });
    return [...orders.list()];
  };

  it("carries only family creeds, never orders, at half memory", () => {
    const parent = defaultPersona("Ada");
    parent.sliders.inheritance = 100;
    const out = inheritCreeds(parentBook(), parent);
    expect(out.map((i) => i.text)).toEqual(["Always rest when you are wounded"]);
    expect(out[0]!.memory).toBe(0.5);
  });

  it("follows the Inheritance slider", () => {
    const parent = defaultPersona("Ada");
    const creeds = Array.from({ length: 12 }, (_, n) => mk(`c${String(n)}`, `Always rest ${String(n)}`, "standing", true, 1 - n / 100));
    parent.sliders.inheritance = 0;
    expect(inheritCreeds(creeds, parent)).toHaveLength(0);
    parent.sliders.inheritance = 50;
    expect(inheritCreeds(creeds, parent).map((i) => i.id)).toEqual(["c0", "c1", "c2", "c3", "c4", "c5"]);
    parent.sliders.inheritance = 100;
    expect(inheritCreeds(creeds, parent)).toHaveLength(12);
  });

  it("puts creeds in the heir's lineage through inherit, and none of the orders", () => {
    const parent = defaultPersona("Ada");
    parent.sliders.inheritance = 100;
    const base: Lineage = { name: "Ada", generation: 1, ancestors: [], lore: [], grudges: [], died: { depth: 1, cause: "orc", turn: 2 }, creeds: parentBook() };
    const heir = inherit(base, parent, defaultPersona("Bo"), () => 0.5);
    expect(heir.lineage.creeds?.map((i) => i.text)).toEqual(["Always rest when you are wounded"]);
  });

  it("is adopted by the heir's book as a family creed", () => {
    const parent = defaultPersona("Ada");
    parent.sliders.inheritance = 100;
    const heirBook = book(keen(defaultPersona("Bo")));
    heirBook.orders.adopt(inheritCreeds(parentBook(), parent), 10);
    expect(heirBook.orders.list()).toHaveLength(1);
    expect(heirBook.orders.list()[0]).toMatchObject({ kind: "standing", familyCreed: true, source: "creed", state: expect.stringMatching(/following|grudgingly|ignoring/) });
    expect(heirBook.orders.creeds()).toHaveLength(1);
  });
});

describe("saved settings and creeds", () => {
  it("clamps Instructions kept and defaults it", () => {
    expect(defaultConfig().instructionsKept).toBe(8);
    const set = (n: unknown) => readConfig({ format: "neo-angband/squire/prefs", schemaVersion: 1, data: { instructionsKept: n } }).instructionsKept;
    expect(set(0)).toBe(MIN_INSTRUCTIONS_KEPT);
    expect(set(9999)).toBe(MAX_INSTRUCTIONS_KEPT);
    expect(set(12.4)).toBe(12);
    expect(set("x")).toBe(8);
  });

  it("round-trips Instructions kept and a lineage's creeds", () => {
    const { orders } = book();
    orders.give("Always rest when you are wounded", "panel", { familyCreed: true });
    const lineage: Lineage = { name: "Ada", generation: 1, ancestors: [], lore: [], grudges: [], creeds: orders.creeds() };
    const config = { ...defaultConfig(), instructionsKept: 3, lineages: { Ada: lineage } };
    const back = readConfig(JSON.parse(JSON.stringify(writeConfig(config))));
    expect(back.instructionsKept).toBe(3);
    expect(back.lineages["Ada"]!.creeds?.map((i) => i.text)).toEqual(["Always rest when you are wounded"]);
  });

  it("drops orders and junk from a stored creed list", () => {
    const { orders } = book();
    orders.give("Always rest when you are wounded", "panel", { familyCreed: true });
    orders.give("Reach 500 ft", "panel", { kind: "order" });
    const raw = JSON.parse(JSON.stringify([...orders.list(), 4, null, { text: 3 }])) as unknown;
    expect(readInstructions(raw)).toHaveLength(2);
    const stored = { name: "Ada", generation: 1, creeds: raw };
    const cfg = readConfig({ format: "neo-angband/squire/prefs", schemaVersion: 1, data: { lineages: { Ada: stored } } });
    expect(cfg.lineages["Ada"]!.creeds?.map((i) => i.text)).toEqual(["Always rest when you are wounded"]);
  });
});

describe("the goal planner", () => {
  const CORRIDOR = ["########", "#.@....#", "#.#### #", "########"];
  const GRIP = [{ grid: { x: 4, y: 1 }, race: "Grip, Farmer Maggot's Dog", level: 30 }];

  function careful(devotion: number): Persona {
    const p = defaultPersona("Careful");
    p.sliders.strength = 100;
    p.sliders.volatility = 0;
    p.sliders.selfpreservation = 100;
    p.sliders.boldness = 100;
    p.sliders.devotion = devotion;
    p.sliders.resentment = 0;
    p.sliders.stubbornness = 0;
    return p;
  }

  async function run(devotion: number, text: string | null): Promise<string | undefined> {
    const w = world({ map: CORRIDOR, player: { hp: 2, maxHp: 40 }, monsters: GRIP });
    const persona = careful(devotion);
    const { orders } = book(persona);
    if (text !== null) {
      orders.give(text, "panel", { kind: "order" });
      await orders.settled();
      orders.observe(w.view);
    }
    const p = createGoalPlanner({ cfg: defaultCfg(), terrain: w.terrain, log: () => {}, persona, rng: () => 0.5, reflex: false, orders });
    const q = p.ask(w.view);
    if (!("request" in q)) throw new Error("expected a question");
    const answers: Record<string, Answer> = {
      goal: { type: "choice", choice: "retreat", confidence: 0.6, probabilities: { retreat: 0.6, fight: 0.4 } },
      in_character: { type: "choice", choice: "fight", confidence: 1, probabilities: { fight: 1 } },
    };
    const choice = p.choose(answers, q.context, w.view);
    return "plan" in choice ? choice.plan.label : undefined;
  }

  it("without an order, the safety floor removes the risky fight", async () => {
    expect(await run(100, null)).toBe("back away");
  });

  it("an order at high adherence carries the fight past the ceiling", async () => {
    expect(await run(100, "Fight the monsters you meet")).toBe("fight");
  });

  it("an order below that adherence does not", async () => {
    expect(await run(55, "Fight the monsters you meet")).toBe("back away");
  });

  it("adds the order's line and one question for it to the model's request", async () => {
    const w = world({ map: CORRIDOR });
    const persona = careful(100);
    const { orders } = book(persona);
    orders.give("Reach 500 ft", "panel", { kind: "order" });
    orders.observe(w.view);
    const p = createGoalPlanner({ cfg: defaultCfg(), terrain: w.terrain, log: () => {}, persona, rng: () => 0.5, reflex: false, orders });
    const q = p.ask(w.view);
    if (!("request" in q)) throw new Error("expected a question");
    expect(String(q.request.state["orders"])).toContain('Your patron ordered: "Reach 500 ft".');
    expect(Object.keys(q.request.questions).filter((k) => k.startsWith("order_"))).toHaveLength(1);
  });
});
