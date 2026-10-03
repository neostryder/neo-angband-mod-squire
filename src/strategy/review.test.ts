import type { AgentView, StoreView } from "@rpgm-tools/neo-angband-core";
import { describe, expect, it } from "vitest";
import { FEAT, itemNamed, suppliedWorld, world } from "../harness.js";
import { JEV, type AskResult } from "../brain/backend.js";
import { createTally } from "../brain/tally.js";
import type { Answer, SystemOneRequest } from "../brain/systemone.js";
import { defaultPersona, type Persona } from "../persona/persona.js";
import type { RunEvent } from "../report/events.js";
import { createStrategy, midGoalRequest, REVIEW_TURNS, reviewDue, type Strategy } from "./review.js";
import { CHECKPOINT_ACTIONS } from "./revise.js";
import { candidateAims } from "./aims.js";
import { LEAD_FACTOR, leadPursuits, pursuitFacts, pursuitsFor } from "./pursuits.js";
import { TV } from "../gear/compare.js";

const ROOM = ["#####", "#.@.#", "#####"];

function reply(probs: Record<string, number>): AskResult {
  const choice = Object.entries(probs).sort((a, b) => b[1] - a[1])[0]?.[0] ?? "none_of_these";
  return {
    ok: true,
    answers: { mid_goal: { type: "choice", choice, confidence: 0.9, probabilities: probs } },
    usage: { inputTokens: 100, outputTokens: 10, estimated: false },
    model: null,
    latencyMs: 1,
    server: "test",
  };
}

function aimLogs(logs: readonly string[]): string[] {
  return logs.filter((line) => line.startsWith("Squire looked over its aims"));
}

function rig(send: (request: SystemOneRequest) => Promise<AskResult>, backend: typeof JEV | null = JEV, caps = { perSessionUsd: 0, perDayUsd: 0 }) {
  const logs: string[] = [];
  const requests: SystemOneRequest[] = [];
  const tally = createTally(caps);
  const strategy: Strategy = createStrategy({
    backend: () => backend,
    send: (request) => {
      requests.push(request);
      return send(request);
    },
    tally,
    now: () => 0,
    log: (m) => logs.push(m),
  });
  return { strategy, logs, requests, tally };
}

const never = (): Promise<AskResult> => Promise.reject(new Error("unexpected request"));

describe("review triggers", () => {
  it("reviews on the first look, which is an arrival", () => {
    expect(reviewDue(null, { depth: 1, level: 1, turn: 1 })).toBe("arrival");
  });

  it("reviews on arrival at a new level, in either direction", () => {
    const mem = { depth: 2, level: 5, reviewTurn: 100 };
    expect(reviewDue(mem, { depth: 3, level: 5, turn: 101 })).toBe("arrival");
    expect(reviewDue(mem, { depth: 1, level: 5, turn: 101 })).toBe("arrival");
    expect(reviewDue(mem, { depth: 0, level: 5, turn: 101 })).toBe("arrival");
  });

  it("reviews after a town trip, when the character goes from the town back down", () => {
    expect(reviewDue({ depth: 0, level: 5, reviewTurn: 100 }, { depth: 4, level: 5, turn: 200 })).toBe("town");
  });

  it("reviews at a character level-up", () => {
    expect(reviewDue({ depth: 2, level: 5, reviewTurn: 100 }, { depth: 2, level: 6, turn: 101 })).toBe("level");
  });

  it("reviews every 2,000 game turns and not before", () => {
    const mem = { depth: 2, level: 5, reviewTurn: 100 };
    expect(reviewDue(mem, { depth: 2, level: 5, turn: 100 + REVIEW_TURNS - 1 })).toBeNull();
    expect(reviewDue(mem, { depth: 2, level: 5, turn: 100 + REVIEW_TURNS })).toBe("periodic");
  });

  it("triggers nothing else: same depth and level, less than 2,000 turns", () => {
    const mem = { depth: 2, level: 5, reviewTurn: 100 };
    for (const turn of [100, 101, 500, 1999, 2099]) expect(reviewDue(mem, { depth: 2, level: 5, turn })).toBeNull();
    expect(reviewDue(mem, { depth: 2, level: 4, turn: 200 })).toBeNull();
  });

  it("runs a review only at those moments when driven through observe", async () => {
    const w = world({ map: ROOM, player: { depth: 2, level: 5, maxHp: 100 } });
    const { strategy, logs } = rig(never, null);
    strategy.observe(w.view);
    await strategy.settled();
    expect(aimLogs(logs)).toHaveLength(1);
    strategy.observe(w.view);
    w.advance(REVIEW_TURNS - 1);
    strategy.observe(w.view);
    await strategy.settled();
    expect(aimLogs(logs)).toHaveLength(1);
    w.advance(1);
    strategy.observe(w.view);
    await strategy.settled();
    expect(aimLogs(logs)).toHaveLength(2);
    expect(strategy.last()?.trigger).toBe("periodic");
    w.advance(REVIEW_TURNS - 1);
    strategy.observe(w.view);
    await strategy.settled();
    expect(aimLogs(logs)).toHaveLength(3);
    expect(strategy.last()?.trigger).toBe("budget");
    w.setPlayer({ level: 6 });
    strategy.observe(w.view);
    await strategy.settled();
    expect(strategy.last()?.trigger).toBe("level");
    w.setPlayer({ depth: 3 });
    strategy.observe(w.view);
    await strategy.settled();
    expect(strategy.last()?.trigger).toBe("arrival");
    expect(aimLogs(logs)).toHaveLength(5);
  });

  it("reviews when the character goes from the town to the dungeon", async () => {
    const w = world({ map: ROOM, player: { depth: 0, level: 5, maxHp: 100 } });
    const { strategy, logs } = rig(never, null);
    strategy.observe(w.view);
    await strategy.settled();
    w.setPlayer({ depth: 3 });
    strategy.observe(w.view);
    await strategy.settled();
    expect(strategy.last()?.trigger).toBe("town");
    expect(aimLogs(logs)).toHaveLength(2);
  });

  it("keeps only the newest review when an older one answers later", async () => {
    const w = world({ map: ROOM, worn: ["Wooden Torch"], player: { depth: 1 } });
    const releases: ((r: AskResult) => void)[] = [];
    const { strategy, logs } = rig(() => new Promise<AskResult>((resolve) => { releases.push(resolve); }));
    strategy.observe(w.view);
    w.setPlayer({ depth: 2 });
    strategy.observe(w.view);
    expect(releases).toHaveLength(2);
    releases[1]!(reply({ lantern: 0.1, depth: 0.9 }));
    await Promise.resolve();
    await new Promise((r) => setTimeout(r, 0));
    releases[0]!(reply({ lantern: 0.9, depth: 0.1 }));
    await strategy.settled();
    await new Promise((r) => setTimeout(r, 0));
    expect(strategy.ranked()[0]?.kind).toBe("depth");
    expect(logs).toHaveLength(1);
  });
});

describe("ranking", () => {
  it("sends one Choice over the aims and ranks by its probabilities", async () => {
    const w = world({ map: ROOM, player: { level: 1, depth: 1, maxHp: 20 }, worn: ["Wooden Torch"], spells: [{ name: "Magic Missile", sidx: 0 }] });
    const { strategy, requests, logs, tally } = rig(() => Promise.resolve(reply({ depth: 3, lantern: 2, spellbook: 1, armour: 0 })));
    strategy.observe(w.view);
    await strategy.settled();
    expect(requests).toHaveLength(1);
    const question = requests[0]?.questions["mid_goal"];
    expect(question?.type).toBe("choice");
    if (question?.type === "choice") {
      for (const aim of candidateAims(w.view)) expect(question.criteria).toHaveProperty(aim.kind);
      expect(question.criteria).toHaveProperty("none_of_these");
    }
    expect(strategy.ranked().map((a) => a.kind)).toEqual(["depth", "lantern", "spellbook", "armour", "preparation", "win"]);
    expect(strategy.last()?.source).toBe("model");
    expect(logs).toHaveLength(1);
    expect(logs[0]).toContain("Jev ranked them.");
    expect(tally.byBackend()["Jev"]?.requests).toBe(1);
  });

  it("keeps the fixed order when the probabilities tie", async () => {
    const w = world({ map: ROOM, player: { level: 1, maxHp: 20 }, worn: ["Wooden Torch"] });
    const probs = Object.fromEntries(candidateAims(w.view).map((aim) => [aim.kind, 1]));
    const { strategy } = rig(() => Promise.resolve(reply(probs)));
    strategy.observe(w.view);
    await strategy.settled();
    expect(strategy.ranked().map((a) => a.kind)).toEqual(candidateAims(w.view).map((a) => a.kind));
  });

  it("falls back to the fixed order when there is no backend", async () => {
    const w = world({ map: ROOM, worn: ["Wooden Torch"] });
    const { strategy, requests, logs } = rig(never, null);
    strategy.observe(w.view);
    await strategy.settled();
    expect(requests).toHaveLength(0);
    expect(strategy.ranked().map((a) => a.kind)).toEqual(candidateAims(w.view).map((a) => a.kind));
    expect(strategy.last()?.source).toBe("fixed");
    expect(logs[0]).toContain("kept the usual order, because no model server is set up");
  });

  it("falls back to the fixed order when the request fails, is refused or throws", async () => {
    const w = world({ map: ROOM, worn: ["Wooden Torch"] });
    const fixed = candidateAims(w.view).map((a) => a.kind);
    const failure = { ok: false, failure: { kind: "unreachable", message: "down", retryable: true } } as AskResult;
    for (const send of [() => Promise.resolve(failure), () => Promise.reject(new Error("boom"))]) {
      const { strategy, logs, tally } = rig(send);
      strategy.observe(w.view);
      await strategy.settled();
      expect(strategy.ranked().map((a) => a.kind)).toEqual(fixed);
      expect(strategy.last()?.source).toBe("fixed");
      expect(logs).toHaveLength(1);
      expect(tally.byBackend()["Jev"]?.requests ?? 0).toBe(0);
    }
  });

  it("does not send when the spend cap is reached", async () => {
    const w = world({ map: ROOM, worn: ["Wooden Torch"] });
    const { strategy, requests, tally } = rig(never, JEV, { perSessionUsd: 0.000001, perDayUsd: 0 });
    tally.record(JEV, { inputTokens: 1_000_000, outputTokens: 1_000_000, estimated: false }, 0);
    strategy.observe(w.view);
    await strategy.settled();
    expect(requests).toHaveLength(0);
    expect(strategy.last()?.source).toBe("fixed");
  });

  it("does not ask when only one aim applies", async () => {
    const w = suppliedWorld({ map: ROOM, worn: ["Lantern (5000 turns)", "Soft Leather Armour", "Cloak", "Leather Shield", "Hard Helm", "Leather Boots", "Leather Gloves"] });
    const { strategy, requests } = rig(never);
    strategy.observe(w.view);
    await strategy.settled();
    expect(requests).toHaveLength(0);
    expect(strategy.ranked().map((a) => a.kind)).toEqual(["depth", "win"]);
  });

  it("writes each aim into the Choice and the character into the request state", () => {
    const w = world({ map: ROOM, worn: ["Wooden Torch"] });
    const request = midGoalRequest(w.view, candidateAims(w.view));
    const question = request.questions["mid_goal"];
    expect(question?.type).toBe("choice");
    if (question?.type === "choice") expect(question.criteria).toHaveProperty("lantern");
    expect(typeof request.state["character"]).toBe("string");
  });
});

describe("a new character", () => {
  it("starts with no aims and none carried over, and a stale review is dropped", async () => {
    const w = world({ map: ROOM, worn: ["Wooden Torch"] });
    let release: (r: AskResult) => void = () => undefined;
    const { strategy, logs } = rig(() => new Promise<AskResult>((resolve) => { release = resolve; }));
    expect(strategy.ranked()).toEqual([]);
    strategy.observe(w.view);
    strategy.reset();
    expect(strategy.ranked()).toEqual([]);
    release(reply({ depth: 5 }));
    await strategy.settled();
    expect(strategy.ranked()).toEqual([]);
    expect(strategy.last()).toBeNull();
    expect(logs).toHaveLength(0);
  });
});

describe("an heir's inherited aims", () => {
  it("ranks an inherited depth target and weapon with the code's own aims, and keeps them at later reviews", async () => {
    const w = world({ map: ROOM, worn: ["Wooden Torch"] });
    const { strategy } = rig(never, null);
    strategy.inherit([{ kind: "depth", depth: 8 }, { kind: "weapon", depth: null }]);
    strategy.observe(w.view);
    await strategy.settled();
    expect(strategy.ranked().find((a) => a.kind === "depth")?.depth).toBe(8);
    expect(strategy.ranked().map((a) => a.kind)).toContain("weapon");
    w.advance(REVIEW_TURNS + 1);
    strategy.observe(w.view);
    await strategy.settled();
    expect(strategy.ranked().find((a) => a.kind === "depth")?.depth).toBe(8);
    expect(strategy.ranked().map((a) => a.kind)).toContain("weapon");
  });

  it("drops an inherited depth target once the heir has reached it", async () => {
    const w = world({ map: ROOM, worn: ["Wooden Torch"] });
    const { strategy } = rig(never, null);
    const own = candidateAims(w.view).find((a) => a.kind === "depth")?.depth;
    strategy.inherit([{ kind: "depth", depth: 8 }]);
    strategy.observe(w.view);
    await strategy.settled();
    expect(strategy.ranked().find((a) => a.kind === "depth")?.depth).toBe(8);
    w.setPlayer({ maxDepth: 8 });
    w.advance(REVIEW_TURNS + 1);
    strategy.observe(w.view);
    await strategy.settled();
    expect(strategy.ranked().find((a) => a.kind === "depth")?.depth).toBe(own);
  });

  it("drops an inherited depth target once the heir's own target reaches as deep", async () => {
    const w = world({ map: ROOM, worn: ["Wooden Torch"], player: { level: 5, maxHp: 60 } });
    const { strategy } = rig(never, null);
    strategy.inherit([{ kind: "depth", depth: 8 }]);
    strategy.observe(w.view);
    await strategy.settled();
    expect(strategy.ranked().find((a) => a.kind === "depth")?.depth).toBe(8);
    w.setPlayer({ level: 30, maxHp: 300 });
    strategy.observe(w.view);
    await strategy.settled();
    expect(strategy.ranked().find((a) => a.kind === "depth")?.depth).toBe(15);
    w.setPlayer({ level: 12, maxHp: 120 });
    w.advance(REVIEW_TURNS + 1);
    strategy.observe(w.view);
    await strategy.settled();
    expect(strategy.ranked().find((a) => a.kind === "depth")?.depth).toBe(6);
  });

  it("drops an inherited weapon aim once a magical weapon is wielded", async () => {
    const w = world({ map: ROOM, worn: ["Wooden Torch"] });
    const { strategy } = rig(never, null);
    strategy.inherit([{ kind: "weapon", depth: null }]);
    strategy.observe(w.view);
    await strategy.settled();
    expect(strategy.ranked().map((a) => a.kind)).toContain("weapon");
    const armed = world({ map: ROOM, worn: ["Wooden Torch", "a Dagger of Slay Evil (1d4) (+3,+4)"] });
    strategy.observe(armed.view);
    await strategy.settled();
    armed.advance(REVIEW_TURNS + 1);
    strategy.observe(armed.view);
    await strategy.settled();
    expect(strategy.ranked().map((a) => a.kind)).not.toContain("weapon");
  });

  it("carries nothing after a reset", async () => {
    const w = world({ map: ROOM });
    const { strategy } = rig(never, null);
    const own = candidateAims(w.view).find((a) => a.kind === "depth")?.depth;
    strategy.inherit([{ kind: "depth", depth: 8 }]);
    strategy.reset();
    strategy.observe(w.view);
    await strategy.settled();
    expect(strategy.ranked().find((a) => a.kind === "depth")?.depth).toBe(own);
  });
});
describe("town trip gate", () => {
  it("allows a trip at first, and again only after the gold grows by half", async () => {
    const w = world({ map: ROOM, player: { depth: 0, gold: 200 } });
    const { strategy } = rig(never, null);
    expect(strategy.tripAllowed(200)).toBe(true);
    strategy.observe(w.view);
    w.setPlayer({ depth: 2 });
    strategy.observe(w.view);
    await strategy.settled();
    expect(strategy.tripAllowed(200)).toBe(false);
    expect(strategy.tripAllowed(299)).toBe(false);
    expect(strategy.tripAllowed(300)).toBe(true);
  });
});

function shop(): StoreView {
  return {
    feat: FEAT.GENERAL, featName: "STORE_GENERAL", isHome: false, owner: { name: "Bilbo", purse: 5000 },
    stock: [{ ...itemNamed("a Lantern", 0), index: 0, number: 1, price: 100 }],
  } as StoreView;
}

describe("the three goals", () => {
  it("raises the chosen pursuit once, and asks again at character level 20", async () => {
    const persona = defaultPersona("Mira");
    persona.sliders.ambition = 0;
    const w = world({ map: ROOM, player: { depth: 1, hp: 40, maxHp: 40 } });
    const requests: SystemOneRequest[] = [];
    const logs: string[] = [];
    const played = createStrategy({
      backend: () => JEV,
      send: (request) => {
        requests.push(request);
        const key = Object.keys(request.questions)[0] ?? "";
        if (key !== "long_goal") return Promise.resolve(reply({}));
        return Promise.resolve({
          ok: true,
          answers: { long_goal: { type: "choice", choice: "win", confidence: 0.9, probabilities: { win: 1 } } },
          usage: { inputTokens: 10, outputTokens: 2, estimated: false },
          model: null,
          latencyMs: 1,
          server: "test",
        });
      },
      tally: createTally({ perSessionUsd: 0, perDayUsd: 0 }),
      now: () => 0,
      log: (line) => logs.push(line),
      persona: () => persona,
      seed: () => "run-1",
    });
    const base = pursuitsFor(persona, 0, [], null, "run-1").find((item) => item.kind === "win")?.weight ?? 0;
    const led = Math.round(Math.min(1, base * LEAD_FACTOR) * 100) / 100;
    played.observe(w.view);
    await played.settled();
    expect(played.pursuits().find((item) => item.kind === "win")?.weight).toBe(led);
    expect(played.longLine()).toContain("Chosen on the first look at this character.");
    expect(played.showLongGoal()).toBe(false);
    expect(logs.some((line) => line.includes("Jev ranked them."))).toBe(true);
    expect(requests.some((request) => request.questions["long_goal"] !== undefined)).toBe(true);
    w.setPlayer({ level: 20 });
    played.observe(w.view);
    await played.settled();
    expect(played.pursuits().find((item) => item.kind === "win")?.weight).toBe(led);
    expect(logs.some((line) => line.includes("at character level 20"))).toBe(true);
  });

  it("does not log the only pursuit on the first look, and does on a later milestone", async () => {
    const w = world({ map: ROOM, player: { depth: 1, hp: 40, maxHp: 40 } });
    const { strategy, logs } = rig(never, null);
    strategy.observe(w.view);
    await strategy.settled();
    expect(logs.some((line) => line.includes("long-term"))).toBe(false);
    expect(strategy.longLine()).toContain("Win the game");
    w.setPlayer({ level: 20 });
    strategy.observe(w.view);
    await strategy.settled();
    expect(logs.some((line) => line.includes("only one long-term goal applies"))).toBe(true);
  });

  it("hides the long-term line unless the switch is on, and still keeps the sentence", async () => {
    const w = world({ map: ROOM, player: { hp: 40, maxHp: 40 } });
    const open = createStrategy({
      backend: () => null,
      send: never,
      tally: createTally({ perSessionUsd: 0, perDayUsd: 0 }),
      now: () => 0,
      log: () => {},
      revealLongGoal: () => true,
    });
    open.observe(w.view);
    await open.settled();
    expect(open.showLongGoal()).toBe(true);
    expect(open.longLine()).not.toBeNull();
  });

  it("reviews at once when the current mid-term goal is satisfied", async () => {
    const w = world({ map: ROOM, worn: ["Wooden Torch"], player: { hp: 40, maxHp: 40 } });
    const events: RunEvent[] = [];
    const strategy = createStrategy({
      backend: () => null, send: never, tally: createTally({ perSessionUsd: 0, perDayUsd: 0 }), now: () => 0, log: () => {},
      record: (event) => events.push(event),
    });
    strategy.observe(w.view);
    await strategy.settled();
    expect(strategy.ranked()[0]?.kind).toBe("lantern");
    const armed = world({ map: ROOM, worn: ["a Lantern"], player: { hp: 40, maxHp: 40 } });
    strategy.observe(armed.view);
    await strategy.settled();
    expect(strategy.last()?.trigger).toBe("met");
    expect(strategy.ranked().some((aim) => aim.kind === "lantern")).toBe(false);
    expect(events[0]?.kind).toBe("goal");
    expect(events[0]?.text).toContain("was met");
    expect(strategy.outcomeLines()[0]).toContain("was met");
  });

  it("reviews at once when the current mid-term goal's item sells out", async () => {
    const w = world({ map: ["#####", "#@.G#", "#####"], player: { depth: 0, hp: 40, maxHp: 40, gold: 20 }, worn: ["a Wooden Torch"], stores: [shop()] });
    const events: RunEvent[] = [];
    const logs: string[] = [];
    const strategy = createStrategy({
      backend: () => null, send: never, tally: createTally({ perSessionUsd: 0, perDayUsd: 0 }), now: () => 0, log: (line) => logs.push(line),
      record: (event) => events.push(event),
    });
    w.moveTo({ x: 3, y: 1 });
    strategy.remember(w.view, w.terrain);
    strategy.observe(w.view);
    await strategy.settled();
    expect(strategy.ranked()[0]?.kind).toBe("lantern");
    w.moveTo({ x: 1, y: 1 });
    strategy.remember(w.view, w.terrain);
    w.setStores([{ ...shop(), stock: [] }]);
    w.moveTo({ x: 3, y: 1 });
    strategy.remember(w.view, w.terrain);
    expect(logs.some((line) => line.includes("shopkeeper has none"))).toBe(true);
    expect(events).toEqual([]);
    strategy.observe(w.view);
    await strategy.settled();
    expect(strategy.last()?.trigger).toBe("failed");
    expect(events[0]?.text).toContain("failed");
    expect(events[0]?.text).toContain("sold out");
  });

  it("keeps the first feasible near-term goal when nothing answers, and records it when it is met", async () => {
    const w = world({ map: ROOM, player: { depth: 2, hp: 10, maxHp: 40 } });
    const events: RunEvent[] = [];
    const logs: string[] = [];
    const strategy = createStrategy({
      backend: () => null, send: never, tally: createTally({ perSessionUsd: 0, perDayUsd: 0 }), now: () => 0, log: (line) => logs.push(line),
      record: (event) => events.push(event),
    });
    strategy.observe(w.view);
    await strategy.settled();
    expect(strategy.nearLine()).toContain("Rest to full");
    expect(strategy.nearLine()).toContain("10 of 40 hit points");
    expect(strategy.nearKind()).toBe("rest");
    expect(logs.some((line) => line.includes("kept the first one"))).toBe(true);
    w.setPlayer({ hp: 40 });
    strategy.observe(w.view);
    await strategy.settled();
    expect(events.some((event) => event.text.includes("was met") && event.text.includes("hit points and spell points are full"))).toBe(true);
  });

  it("sends one long-term question while it is out, and keeps the first look's ranking", async () => {
    const persona = defaultPersona("Mira");
    persona.sliders.ambition = 0;
    const w = world({ map: ROOM, worn: ["Wooden Torch"], player: { depth: 1, hp: 40, maxHp: 40 } });
    const held: ((result: AskResult) => void)[] = [];
    const requests: SystemOneRequest[] = [];
    const logs: string[] = [];
    const played = createStrategy({
      backend: () => JEV,
      send: (request) => {
        requests.push(request);
        if (request.questions["long_goal"] === undefined) return Promise.resolve(reply({ depth: 3, lantern: 1 }));
        return new Promise<AskResult>((resolve) => { held.push(resolve); });
      },
      tally: createTally({ perSessionUsd: 0, perDayUsd: 0 }),
      now: () => 0,
      log: (line) => logs.push(line),
      persona: () => persona,
      seed: () => "run-1",
    });
    played.observe(w.view);
    w.advance(1);
    played.observe(w.view);
    w.advance(1);
    played.observe(w.view);
    expect(requests.filter((request) => request.questions["long_goal"] !== undefined)).toHaveLength(1);
    held[0]!(longAnswer("win"));
    await played.settled();
    expect(played.last()?.trigger).toBe("arrival");
    expect(played.ranked()[0]?.kind).toBe("depth");
    expect(played.midLine()).not.toBeNull();
    expect(aimLogs(logs)).toHaveLength(1);
    w.advance(1);
    played.observe(w.view);
    await played.settled();
    expect(requests.filter((request) => request.questions["long_goal"] !== undefined)).toHaveLength(1);
  });

  it("tells the mid-term question the raised weight of the chosen long-term goal", async () => {
    const persona = defaultPersona("Mira");
    persona.sliders.ambition = 0;
    const base = pursuitsFor(persona, 0, [], null, "run-1");
    const lifted = base.slice(1).find((item) => pursuitFacts(leadPursuits(base, item.kind))["goals"] !== pursuitFacts(base)["goals"]);
    expect(lifted).toBeDefined();
    const w = world({ map: ROOM, worn: ["Wooden Torch"], player: { depth: 1, hp: 40, maxHp: 40 } });
    const requests: SystemOneRequest[] = [];
    const played = createStrategy({
      backend: () => JEV,
      send: (request) => {
        requests.push(request);
        return Promise.resolve(request.questions["long_goal"] === undefined ? reply({ depth: 1 }) : longAnswer(lifted!.kind));
      },
      tally: createTally({ perSessionUsd: 0, perDayUsd: 0 }),
      now: () => 0,
      log: () => {},
      persona: () => persona,
      seed: () => "run-1",
    });
    played.observe(w.view);
    await played.settled();
    const mid = requests.find((request) => request.questions["mid_goal"] !== undefined);
    expect(mid?.state["goals"]).toBe(pursuitFacts(leadPursuits(base, lifted!.kind))["goals"]);
  });

  it("does not count a shop item the character stopped trusting as a met aim", async () => {
    const w = suppliedWorld({ map: ROOM, worn: ["Lantern (5000 turns)", "Soft Leather Armour", "Cloak", "Leather Shield", "Hard Helm", "Leather Boots", "Leather Gloves"], player: { depth: 1, hp: 40, maxHp: 40 } });
    const events: RunEvent[] = [];
    const strategy = createStrategy({
      backend: () => null, send: never, tally: createTally({ perSessionUsd: 0, perDayUsd: 0 }), now: () => 0, log: () => {},
      record: (event) => events.push(event),
      storeMemory: [{
        feat: FEAT.WEAPON, name: "Weapon Smiths", owner: null, turn: 0, lifetime: 1000,
        stock: [{ name: "a Dagger of Slay Evil (1d4) (+3,+4)", tval: TV.SWORD, price: 300, count: 1 }],
      }],
    });
    strategy.observe(w.view);
    await strategy.settled();
    expect(strategy.ranked()[0]?.kind).toBe("weapon");
    w.advance(1001);
    strategy.observe(w.view);
    await strategy.settled();
    const mid = events.find((event) => event.text.startsWith("The mid-term goal"));
    expect(mid?.text).toContain("was abandoned");
    expect(mid?.text).toContain("grew too old to count on");
    expect(strategy.last()?.trigger).toBe("lapsed");
  });

  it("records a family record that is beaten as met and chooses a new long-term goal", async () => {
    const persona = defaultPersona("Mira");
    persona.sliders.pride = 100;
    persona.sliders.ambition = 100;
    const w = world({ map: ROOM, player: { depth: 1, maxDepth: 1, hp: 40, maxHp: 40 } });
    const events: RunEvent[] = [];
    const longAsked: SystemOneRequest[] = [];
    const played = createStrategy({
      backend: () => JEV,
      send: (request) => {
        if (request.questions["long_goal"] === undefined) return Promise.resolve(reply({}));
        longAsked.push(request);
        return Promise.resolve(longAnswer(longAsked.length === 1 ? "record" : "win"));
      },
      tally: createTally({ perSessionUsd: 0, perDayUsd: 0 }),
      now: () => 0,
      log: () => {},
      persona: () => persona,
      family: () => ({ deepest: 5, heir: true }),
      seed: () => "run-1",
      record: (event) => events.push(event),
    });
    played.observe(w.view);
    await played.settled();
    expect(played.longLine()).toContain("Beat the family's deepest level");
    w.setPlayer({ depth: 5, maxDepth: 5 });
    played.observe(w.view);
    await played.settled();
    const long = events.find((event) => event.text.startsWith("The long-term goal"));
    expect(long?.text).toContain("was met");
    expect(long?.text).toContain("past the family's deepest of 5");
    expect(longAsked).toHaveLength(2);
    expect(played.longLine()).toContain("Chosen after the long-term goal was met.");
  });
});

function longAnswer(choice: string): AskResult {
  return {
    ok: true,
    answers: { long_goal: { type: "choice", choice, confidence: 0.9, probabilities: { [choice]: 1 } } },
    usage: { inputTokens: 10, outputTokens: 2, estimated: false },
    model: null,
    latencyMs: 1,
    server: "test",
  };
}

describe("the revise-goal check", () => {
  function answer(answers: Readonly<Record<string, Answer>>): AskResult {
    return { ok: true, answers, usage: { inputTokens: 10, outputTokens: 2, estimated: false }, model: null, latencyMs: 1, server: "test" };
  }

  /** A strategy whose revise answer the test sets; every other question gets no answer, so the fixed order stands. */
  function reviseRig(p: () => number | null, persona: Persona | null = null) {
    const logs: string[] = [];
    const events: RunEvent[] = [];
    const asked: SystemOneRequest[] = [];
    const strategy = createStrategy({
      backend: () => JEV,
      send: (request) => {
        if (request.questions["revise_goal"] === undefined) return Promise.resolve(answer({}));
        asked.push(request);
        const value = p();
        return Promise.resolve(answer(value === null ? {} : { revise_goal: { type: "noul", p: value } }));
      },
      tally: createTally({ perSessionUsd: 0, perDayUsd: 0 }),
      now: () => 0,
      log: (m) => logs.push(m),
      persona: () => persona,
      record: (event) => events.push(event),
    });
    return { strategy, logs, events, asked };
  }

  async function look(strategy: Strategy, view: AgentView): Promise<void> {
    strategy.observe(view);
    await strategy.settled();
  }

  async function walk(strategy: Strategy, view: AgentView, steps: number): Promise<void> {
    for (let n = 0; n < steps; n += 1) strategy.acted({ code: "walk" });
    await look(strategy, view);
  }

  const start = () => world({ map: ROOM, worn: ["Wooden Torch"], player: { depth: 1, level: 5, hp: 100, maxHp: 100 } });

  it("asks once at a trigger, and not again on the steps after", async () => {
    const w = start();
    const { strategy, asked } = reviseRig(() => 0.1);
    await look(strategy, w.view);
    expect(strategy.midLine()).not.toBeNull();
    w.setPlayer({ hp: 10 });
    await look(strategy, w.view);
    w.setPlayer({ hp: 60 });
    await look(strategy, w.view);
    await look(strategy, w.view);
    expect(asked).toHaveLength(1);
    expect(asked[0]?.state["moment"]).toBe("This check comes because the character nearly died and then recovered.");
  });

  it("drops the mid-term goal on a yes, records why, and chooses mid and near again", async () => {
    const w = start();
    const { strategy, events, logs } = reviseRig(() => 0.9);
    await look(strategy, w.view);
    const before = strategy.ranked()[0]?.label ?? "";
    w.setPlayer({ hp: 10 });
    await look(strategy, w.view);
    w.setPlayer({ hp: 60 });
    await look(strategy, w.view);
    const dropped = events.find((event) => event.text.startsWith("The mid-term goal"));
    expect(dropped?.text).toContain(`The mid-term goal ${before} was abandoned`);
    expect(dropped?.text).toContain("because the character nearly died and then recovered.");
    expect(logs).toContain(`Squire gave up ${before} after the character nearly died and then recovered, and will pick a new mid-term goal.`);
    await look(strategy, w.view);
    expect(strategy.ranked()[0]?.label).not.toBe(before);
    expect(strategy.midLine()).toContain("Chosen to replace the goal it gave up.");
    expect(strategy.nearLine()).toContain("Chosen because the mid-term goal was given up.");
  });

  it("changes nothing when no answer comes back", async () => {
    const w = start();
    const { strategy, events, asked, logs } = reviseRig(() => null);
    await look(strategy, w.view);
    const mid = strategy.midLine();
    await walk(strategy, w.view, 150);
    await look(strategy, w.view);
    expect(asked).toHaveLength(1);
    expect(strategy.midLine()).toBe(mid);
    expect(events.filter((event) => event.text.startsWith("The mid-term goal"))).toHaveLength(0);
    expect(logs.some((line) => line.endsWith("after the character took 150 actions since the last check, because no answer came back."))).toBe(true);
  });

  it("checks after 150 meaningful actions, and resting does not count", async () => {
    const w = start();
    const { strategy, asked } = reviseRig(() => 0.1);
    await look(strategy, w.view);
    for (let n = 0; n < 40; n += 1) strategy.acted({ code: "rest" });
    await walk(strategy, w.view, 149);
    expect(asked).toHaveLength(0);
    expect(strategy.nextCheck()?.actions).toBe(1);
    await walk(strategy, w.view, 1);
    expect(asked).toHaveLength(1);
    expect(asked[0]?.state["moment"]).toBe("This check comes because the character took 150 actions since the last check.");
    expect(strategy.nextCheck()?.actions).toBe(150);
  });

  it("checks when the player hands play back", async () => {
    const w = start();
    const { strategy, asked } = reviseRig(() => 0.1);
    await look(strategy, w.view);
    strategy.resumed();
    await look(strategy, w.view);
    await look(strategy, w.view);
    expect(asked).toHaveLength(1);
    expect(asked[0]?.state["moment"]).toBe("This check comes because a stretch of manual play ended.");
  });

  it("needs a firmer yes from a stubborn persona", async () => {
    const plain = defaultPersona("Plain");
    const stubborn = { ...plain, sliders: { ...plain.sliders, stubbornness: 85 } };
    for (const [persona, dropped] of [[plain, true], [stubborn, false]] as const) {
      const w = start();
      const { strategy, events, logs } = reviseRig(() => 0.6, persona);
      await look(strategy, w.view);
      await walk(strategy, w.view, 150);
      expect(events.some((event) => event.text.includes("was abandoned"))).toBe(dropped);
      if (!dropped) expect(logs.some((line) => line.endsWith("A less stubborn character would have dropped it."))).toBe(true);
    }
  });

  it("keeps a dropped goal from leading again for 2,000 game turns", async () => {
    const w = start();
    const { strategy } = reviseRig(() => 0.9);
    await look(strategy, w.view);
    const first = strategy.ranked()[0]?.kind;
    await walk(strategy, w.view, 150);
    await look(strategy, w.view);
    expect(strategy.ranked()[0]?.kind).not.toBe(first);
    expect(strategy.ranked().at(-1)?.kind).toBe(first);
    w.advance(REVIEW_TURNS);
    await look(strategy, w.view);
    expect(strategy.ranked()[0]?.kind).toBe(first);
  });

  it("drops at most two goals on one dungeon level for the whole run, and keeps a checkpoint it could not ask", async () => {
    const w = start();
    const { strategy, asked, events } = reviseRig(() => 0.9);
    await look(strategy, w.view);
    for (let n = 0; n < 3; n += 1) {
      await walk(strategy, w.view, 150);
      await look(strategy, w.view);
    }
    expect(asked).toHaveLength(2);
    expect(events.filter((event) => event.text.includes("was abandoned after"))).toHaveLength(2);
    expect(strategy.nextCheck()?.capped).toBe(true);
    expect(strategy.nextCheck()?.actions).toBe(0);
    /* On level 2 the overdue checkpoint is asked right away. */
    w.setPlayer({ depth: 2 });
    await look(strategy, w.view);
    expect(asked).toHaveLength(3);
    expect(strategy.nextCheck()?.capped).toBe(false);
    /* Going back up does not reset the first level's count. */
    w.setPlayer({ depth: 1 });
    await look(strategy, w.view);
    expect(strategy.nextCheck()?.capped).toBe(true);
    await walk(strategy, w.view, 150);
    await look(strategy, w.view);
    expect(asked).toHaveLength(3);
    w.setPlayer({ depth: 2 });
    await look(strategy, w.view);
    expect(asked).toHaveLength(4);
    expect(strategy.nextCheck()?.capped).toBe(true);
  });

  it("asks about healing potions Squire drank, and not about ones it dropped", async () => {
    const w = world({ map: ROOM, worn: ["Wooden Torch"], pack: ["4 Potions of Cure Light Wounds"], player: { depth: 1, level: 5, hp: 100, maxHp: 100 } });
    const { strategy, asked } = reviseRig(() => 0.1);
    await look(strategy, w.view);
    strategy.acted({ code: "drop", args: { handle: 1, quantity: 2 } });
    w.setPack(["2 Potions of Cure Light Wounds"]);
    await look(strategy, w.view);
    expect(asked).toHaveLength(0);
    strategy.acted({ code: "quaff", args: { handle: 1 } });
    w.setPack(["a Potion of Cure Light Wounds"]);
    await look(strategy, w.view);
    expect(asked).toHaveLength(1);
    expect(asked[0]?.state["moment"]).toBe("This check comes because the character used up half of its healing potions.");
  });

  it("sends one question at a time, and drops a late answer after a reset", async () => {
    const w = start();
    const releases: ((r: AskResult) => void)[] = [];
    const events: RunEvent[] = [];
    const strategy = createStrategy({
      backend: () => JEV,
      send: (request) => request.questions["revise_goal"] === undefined
        ? Promise.resolve(answer({}))
        : new Promise<AskResult>((resolve) => { releases.push(resolve); }),
      tally: createTally({ perSessionUsd: 0, perDayUsd: 0 }),
      now: () => 0,
      log: () => {},
      record: (event) => events.push(event),
    });
    await look(strategy, w.view);
    for (let n = 0; n < 150; n += 1) strategy.acted({ code: "walk" });
    strategy.observe(w.view);
    strategy.resumed();
    strategy.observe(w.view);
    for (let n = 0; n < 150; n += 1) strategy.acted({ code: "walk" });
    strategy.observe(w.view);
    expect(releases).toHaveLength(1);
    /* The checkpoint that came due while the first question was out stays due, and goes out once that question answers. */
    expect(strategy.nextCheck()?.actions).toBe(0);
    releases[0]!(answer({ revise_goal: { type: "noul", p: 0.1 } }));
    await strategy.settled();
    strategy.observe(w.view);
    expect(releases).toHaveLength(2);
    expect(strategy.nextCheck()?.actions).toBe(CHECKPOINT_ACTIONS);
    strategy.reset();
    releases[1]!(answer({ revise_goal: { type: "noul", p: 0.9 } }));
    await strategy.settled();
    expect(events).toHaveLength(0);
  });
});
