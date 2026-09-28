import { describe, expect, it } from "vitest";
import type { AgentActions, AgentCommand, AgentView } from "@rpgm-tools/neo-angband-core";
import { ask, JEV, selfHosted, type AskResult, type NetLike } from "./backend.js";
import { BACKOFF_MS, createBrain, MAX_EMPTY_DECISIONS, type Plan, type Planner, type Token } from "./brain.js";
import { parseReply, type SystemOneRequest } from "./systemone.js";
import { createTally, dayKey } from "./tally.js";

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
  return { ok: true, answers: parsed.answers, usage: parsed.usage, model: parsed.model, latencyMs: 300 };
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
}) {
  let clock = 1_000_000;
  const sent: SystemOneRequest[] = [];
  const logs: string[] = [];
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
  });
  return {
    brain,
    sent,
    logs,
    tick: () => brain.controller(view, act),
    advance: (ms: number) => {
      clock += ms;
    },
  };
}

describe("brain", () => {
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

  it("backs off after a retryable failure, then tries again", async () => {
    const down: AskResult = {
      ok: false,
      latencyMs: 5,
      failure: { kind: "unreachable", message: "Could not reach Jev: offline.", retryable: true },
    };
    const r = rig({ planner: planner(() => walks(1)), results: [down, answered()] });
    r.tick();
    await flush();
    expect(r.tick()).toBeNull();
    expect(r.brain.state()).toBe("waiting");
    r.advance((BACKOFF_MS[0] ?? 0) - 1);
    expect(r.tick()).toBeNull();
    expect(r.sent).toHaveLength(1);
    r.advance(1);
    expect(r.tick()).toBeNull();
    expect(r.sent).toHaveLength(2);
    await flush();
    expect(r.tick()).toEqual(WALK);
  });

  it("stops for good on a refused key, and says how to resume", async () => {
    const refused: AskResult = {
      ok: false,
      latencyMs: 5,
      failure: { kind: "key-refused", message: "Jev refused the API key.", retryable: false },
    };
    const r = rig({ planner: planner(() => walks(1)), results: [refused] });
    r.tick();
    await flush();
    expect(r.tick()).toBeNull();
    expect(r.brain.state()).toBe("stopped");
    expect(r.brain.stoppedBecause()).toContain("Ctrl-Z");
    expect(r.tick()).toBeNull();
    expect(r.sent).toHaveLength(1);
  });

  it("stops once the retries run out", async () => {
    const down: AskResult = {
      ok: false,
      latencyMs: 5,
      failure: { kind: "server-error", message: "Jev had a problem.", retryable: true },
    };
    const results = Array.from({ length: BACKOFF_MS.length + 1 }, () => down);
    const r = rig({ planner: planner(() => walks(1)), results });
    for (let i = 0; i <= BACKOFF_MS.length; i += 1) {
      r.tick();
      await flush();
      r.tick();
      r.advance(60_000);
    }
    expect(r.brain.state()).toBe("stopped");
    expect(r.sent).toHaveLength(BACKOFF_MS.length + 1);
  });

  it("stops when plan after plan does nothing", async () => {
    const results = Array.from({ length: MAX_EMPTY_DECISIONS + 2 }, () => answered());
    const r = rig({ planner: planner(() => walks(0)), results });
    for (let i = 0; i <= MAX_EMPTY_DECISIONS + 1; i += 1) {
      r.tick();
      await flush();
      r.tick();
    }
    expect(r.brain.state()).toBe("stopped");
  });

  it("hands back when the planner has nothing to ask", () => {
    const r = rig({
      planner: { ask: () => ({ handBack: "Nothing to do here." }), choose: () => ({ handBack: "" }), trigger: () => null },
      results: [],
    });
    expect(r.tick()).toBeNull();
    expect(r.brain.stoppedBecause()).toBe("Nothing to do here.");
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
