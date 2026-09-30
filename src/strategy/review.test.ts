import { describe, expect, it } from "vitest";
import { suppliedWorld, world } from "../harness.js";
import { JEV, type AskResult } from "../brain/backend.js";
import { createTally } from "../brain/tally.js";
import type { ScoreAnswer, SystemOneRequest } from "../brain/systemone.js";
import { createStrategy, REVIEW_TURNS, reviewDue, scoreRequest, type Strategy } from "./review.js";
import { candidateAims } from "./aims.js";

const ROOM = ["#####", "#.@.#", "#####"];

function score(value: number): ScoreAnswer {
  return { type: "score", score: value, confidence: 0.9, probabilities: [] };
}

function reply(scores: Record<string, number>): AskResult {
  return {
    ok: true,
    answers: Object.fromEntries(Object.entries(scores).map(([k, v]) => [k, score(v)])),
    usage: { inputTokens: 100, outputTokens: 10, estimated: false },
    model: null,
    latencyMs: 1,
  } as AskResult;
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
    expect(logs).toHaveLength(1);
    strategy.observe(w.view);
    w.advance(REVIEW_TURNS - 1);
    strategy.observe(w.view);
    await strategy.settled();
    expect(logs).toHaveLength(1);
    w.advance(1);
    strategy.observe(w.view);
    await strategy.settled();
    expect(logs).toHaveLength(2);
    expect(strategy.last()?.trigger).toBe("periodic");
    w.advance(REVIEW_TURNS - 1);
    strategy.observe(w.view);
    await strategy.settled();
    expect(logs).toHaveLength(3);
    expect(strategy.last()?.trigger).toBe("budget");
    w.setPlayer({ level: 6 });
    strategy.observe(w.view);
    await strategy.settled();
    expect(strategy.last()?.trigger).toBe("level");
    w.setPlayer({ depth: 3 });
    strategy.observe(w.view);
    await strategy.settled();
    expect(strategy.last()?.trigger).toBe("arrival");
    expect(logs).toHaveLength(5);
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
    expect(logs).toHaveLength(2);
  });

  it("keeps only the newest review when an older one answers later", async () => {
    const w = world({ map: ROOM, worn: ["Wooden Torch"], player: { depth: 1 } });
    const releases: ((r: AskResult) => void)[] = [];
    const { strategy, logs } = rig(() => new Promise<AskResult>((resolve) => { releases.push(resolve); }));
    strategy.observe(w.view);
    w.setPlayer({ depth: 2 });
    strategy.observe(w.view);
    expect(releases).toHaveLength(2);
    releases[1]!(reply({ lantern: 10, depth: 90 }));
    await Promise.resolve();
    await new Promise((r) => setTimeout(r, 0));
    releases[0]!(reply({ lantern: 90, depth: 10 }));
    await strategy.settled();
    await new Promise((r) => setTimeout(r, 0));
    expect(strategy.ranked()[0]?.kind).toBe("depth");
    expect(logs).toHaveLength(1);
  });
});

describe("ranking", () => {
  it("sends one Score request with a question for each aim and ranks by score", async () => {
    const w = world({ map: ROOM, player: { level: 1, depth: 1, maxHp: 20 }, worn: ["Wooden Torch"], spells: [{ name: "Magic Missile", sidx: 0 }] });
    const { strategy, requests, logs, tally } = rig(() => Promise.resolve(reply({ depth: 3, lantern: 2, spellbook: 1, armour: 0 })));
    strategy.observe(w.view);
    await strategy.settled();
    expect(requests).toHaveLength(1);
    const questions = Object.values(requests[0]?.questions ?? {});
    expect(questions).toHaveLength(candidateAims(w.view).length);
    expect(questions.every((q) => q.type === "score")).toBe(true);
    expect(strategy.ranked().map((a) => a.kind)).toEqual(["depth", "lantern", "spellbook", "armour", "preparation"]);
    expect(strategy.last()?.source).toBe("model");
    expect(logs).toHaveLength(1);
    expect(logs[0]).toContain("Jev ranked them.");
    expect(tally.byBackend()["Jev"]?.requests).toBe(1);
  });

  it("keeps the fixed order on equal scores", async () => {
    const w = world({ map: ROOM, player: { level: 1, maxHp: 20 }, worn: ["Wooden Torch"] });
    const { strategy } = rig(() => Promise.resolve(reply({})));
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
    const w = suppliedWorld({ map: ROOM, worn: ["Lantern", "Soft Leather Armour", "Cloak", "Leather Shield", "Hard Helm", "Leather Boots", "Leather Gloves"] });
    const { strategy, requests } = rig(never);
    strategy.observe(w.view);
    await strategy.settled();
    expect(requests).toHaveLength(0);
    expect(strategy.ranked().map((a) => a.kind)).toEqual(["depth"]);
  });

  it("writes the aims and the character into the request state", () => {
    const w = world({ map: ROOM, worn: ["Wooden Torch"] });
    const request = scoreRequest(w.view, candidateAims(w.view));
    expect(Object.keys(request.state["aims"] as object)).toContain("lantern");
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