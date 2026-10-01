import { describe, expect, it, vi } from "vitest";
import type { AgentActions, AgentCommand, AgentView } from "@rpgm-tools/neo-angband-core";
import { ask, JEV, selfHosted, type AskResult, type NetLike } from "./backend.js";
import { BACKOFF_MS, createBrain, MAX_EMPTY_DECISIONS, outcomeLine, type Gauge, type Plan, type PlanEnd, type Planner, type Token } from "./brain.js";
import { parseReply, type SystemOneRequest } from "./systemone.js";
import { createTally, dayKey } from "./tally.js";
import { createRuntime, type SquireHost } from "../runtime.js";
import { memoryStore } from "../memory/kv.js";
import { suppliedWorld } from "../harness.js";
import { defaultCfg } from "../settings.js";

const view = {} as AgentView;
const act = {} as AgentActions;
const WALK: AgentCommand = { code: "walk", dir: 6 } as AgentCommand;

const REQUEST: SystemOneRequest = {
  state: { situation: "a corridor" },
  questions: {
    goal: {
      type: "choice",
      instructions: "What next?",
      criteria: { explore: "Walk the floor.", none_of_these: null },
    },
    safe: { type: "noul", instructions: "Safe?", criteria: { true: "yes", false: "no" } },
    danger: { type: "score", instructions: "How dangerous?", criteria: ["low", "high"] },
  },
};

const GOOD_BODY = JSON.stringify({
  model: "jev-1.13.0",
  answers: {
    goal: { type: "choice", choice: "explore", confidence: 0.9, probabilities: { explore: 0.95, none_of_these: 0.05 } },
    safe: { type: "noul", noul: 0.8 },
    danger: { type: "score", score: 0.2, confidence: 0.8, probabilities: { "0": 0.8, "1": 0.2 } },
  },
  usage: { input_tokens: 700, output_tokens: 40 },
});

function answered(): AskResult {
  const parsed = parseReply(REQUEST, "{}", GOOD_BODY);
  if (!parsed.ok) throw new Error(parsed.problem);
  return { ok: true, answers: parsed.answers, usage: parsed.usage, model: parsed.model, latencyMs: 300, server: "http://localhost:8010/v1/systemone" };
}

/** A plan that walks `n` times, then finishes. */
function walks(n: number): Plan {
  let left = n;
  return {
    label: `walk ${String(n)}`,
    step: () => (left-- > 0 ? WALK : null),
  };
}

function planner(make: () => Plan, trigger: () => string | null = () => null): Planner<null> {
  return {
    ask: () => ({ request: REQUEST, context: null }),
    choose: () => ({ plan: make() }),
    trigger: () => trigger(),
  };
}

/** Let settled promises deliver their results. */
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

function rig(options: {
  planner: Planner<null>;
  results: AskResult[];
  token?: () => Token | null;
  gauge?: () => Gauge;
  release?: (reason?: string) => void;
  view?: AgentView;
}) {
  let clock = 1_000_000;
  const sent: SystemOneRequest[] = [];
  const logs: string[] = [];
  const ends: PlanEnd[] = [];
  const brain = createBrain({
    backend: JEV,
    planner: options.planner,
    tally: createTally({ perSessionUsd: 0, perDayUsd: 0 }),
    send: (request) => {
      sent.push(request);
      const next = options.results.shift();
      if (next === undefined) throw new Error("no more results queued");
      return Promise.resolve(next);
    },
    token: options.token ?? (() => ({ epoch: 1, revision: 1 })),
    now: () => clock,
    log: (m) => logs.push(m),
    status: () => {},
    onPlanEnd: (end) => ends.push(end),
    ...(options.gauge === undefined ? {} : { gauge: options.gauge }),
  });
  return {
    brain,
    sent,
    logs,
    ends,
    tick: () => brain.controller(options.view ?? view, act),
    advance: (ms: number) => {
      clock += ms;
    },
  };
}

describe("brain", () => {
  it("leaves victory with the host and issues no further command", () => {
    const r = rig({ planner: planner(() => walks(1)), results: [], view: { player: () => ({ dead: false, winner: true }) } as AgentView });
    expect(r.tick()).toBeNull();
    expect(r.tick()).toBeNull();
    expect(r.brain.stoppedBecause()).toBe("The character has won.");
    expect(r.sent).toHaveLength(0);
  });
  it.each([
    { available: true, dead: false },
    { available: false, dead: false },
    { available: true, dead: true },
  ])("keeps host ownership through readiness blocks and death ($available, death $dead)", async ({ available, dead }) => {
    const release = vi.fn();
    const host: SquireHost = {
      log: () => {},
      /* A game older than the floor has no release; the cast stands in for it. */
      controller: { setStatus: () => {}, markNondeterministic: () => {}, ...(available ? { release } : {}) } as NonNullable<SquireHost["controller"]>,
      net: {
        transport: "page",
        request: async () => ({ ok: false, code: "unreachable", problem: "The test has no server." }),
        secrets: {
          storage: "page", has: async () => ({ present: true }),
          fromEnv: async () => ({ ok: false, problem: "The test has no environment." }),
          set: async () => ({ ok: true, storage: "page" }), delete: async () => ({ ok: true }),
        },
      },
    };
    const w = suppliedWorld({ map: ["########", "#.@..>.#", "########"], player: { depth: 1, level: 1, maxLevel: 1, dead } });
    const rt = createRuntime(host, { store: memoryStore() });
    const controller = rt.controllerFor(defaultCfg(), w.terrain, () => { throw new Error("expected the brain"); });
    await flush();
    controller(w.view, w.act);
    controller(w.view, w.act);
    expect(release).not.toHaveBeenCalled();
    expect(rt.brain()?.state()).toBe(dead ? "stopped" : "asking");
    expect(rt.brain()?.stoppedBecause()).toBe(dead ? "The character has died." : null);
  });

  it("asks, waits for the answer, then runs the plan", async () => {
    const r = rig({ planner: planner(() => walks(2)), results: [answered()] });
    expect(r.tick()).toBeNull();
    expect(r.brain.state()).toBe("asking");
    expect(r.tick()).toBeNull();
    await flush();
    expect(r.tick()).toEqual(WALK);
    expect(r.tick()).toEqual(WALK);
    expect(r.brain.state()).toBe("running");
    expect(r.sent).toHaveLength(1);
  });

  it("asks again when the plan finishes", async () => {
    const r = rig({ planner: planner(() => walks(1)), results: [answered(), answered()] });
    r.tick();
    await flush();
    expect(r.tick()).toEqual(WALK);
    expect(r.tick()).toBeNull();
    expect(r.sent).toHaveLength(2);
  });

  it("drops the plan when a trigger fires", async () => {
    let fire = false;
    const r = rig({ planner: planner(() => walks(10), () => (fire ? "a creature appeared" : null)), results: [answered(), answered()] });
    r.tick();
    await flush();
    expect(r.tick()).toEqual(WALK);
    fire = true;
    expect(r.tick()).toBeNull();
    expect(r.sent).toHaveLength(2);
    expect(r.logs.some((l) => l.includes("a creature appeared"))).toBe(true);
  });

  it("throws away an answer to a game that has moved on", async () => {
    let revision = 1;
    const r = rig({
      planner: planner(() => walks(1)),
      results: [answered(), answered()],
      token: () => ({ epoch: 1, revision }),
    });
    r.tick();
    revision = 2;
    await flush();
    expect(r.tick()).toBeNull();
    expect(r.brain.state()).toBe("idle");
    r.tick();
    await flush();
    expect(r.tick()).toEqual(WALK);
    expect(r.sent).toHaveLength(2);
  });

  it("plays by its own rules during backoff, then uses the model again", async () => {
    const down: AskResult = { ok: false, latencyMs: 5, failure: { kind: "unreachable", message: "Could not reach Jev: offline.", retryable: true } };
    const r = rig({ planner: planner(() => walks(1)), results: [down, answered()] });
    r.tick();
    await flush();
    expect(r.tick()).toBeNull();
    expect(r.brain.state()).toBe("running");
    r.advance(BACKOFF_MS[0]! - 1);
    expect(r.tick()).toEqual(WALK);
    expect(r.sent).toHaveLength(1);
    r.advance(1);
    expect(r.tick()).toBeNull();
    expect(r.sent).toHaveLength(2);
    await flush();
    expect(r.tick()).toEqual(WALK);
    expect(r.logs).toContain("Squire resumes model decisions.");
  });

  it("plays after a nonretryable request failure and retries later", async () => {
    const refused: AskResult = { ok: false, latencyMs: 5, failure: { kind: "key-refused", message: "Jev refused the API key.", retryable: false } };
    const r = rig({ planner: planner(() => walks(1)), results: [refused, answered()] });
    r.tick();
    await flush();
    r.tick();
    expect(r.tick()).toEqual(WALK);
    expect(r.brain.stoppedBecause()).toBeNull();
    expect(r.sent).toHaveLength(1);
    r.advance(BACKOFF_MS[0]!);
    r.tick();
    await flush();
    expect(r.tick()).toEqual(WALK);
    expect(r.sent).toHaveLength(2);
  });

  it("continues retrying after the backoff list ends", async () => {
    const down: AskResult = { ok: false, latencyMs: 5, failure: { kind: "server-error", message: "Jev had a problem.", retryable: true } };
    const count = BACKOFF_MS.length + 3;
    const r = rig({ planner: planner(() => walks(1)), results: Array.from({ length: count }, () => down) });
    r.tick();
    for (let i = 0; i < count; i += 1) {
      await flush();
      r.tick();
      expect(r.tick()).toEqual(WALK);
      expect(r.brain.stoppedBecause()).toBeNull();
      r.advance(60000);
      if (i < count - 1) r.tick();
    }
    expect(r.sent).toHaveLength(count);
    expect(r.logs.filter((line) => line.includes("plays by its own rules"))).toHaveLength(1);
  });

  it("continues retrying after the backoff list ends with Retry-After", async () => {
    const down: AskResult = { ok: false, latencyMs: 5, failure: { kind: "server-error", message: "Jev had a problem.", retryable: true, retryAfterMs: 30000 } };
    const count = BACKOFF_MS.length + 3;
    const r = rig({ planner: planner(() => walks(1)), results: Array.from({ length: count }, () => down) });
    r.tick();
    for (let i = 0; i < count; i += 1) {
      await flush();
      r.tick();
      expect(r.tick()).toEqual(WALK);
      expect(r.brain.stoppedBecause()).toBeNull();
      r.advance(60000);
      if (i < count - 1) r.tick();
    }
    expect(r.sent).toHaveLength(count);
    expect(r.logs.filter((line) => line.includes("plays by its own rules"))).toHaveLength(1);
  });

  it("pauses an empty-plan loop and tries a different rule choice", async () => {
    let tries = 0;
    const p = planner(() => walks(0));
    p.rules = () => { tries += 1; return { reflex: "another move", plan: walks(1), context: null, answers: {} }; };
    const r = rig({ planner: p, results: Array.from({ length: MAX_EMPTY_DECISIONS + 2 }, () => answered()) });
    for (let i = 0; i <= MAX_EMPTY_DECISIONS + 1; i += 1) { r.tick(); await flush(); r.tick(); }
    expect(r.brain.state()).toBe("waiting");
    expect(r.brain.stoppedBecause()).toBeNull();
    r.advance(1000);
    r.tick();
    expect(r.tick()).toEqual(WALK);
    expect(tries).toBe(1);
  });

  it("keeps going while each empty plan is a different goal", async () => {
    /* The soak's Rogue, Ranger and Mage stopped for good after retreat,
     * leave_level, descend, fetch and explore each ended with no command. */
    const labels = ["retreat", "leave_level", "descend", "fetch", "explore", "wait"];
    let next = 0;
    const results = [...labels, "again"].map(() => answered());
    const r = rig({ planner: planner(() => ({ label: labels[next++]!, step: () => null })), results });
    for (let i = 0; i < labels.length; i += 1) {
      r.tick();
      await flush();
      r.tick();
    }
    expect(r.brain.state()).not.toBe("stopped");
  });

  it("pauses and retries when the planner has nothing to ask", () => {
    const r = rig({
      planner: { ask: () => ({ handBack: "Nothing to do here." }), choose: () => ({ handBack: "" }), trigger: () => null },
      results: [],
    });
    expect(r.tick()).toBeNull();
    expect(r.brain.stoppedBecause()).toBeNull();
    expect(r.brain.state()).toBe("waiting");
  });

  it("keeps the keyboard when a planner cannot act", () => {
    const release = vi.fn();
    const r = rig({
      planner: { ask: () => ({ handBack: "Nothing to do here." }), choose: () => ({ handBack: "" }), trigger: () => null },
      results: [], release,
    });
    r.tick();
    r.tick();
    expect(release).not.toHaveBeenCalled();
    expect(r.logs).toHaveLength(1);
    expect(r.brain.stoppedBecause()).toBeNull();
  });

  it("keeps the keyboard after a failed request", async () => {
    const release = vi.fn();
    const r = rig({ planner: planner(() => walks(1)), release, results: [{
      ok: false, latencyMs: 5,
      failure: { kind: "key-refused", message: "Jev refused the API key.", retryable: false },
    }] });
    r.tick();
    await flush();
    r.tick();
    r.tick();
    expect(release).not.toHaveBeenCalled();
    expect(r.brain.stoppedBecause()).toBeNull();
  });

  it("leaves the death hand-back to the host without releasing", () => {
    const release = vi.fn();
    const r = rig({
      planner: { ask: () => ({ handBack: "The character has died." }), choose: () => ({ handBack: "" }), trigger: () => null },
      results: [], release, view: { player: () => ({ dead: true }) } as AgentView,
    });
    r.tick();
    r.tick();
    expect(r.brain.stoppedBecause()).toBe("The character has died.");
    expect(release).not.toHaveBeenCalled();
  });

  it("records an interrupted decision when a planner cannot act", () => {
    const outcomes: string[] = [];
    const ends: PlanEnd[] = [];
    const brain = createBrain<null>({
      backend: JEV,
      planner: { ask: () => ({ handBack: "Squire has nothing left to try here.", context: null }), choose: () => ({ handBack: "" }), trigger: () => null },
      tally: createTally({ perSessionUsd: 0, perDayUsd: 0 }),
      send: () => { throw new Error("a hand-back sends nothing"); },
      token: () => ({ epoch: 1, revision: 1 }),
      now: () => 0,
      log: () => {},
      status: () => {},
      onDecision: (record) => outcomes.push(`${record.reflex ?? "asked"}: ${record.outcome}`),
      onPlanEnd: (end) => ends.push(end),
    });
    expect(brain.controller(view, act)).toBeNull();
    expect(brain.state()).toBe("waiting");
    expect(brain.stoppedBecause()).toBeNull();
    expect(outcomes).toEqual(["nothing to offer: try again: Squire has nothing left to try here."]);
    expect(ends).toMatchObject([{ stop: "interrupted", reason: "Squire has nothing left to try here." }]);
  });
});

describe("reflexes", () => {
  it.each(["session", "day"])("plays under a %s spend cap and resumes when it allows requests", async (kind) => {
    const caps = { perSessionUsd: kind === "session" ? 0.001 : 0, perDayUsd: kind === "day" ? 0.001 : 0 };
    let now = new Date(2026, 8, 30, 12).getTime();
    const tally = createTally(caps);
    tally.record(JEV, { inputTokens: 1_000_000, outputTokens: 0, estimated: false }, now);
    const send = vi.fn(async () => answered());
    const logs: string[] = [];
    const status = vi.fn();
    const brain = createBrain({ backend: JEV, planner: planner(() => walks(1)), tally, send, token: () => ({ epoch: 1, revision: 1 }), now: () => now, log: (line) => logs.push(line), status });
    brain.controller(view, act);
    expect(brain.controller(view, act)).toEqual(WALK);
    brain.controller(view, act);
    expect(brain.controller(view, act)).toEqual(WALK);
    expect(send).not.toHaveBeenCalled();
    expect(logs.filter((line) => line.includes("plays by its own rules"))).toHaveLength(1);
    expect(status).toHaveBeenLastCalledWith("walk 1", expect.stringContaining("spend limit"));
    if (kind === "session") caps.perSessionUsd = 0;
    else now += 24 * 60 * 60 * 1000;
    brain.controller(view, act);
    await flush();
    expect(brain.controller(view, act)).toEqual(WALK);
    expect(send).toHaveBeenCalledTimes(1);
    expect(brain.stoppedBecause()).toBeNull();
  });

  it("uses rule decisions with no model and sends no requests", () => {
    const send = vi.fn();
    const p = planner(() => walks(1));
    p.rules = () => ({ reflex: "own rules", plan: walks(1), context: null, answers: {} });
    const brain = createBrain({ backend: JEV, rulesOnly: true, planner: p, tally: createTally({ perSessionUsd: 0, perDayUsd: 0 }), send, token: () => null, now: () => 0, log: () => {}, status: () => {} });
    brain.controller(view, act);
    expect(brain.controller(view, act)).toEqual(WALK);
    brain.controller(view, act);
    expect(brain.controller(view, act)).toEqual(WALK);
    expect(send).not.toHaveBeenCalled();
  });

  it("runs a reflex without sending a request, and logs it as a decision", () => {
    const decisions: string[] = [];
    const brain = createBrain({
      backend: JEV,
      planner: {
        ask: () => ({ reflex: "routine upkeep", plan: walks(1), context: null, answers: {} }),
        choose: () => ({ handBack: "" }),
        trigger: () => null,
      },
      tally: createTally({ perSessionUsd: 0, perDayUsd: 0 }),
      send: () => { throw new Error("a reflex sends nothing"); },
      token: () => ({ epoch: 1, revision: 1 }),
      now: () => 0,
      log: () => {},
      status: () => {},
      onDecision: (record) => decisions.push(`${record.reflex ?? "asked"}: ${record.outcome}`),
    });
    expect(brain.controller(view, act)).toBeNull();
    expect(brain.state()).toBe("running");
    expect(brain.controller(view, act)).toEqual(WALK);
    expect(decisions).toEqual(["routine upkeep: walk 1"]);
  });
});

describe("plan outcomes", () => {
  it("abandons a plan that makes no progress for 30 seconds and asks again", async () => {
    const game = { turn: 10, hp: 30, depth: 1 };
    const r = rig({ planner: planner(() => walks(100)), results: [answered(), answered()], gauge: () => ({ ...game }) });
    r.tick();
    await flush();
    expect(r.tick()).toEqual(WALK);
    r.advance(30_001);
    expect(r.tick()).toBeNull();
    expect(r.ends[0]).toMatchObject({ stop: "interrupted", reason: "Squire made no progress for 30 seconds." });
    expect(r.brain.state()).toBe("waiting");
    expect(r.sent).toHaveLength(1);
    r.advance(1000);
    r.tick();
    await flush();
    expect(r.tick()).toEqual(WALK);
    expect(r.brain.stoppedBecause()).toBeNull();
  });

  it("keeps a long plan when game turns continue to pass", async () => {
    const game = { turn: 10, hp: 30, depth: 1 };
    const r = rig({ planner: planner(() => walks(100)), results: [answered()], gauge: () => ({ ...game }) });
    r.tick();
    await flush();
    expect(r.tick()).toEqual(WALK);
    r.advance(20_000);
    game.turn += 1;
    expect(r.tick()).toEqual(WALK);
    r.advance(20_000);
    expect(r.tick()).toEqual(WALK);
    expect(r.ends).toHaveLength(0);
  });

  it("abandons a plan after 60 seconds even when commands pass game time", async () => {
    const game = { turn: 10, hp: 30, depth: 1 };
    const r = rig({ planner: planner(() => walks(100)), results: [answered(), answered()], gauge: () => ({ ...game }) });
    r.tick();
    await flush();
    expect(r.tick()).toEqual(WALK);
    for (let i = 0; i < 3; i++) {
      r.advance(20_000);
      game.turn += 1;
      if (i < 2) expect(r.tick()).toEqual(WALK);
    }
    expect(r.tick()).toBeNull();
    expect(r.ends[0]).toMatchObject({ stop: "interrupted", reason: "The plan ran for 60 seconds." });
    expect(r.sent).toHaveLength(2);
  });

  it("reports a finished plan with its commands and hit point change", async () => {
    const game = { turn: 10, hp: 30 };
    const r = rig({ planner: planner(() => walks(2)), results: [answered(), answered()], gauge: () => ({ ...game }) });
    r.tick();
    await flush();
    r.tick();
    game.turn += 1;
    game.hp -= 4;
    r.tick();
    game.turn += 1;
    game.hp -= 3;
    r.tick();
    expect(r.ends).toEqual([{ stop: "finished", reason: null, commands: 2, refused: 0, hpBefore: 30, hpAfter: 23 }]);
    expect(outcomeLine(r.ends[0]!)).toBe("finished, 2 commands, hp -7");
  });

  it("counts a command after which no game time passed as refused", async () => {
    const game = { turn: 10, hp: 30 };
    const r = rig({ planner: planner(() => walks(3)), results: [answered(), answered()], gauge: () => ({ ...game }) });
    r.tick();
    await flush();
    r.tick();
    r.tick();
    game.turn += 1;
    r.tick();
    game.turn += 1;
    r.tick();
    expect(r.ends[0]).toMatchObject({ stop: "finished", commands: 3, refused: 1 });
    expect(outcomeLine(r.ends[0]!)).toBe("finished, 3 commands, 1 refused, hp 0");
  });

  it("does not count a staircase as refused, though it passes no game turn", async () => {
    /* The soak's Priest: every stair taken at turn 3011 was logged as refused. */
    const game = { turn: 3011, hp: 7, depth: 0 };
    const r = rig({ planner: planner(() => walks(1)), results: [answered(), answered()], gauge: () => ({ ...game }) });
    r.tick();
    await flush();
    r.tick();
    game.depth = 1;
    r.tick();
    expect(r.ends[0]).toMatchObject({ stop: "finished", commands: 1, refused: 0 });
  });

  it("reports the trigger that dropped a plan", async () => {
    let fire = false;
    const r = rig({ planner: planner(() => walks(10), () => (fire ? "a creature appeared" : null)), results: [answered(), answered()] });
    r.tick();
    await flush();
    r.tick();
    fire = true;
    r.tick();
    expect(r.ends).toEqual([{ stop: "interrupted", reason: "a creature appeared", commands: 1, refused: 0, hpBefore: null, hpAfter: null }]);
    expect(outcomeLine(r.ends[0]!)).toBe("interrupted, 1 command");
  });

  it("reports an unusable decision as interrupted", async () => {
    const r = rig({
      planner: { ask: () => ({ request: REQUEST, context: null }), choose: () => ({ handBack: "The character is in town." }), trigger: () => null },
      results: [answered()],
      gauge: () => ({ turn: 1, hp: 12 }),
    });
    r.tick();
    await flush();
    r.tick();
    expect(r.ends).toEqual([{ stop: "interrupted", reason: "The character is in town.", commands: 0, refused: 0, hpBefore: 12, hpAfter: 12 }]);
    expect(outcomeLine(r.ends[0]!)).toBe("interrupted, 0 commands, hp 0");
  });
});

describe("tally", () => {
  it("prices metered backends and stops at a session cap", () => {
    const tally = createTally({ perSessionUsd: 0.01, perDayUsd: 0 });
    const usage = { inputTokens: 200_000, outputTokens: 0, estimated: false };
    tally.record(JEV, usage, 0);
    expect(tally.session().usd).toBeCloseTo(0.008);
    expect(tally.overCap(JEV, 0)).toBeNull();
    tally.record(JEV, usage, 0);
    expect(tally.overCap(JEV, 0)?.kind).toBe("over-cap");
  });

  it("counts an unmetered backend without a cost or a cap", () => {
    const laya = selfHosted("laya", "Laya", "http://192.168.2.154:8010/v1/systemone");
    const tally = createTally({ perSessionUsd: 0.01, perDayUsd: 0.01 });
    tally.record(laya, { inputTokens: 5_000_000, outputTokens: 0, estimated: true }, 0);
    expect(tally.session().inputTokens).toBe(5_000_000);
    expect(tally.session().estimated).toBe(1);
    expect(tally.session().usd).toBe(0);
    expect(tally.overCap(laya, 0)).toBeNull();
  });

  it("carries a day cap across sessions, and resets it the next day", () => {
    const now = new Date(2026, 8, 27, 12).getTime();
    const tally = createTally({ perSessionUsd: 0, perDayUsd: 0.05 }, { day: dayKey(now), usd: 0.05 });
    expect(tally.overCap(JEV, now)?.kind).toBe("over-cap");
    expect(tally.overCap(JEV, now + 24 * 3_600_000)).toBeNull();
  });
});

describe("parseReply", () => {
  it("reads every answer type and the usage", () => {
    const parsed = parseReply(REQUEST, "{}", GOOD_BODY);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.answers["goal"]).toMatchObject({ type: "choice", choice: "explore" });
    expect(parsed.answers["safe"]).toEqual({ type: "noul", p: 0.8 });
    expect(parsed.answers["danger"]).toMatchObject({ type: "score", probabilities: [0.8, 0.2] });
    expect(parsed.usage).toEqual({ inputTokens: 700, outputTokens: 40, estimated: false });
    expect(parsed.model).toBe("jev-1.13.0");
  });

  it("estimates tokens when the server reports none", () => {
    const body = JSON.parse(GOOD_BODY) as Record<string, unknown>;
    delete body["usage"];
    const parsed = parseReply(REQUEST, "x".repeat(400), JSON.stringify(body));
    expect(parsed.ok && parsed.usage).toEqual({ inputTokens: 100, outputTokens: 0, estimated: true });
  });

  it("refuses a missing answer, a wrong type and an option that was not offered", () => {
    const body = JSON.parse(GOOD_BODY) as { answers: Record<string, unknown> };
    const missing = structuredClone(body);
    delete missing.answers["safe"];
    expect(parseReply(REQUEST, "{}", JSON.stringify(missing)).ok).toBe(false);
    const wrongType = structuredClone(body);
    wrongType.answers["safe"] = { type: "score", score: 1 };
    expect(parseReply(REQUEST, "{}", JSON.stringify(wrongType)).ok).toBe(false);
    const stray = structuredClone(body);
    stray.answers["goal"] = { type: "choice", choice: "fight", probabilities: {} };
    expect(parseReply(REQUEST, "{}", JSON.stringify(stray)).ok).toBe(false);
    expect(parseReply(REQUEST, "{}", "not json").ok).toBe(false);
  });
});

describe("ask", () => {
  function net(reply: Awaited<ReturnType<NetLike["request"]>>, seen?: Parameters<NetLike["request"]>[0][]): NetLike {
    return {
      transport: "relay",
      request: (req) => {
        seen?.push(req);
        return Promise.resolve(reply);
      },
    };
  }

  it("sends the key as a secret template and the model name", async () => {
    const seen: Parameters<NetLike["request"]>[0][] = [];
    const result = await ask(net({ ok: true, status: 200, headers: {}, body: GOOD_BODY }, seen), JEV, REQUEST, () => 0);
    expect(result.ok).toBe(true);
    expect(seen[0]?.headers?.["Authorization"]).toBe("Bearer {secret:jev}");
    expect(JSON.parse(seen[0]?.body ?? "{}")).toMatchObject({ model: "jev-latest" });
  });

  it("names each failure the way the brain acts on it", async () => {
    const at = (status: number, headers: Record<string, string> = {}) =>
      ask(net({ ok: true, status, headers, body: "" }), JEV, REQUEST, () => 0);
    const kinds = await Promise.all([at(401), at(429, { "retry-after": "3" }), at(503), at(400)]);
    expect(kinds.map((k) => (k.ok ? "ok" : k.failure.kind))).toEqual(["key-refused", "rate-limited", "server-error", "bad-reply"]);
    const limited = kinds[1];
    expect(limited && !limited.ok && limited.failure.retryAfterMs).toBe(3_000);

    const noHost = await ask(net({ ok: false, code: "not-declared", problem: "no" }), JEV, REQUEST, () => 0);
    expect(!noHost.ok && noHost.failure.kind).toBe("not-allowed");
    const offline = await ask(net({ ok: false, code: "unreachable", problem: "offline" }), JEV, REQUEST, () => 0);
    expect(!offline.ok && offline.failure).toMatchObject({ kind: "unreachable", retryable: true });
  });
});
