/**
 * Floor items as the player knows them: the floor memory a newer view reports,
 * the persona's pull toward an item it cannot judge, the second look on
 * arrival, and the older reads when the view has no floor memory.
 */

import { describe, expect, it } from "vitest";
import type { AgentView, KnownFloorInspectResult, KnownFloorItemDetails, KnownFloorItemRef, KnownFloorItemView } from "@rpgm-tools/neo-angband-core";
import { suppliedWorld as world } from "../harness.js";
import { defaultCfg } from "../settings.js";
import { archetype, defaultPersona } from "../persona/persona.js";
import { lookReach } from "../persona/quirks.js";
import type { Persona } from "../persona/persona.js";
import { TV } from "../gear/compare.js";
import { createGoalPlanner, type GoalDigest } from "./goals.js";
import type { Question } from "./brain.js";
import type { Answer } from "./systemone.js";
import { floorTarget } from "./items.js";

const ROOM = ["######", "#@...#", "######"];
const POTION = 26;

/** One item's details as knownFloorItems reports them. */
function details(name: string, tval: number): KnownFloorItemDetails {
  return { name, tval, pval: 0, number: 1, weight: 4, ac: 0, toA: 0, toH: 0, toD: 0, dd: 0, ds: 0, flags: [], modifiers: [], brands: [], slays: [], resists: [], curses: [], egoName: null, artifactName: null, inscription: null } as unknown as KnownFloorItemDetails;
}

let nextRef = 1;
function seen(x: number, y: number, name: string, tval: number, visibility: "seen" | "remembered" = "seen"): KnownFloorItemView {
  return { ref: { id: nextRef++ }, grid: { x, y }, visibility, sensed: false, item: details(name, tval) };
}

function sensed(x: number, y: number, money: boolean): KnownFloorItemView {
  return { ref: { id: nextRef++ }, grid: { x, y }, visibility: "remembered", sensed: true, money, item: null };
}

/**
 * The world's view with the player's floor memory added. `memory` is read on
 * every call, so a test changes what the player knows by changing it.
 */
function remembering(base: AgentView, memory: { entries: KnownFloorItemView[]; look?: (ref: KnownFloorItemRef) => KnownFloorInspectResult }): AgentView {
  const at = (x: number, y: number) => memory.entries.filter((entry) => entry.grid.x === x && entry.grid.y === y);
  return {
    ...base,
    cell: (x: number, y: number) => {
      const cell = base.cell(x, y);
      return cell === null ? null : { ...cell, knownObjectCount: at(x, y).length };
    },
    knownFloorItems: at,
    inspectKnownFloorItem: (ref: KnownFloorItemRef): KnownFloorInspectResult => {
      if (memory.look !== undefined) return memory.look(ref);
      const entry = memory.entries.find((e) => e.ref.id === ref.id);
      if (entry === undefined) return { status: "stale", inspection: null };
      if (entry.sensed) return { status: "sensed", inspection: null };
      return entry.visibility === "seen" ? { status: "seen", inspection: { token: { epoch: 0, revision: 0 }, title: entry.item.name, text: `${entry.item.name}. It would sell for 30 gold.` } } : { status: "stale", inspection: null };
    },
  } as unknown as AgentView;
}

function planner(w: ReturnType<typeof world>, persona: Persona | null) {
  return createGoalPlanner({ cfg: defaultCfg(), terrain: w.terrain, log: () => undefined, reflex: false, persona });
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

function fetchPlan(w: ReturnType<typeof world>, view: AgentView, persona: Persona | null) {
  const p = planner(w, persona);
  const q = asked(p.ask(view));
  const choice = p.choose(pick("fetch"), q.context, view);
  if (!("plan" in choice)) throw new Error("expected a plan");
  return { plan: choice.plan, offer: q.context.offers.find((o) => o.goal === "fetch") };
}

describe("floor items as the player knows them", () => {
  it("does not target an item dropped out of sight", () => {
    const w = world({ map: ROOM, floor: [{ x: 3, y: 1, name: "a Potion of Cure Light Wounds" }] });
    const view = remembering(w.view, { entries: [] });
    expect(floorTarget(view, w.terrain, false, archetype("scholar"))).toBeNull();
    /* The older read finds it, which is the leak the floor memory closes. */
    expect(floorTarget(w.view, w.terrain, false)?.at).toEqual({ x: 3, y: 1 });
  });

  it("targets a known item in sight with its value from the look description", () => {
    const w = world({ map: ROOM, floor: [{ x: 3, y: 1, name: "a Potion of Cure Light Wounds" }] });
    const view = remembering(w.view, { entries: [seen(3, 1, "a Potion of Cure Light Wounds", POTION)] });
    expect(floorTarget(view, w.terrain, false)).toEqual({ at: { x: 3, y: 1 }, name: "a Potion of Cure Light Wounds", away: 2, gold: false, sellable: false, useful: true, value: 30, known: true, look: false, sensed: false });
  });

  it("looks at an unknown flavour close by, and goes further when curious", () => {
    const w = world({ map: ROOM, floor: [{ x: 3, y: 1, name: "a Bubbling Potion" }] });
    const view = remembering(w.view, { entries: [seen(3, 1, "a Bubbling Potion", POTION)] });
    expect(floorTarget(view, w.terrain, false, null)).toMatchObject({ at: { x: 3, y: 1 }, look: true, useful: false, sellable: false, value: null });
    expect(floorTarget(view, w.terrain, false, defaultPersona())).toMatchObject({ look: true });
    expect(fetchPlan(w, view, archetype("scholar")).offer?.criteria).toBe("Walk 2 steps to look at a Bubbling Potion on the floor.");
    const far = world({ map: ["#####################", "#@..................#", "#####################"], floor: [{ x: 12, y: 1, name: "a Bubbling Potion" }] });
    const distant = remembering(far.view, { entries: [seen(12, 1, "a Bubbling Potion", POTION)] });
    expect(floorTarget(distant, far.terrain, false, defaultPersona())).toBeNull();
    expect(floorTarget(distant, far.terrain, false, archetype("coward"))).toBeNull();
    expect(floorTarget(distant, far.terrain, false, archetype("scholar"))).toMatchObject({ at: { x: 12, y: 1 }, look: true });
    expect(lookReach(archetype("coward"), false)).toBeLessThan(lookReach(defaultPersona(), false));
  });

  it("treats a flavoured ring or a titled scroll the same way, and a learned one as known", () => {
    const w = world({ map: ROOM });
    const ring = remembering(w.view, { entries: [seen(3, 1, "an Amethyst Ring", TV.RING)] });
    expect(floorTarget(ring, w.terrain, false, defaultPersona())).toMatchObject({ look: true, useful: false, value: null });
    const scroll = remembering(w.view, { entries: [seen(3, 1, "a Scroll titled \"abra ka\"", 25)] });
    expect(floorTarget(scroll, w.terrain, false, defaultPersona())).toMatchObject({ look: true, useful: false, value: null });
    const learned = remembering(w.view, { entries: [seen(3, 1, "a Scroll of Phase Door", 25)] });
    expect(floorTarget(learned, w.terrain, false, defaultPersona())?.useful).toBe(true);
  });

  it("a greedy persona walks further for sensed treasure than for a sensed object", () => {
    const w = world({ map: ["##########", "#@.......#", "##########"] });
    const money = remembering(w.view, { entries: [sensed(8, 1, true)] });
    const thing = remembering(w.view, { entries: [sensed(8, 1, false)] });
    const miser = archetype("miser");
    expect(floorTarget(money, w.terrain, false, miser)).toMatchObject({ look: true, sensed: true, name: "unseen treasure" });
    expect(floorTarget(thing, w.terrain, false, miser)).toMatchObject({ look: true, sensed: true });
    expect(lookReach(miser, true)).toBeGreaterThan(lookReach(miser, false));
  });

  it("ends the plan quietly when the remembered item is gone once the grid is in view", () => {
    const w = world({ map: ROOM, floor: [{ x: 3, y: 1, name: "a Potion of Cure Light Wounds" }] });
    const memory = { entries: [seen(3, 1, "a Potion of Cure Light Wounds", POTION)] };
    const view = remembering(w.view, memory);
    const { plan } = fetchPlan(w, view, defaultPersona());
    expect(plan.step(view, w.act)).toEqual({ code: "walk", dir: 6 });
    w.moveTo({ x: 2, y: 1 });
    memory.entries = [];
    expect(plan.step(view, w.act)).toBeNull();
  });

  it("ends the plan quietly when a second look finds the item gone", () => {
    const w = world({ map: ROOM, floor: [{ x: 3, y: 1, name: "a Potion of Cure Light Wounds" }] });
    const memory: { entries: KnownFloorItemView[]; look?: (ref: KnownFloorItemRef) => KnownFloorInspectResult } = { entries: [seen(3, 1, "a Potion of Cure Light Wounds", POTION)] };
    const view = remembering(w.view, memory);
    const { plan } = fetchPlan(w, view, defaultPersona());
    expect(plan.step(view, w.act)).toEqual({ code: "walk", dir: 6 });
    memory.look = () => ({ status: "stale", inspection: null });
    expect(plan.step(view, w.act)).toBeNull();
  });

  it("does not pick up when the pile under the character turns out empty", () => {
    const w = world({ map: ROOM, floor: [{ x: 3, y: 1, name: "a Potion of Cure Light Wounds" }] });
    const view = remembering(w.view, { entries: [seen(3, 1, "a Potion of Cure Light Wounds", POTION)] });
    const { plan } = fetchPlan(w, view, defaultPersona());
    w.moveTo({ x: 3, y: 1 });
    w.setFloor([]);
    expect(plan.step(view, w.act)).toBeNull();
  });

  it("picks up an unknown flavour a curious persona walked over to look at", () => {
    const w = world({ map: ROOM, floor: [{ x: 3, y: 1, name: "a Bubbling Potion" }] });
    const view = remembering(w.view, { entries: [seen(3, 1, "a Bubbling Potion", POTION)] });
    const { plan } = fetchPlan(w, view, archetype("scholar"));
    w.moveTo({ x: 3, y: 1 });
    expect(plan.step(view, w.act)).toEqual({ code: "pickup" });
    expect(plan.step(view, w.act)).toBeNull();
  });

  it("keeps a remembered item out of sight as the target", () => {
    const w = world({ map: ROOM });
    const view = remembering(w.view, { entries: [seen(3, 1, "a Potion of Cure Light Wounds", POTION, "remembered")] });
    expect(floorTarget(view, w.terrain, false)).toMatchObject({ at: { x: 3, y: 1 }, useful: true, value: null, known: true });
  });
});

describe("views without floor memory", () => {
  it("reads the floor as before", () => {
    const w = world({ map: ROOM, floor: [{ x: 3, y: 1, name: "a Potion of Cure Light Wounds" }] });
    expect(floorTarget(w.view, w.terrain, false, archetype("scholar"))).toEqual({ at: { x: 3, y: 1 }, name: "a Potion of Cure Light Wounds", away: 2, gold: false, sellable: false, useful: true, value: null });
    /* The older read cannot tell an unknown flavour, and took it as a potion worth carrying. */
    const flavour = world({ map: ROOM, floor: [{ x: 3, y: 1, name: "a Bubbling Potion" }] });
    expect(floorTarget(flavour.view, flavour.terrain, false, null)).toMatchObject({ at: { x: 3, y: 1 }, useful: true });
  });

  it("walks to the item and picks it up without a second look", () => {
    const w = world({ map: ROOM, floor: [{ x: 3, y: 1, name: "a Potion of Cure Light Wounds" }] });
    const { plan, offer } = fetchPlan(w, w.view, defaultPersona());
    expect(offer?.criteria).toBe("Walk 2 steps to the a Potion of Cure Light Wounds on the floor and pick it up.");
    expect(plan.step(w.view, w.act)).toEqual({ code: "walk", dir: 6 });
    w.moveTo({ x: 3, y: 1 });
    expect(plan.step(w.view, w.act)).toEqual({ code: "pickup" });
    expect(plan.step(w.view, w.act)).toBeNull();
  });
});
