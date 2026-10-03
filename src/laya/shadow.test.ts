import { describe, expect, it, vi } from "vitest";
import type { NetLike } from "../brain/backend.js";
import type { DecisionRecord } from "../brain/brain.js";
import { createTally } from "../brain/tally.js";
import { memoryStore } from "../memory/kv.js";
import { attachHuman, createRows, exportRows, GOAL_SEQ_BASE, goalSeqCounter, rowId } from "./rows.js";
import { createShadow } from "./shadow.js";
import { LAYA_STATE_TOKENS, STATE_TOKEN_CAP, contextOf, fitToBudget, stateOf, stateTokens } from "../brain/context.js";

const INSTALL = "12345678-1234-4234-8234-123456789abc";
const URL = "http://localhost:8010/v1/systemone";
const goal = { type: "choice" as const, instructions: "Pick a plan.", criteria: { fight: "Fight.", none_of_these: null } };
const inCharacter = { type: "noul" as const, instructions: "Does it fit?", criteria: { true: "Yes.", false: "No." } };
const goalAnswer = { type: "choice" as const, choice: "fight", confidence: 0.8, probabilities: { fight: 0.9, none_of_these: 0.1 } };
const characterAnswer = { type: "noul" as const, p: 0.7 };

function decision(backend = "Jev"): DecisionRecord<unknown> {
  return {
    token: null,
    backend,
    request: { state: { hp: 12, place: "town" }, questions: { goal, in_character: inCharacter, ignored: inCharacter } },
    context: null,
    answers: { goal: goalAnswer, in_character: characterAnswer, ignored: characterAnswer },
    usage: { inputTokens: 10, outputTokens: 2, estimated: false },
    model: "jev-1.13.0",
    latencyMs: 1,
    outcome: "fight",
  };
}

function reply(request: { readonly body?: string }, adapter?: string): string {
  const body = JSON.parse(request.body ?? "{}") as { questions: Record<string, unknown> };
  const question = Object.keys(body.questions)[0];
  return JSON.stringify({ model: "laya", answers: { [question!]: question === "goal"
    ? { ...goalAnswer, probabilities: goalAnswer.probabilities }
    : { type: "noul", noul: 0.7 } }, ...(adapter === undefined ? {} : { routing: { adapter } }) });
}

describe("Laya shadow rows", () => {
  it("splits pilots, repeats the exact state, and records both replies without touching the Jev tally", async () => {
    const store = memoryStore();
    const rows = createRows(store, "run-1");
    const sent: { body?: string; url: string }[] = [];
    const net: NetLike = {
      transport: "relay",
      async request(request) {
        sent.push(request);
        return { ok: true, status: 200, headers: {}, body: reply(request, "trained") };
      },
    };
    const tally = createTally({ perSessionUsd: 0, perDayUsd: 0 });
    const shadow = createShadow({ net, rows, install: Promise.resolve(INSTALL), runId: "run-1", now: () => Date.parse("2026-09-27T23:00:00Z"), log: () => {} });
    await shadow.record(decision(), 3, true, URL);
    const exported = await exportRows(store);
    expect(exported.endsWith("\n")).toBe(true);
    expect(rowId(INSTALL, "run-1", 3, "squire_goal")).toBe(`squire-${INSTALL}-run-1-6`);
    expect(rowId(INSTALL, "run-1", 3, "squire_in_character")).toBe(`squire-${INSTALL}-run-1-7`);
    expect(rowId(INSTALL, "run-1", 3, "squire_gate")).toBe(`squire-${INSTALL}-run-1-3-gate`);
    const parsed = exported.trim().split("\n").map((line) => JSON.parse(line) as Record<string, unknown>);
    expect(parsed).toEqual([
      {
        id: rowId(INSTALL, "run-1", 3, "squire_goal"), pilot: "squire_goal", ts: "2026-09-27T23:00:00.000Z",
        state: { hp: 12, place: "town" }, questions: { goal }, jev: { model: "jev-1.13.0", answers: { goal: goalAnswer } },
        outcome: { plan: "fight" }, laya: { adapter: "trained", answers: { goal: goalAnswer } },
      },
      {
        id: rowId(INSTALL, "run-1", 3, "squire_in_character"), pilot: "squire_in_character", ts: "2026-09-27T23:00:00.000Z",
        state: { hp: 12, place: "town" }, questions: { in_character: inCharacter }, jev: { model: "jev-1.13.0", answers: { in_character: characterAnswer } },
        outcome: { plan: "fight" }, laya: { adapter: "trained", answers: { in_character: characterAnswer } },
      },
    ]);
    expect(sent.map((item) => JSON.parse(item.body ?? "{}"))).toEqual([
      { model: "laya:squire_goal", state: { hp: 12, place: "town" }, questions: { goal } },
      { model: "laya:squire_in_character", state: { hp: 12, place: "town" }, questions: { in_character: inCharacter } },
    ]);
    expect(sent.every((item) => item.url === URL)).toBe(true);
    expect(tally.session().requests).toBe(0);
  });

  it("keeps teacher rows when shadow is off or Laya fails, and logs failure once", async () => {
    const store = memoryStore();
    const rows = createRows(store, "run-2");
    const logs: string[] = [];
    let calls = 0;
    const net: NetLike = { transport: "page", async request() { calls++; return { ok: false, code: "unreachable", problem: "offline" }; } };
    const shadow = createShadow({ net, rows, install: Promise.resolve(INSTALL), runId: "run-2", now: () => 0, log: (line) => logs.push(line) });
    await shadow.record({ ...decision(), model: null }, 0, false, URL);
    await shadow.record(decision("Laya"), 1, true, URL);
    expect(calls).toBe(0);
    await shadow.record(decision(), 2, true, URL);
    await shadow.record(decision(), 3, true, URL);
    expect(calls).toBe(4);
    expect(logs).toHaveLength(1);
    const parsed = (await exportRows(store)).trim().split("\n").map((line) => JSON.parse(line) as Record<string, unknown>);
    expect(parsed).toHaveLength(6);
    expect(parsed.every((row) => !("laya" in row))).toBe(true);
    expect(parsed[0]?.["jev"]).toMatchObject({ model: "jev-latest" });
  });

  it("skips a pending call for each pilot and keeps the skipped teacher row", async () => {
    const store = memoryStore();
    const rows = createRows(store, "run-3");
    const release: (() => void)[] = [];
    let calls = 0;
    const net: NetLike = {
      transport: "relay",
      request(request) {
        calls++;
        return new Promise((resolve) => release.push(() => resolve({ ok: true, status: 200, headers: {}, body: reply(request) })));
      },
    };
    const shadow = createShadow({ net, rows, install: Promise.resolve(INSTALL), runId: "run-3", now: () => 0, log: () => {} });
    const first = shadow.record(decision(), 0, true, URL);
    const second = shadow.record(decision(), 1, true, URL);
    await vi.waitFor(() => expect(calls).toBe(2));
    for (const done of release) done();
    await Promise.all([first, second]);
    const parsed = (await exportRows(store)).trim().split("\n").map((line) => JSON.parse(line) as Record<string, unknown>);
    expect(parsed).toHaveLength(4);
    expect(parsed.filter((row) => "laya" in row)).toHaveLength(2);
    expect(parsed.filter((row) => "laya" in row).every((row) => (row["laya"] as { adapter: string }).adapter === "base")).toBe(true);
  });

  it("sends a goal question while the per-decision goal call on the same pilot is still pending", async () => {
    const store = memoryStore();
    const rows = createRows(store, "run-4");
    const release: (() => void)[] = [];
    const asked: string[] = [];
    const net: NetLike = {
      transport: "relay",
      request(request) {
        asked.push(Object.keys((JSON.parse(request.body ?? "{}") as { questions: Record<string, unknown> }).questions)[0] ?? "");
        return new Promise((resolve) => release.push(() => resolve({ ok: true, status: 200, headers: {}, body: reply(request) })));
      },
    };
    const shadow = createShadow({ net, rows, install: Promise.resolve(INSTALL), runId: "run-4", now: () => 0, log: () => {} });
    const question = { type: "choice" as const, instructions: "Which aim?", criteria: { depth: "Depth.", none_of_these: null } };
    const answer = { type: "choice" as const, choice: "depth", confidence: 0.8, probabilities: { depth: 1 } };
    const first = shadow.record(decision(), 0, true, URL);
    const second = shadow.record({ ...decision(), request: { state: { hp: 12 }, questions: { mid_goal: question } }, answers: { mid_goal: answer } }, 1, true, URL);
    await vi.waitFor(() => expect(asked).toContain("mid_goal"));
    expect(asked).toContain("goal");
    for (const done of release) done();
    await Promise.all([first, second]);
  });

  it("exports across runs and can attach a human correction", async () => {
    const store = memoryStore();
    const first = createRows(store, "a");
    const second = createRows(store, "b");
    const make = (runId: string) => ({ id: rowId(INSTALL, runId, 0, "squire_goal"), pilot: "squire_goal" as const, ts: "1970-01-01T00:00:00.000Z", state: {}, questions: { goal }, jev: { model: "jev-latest", answers: { goal: goalAnswer } }, outcome: { plan: "fight" } });
    await first.append(make("a"), 0);
    await second.append(make("b"), 0);
    await attachHuman(rowId(INSTALL, "a", 0, "squire_goal"), { goal: "retreat" });
    const lines = (await exportRows(store)).trim().split("\n").map((line) => JSON.parse(line) as Record<string, unknown>);
    expect(lines).toHaveLength(2);
    expect(lines[0]?.["human"]).toEqual({ goal: "retreat" });
    expect(lines[1]?.["human"]).toBeUndefined();
  });

  it("gives the goal questions their own row ids", async () => {
    const store = memoryStore();
    const rows = createRows(store, "run-9");
    const shadow = createShadow({ net: null, rows, install: Promise.resolve(INSTALL), runId: "run-9", now: () => 0, log: () => {} });
    const question = { type: "choice" as const, instructions: "Which goal?", criteria: { win: "Win.", none_of_these: null } };
    const answer = { type: "choice" as const, choice: "win", confidence: 0.8, probabilities: { win: 1 } };
    await shadow.record({
      ...decision(),
      request: { state: { hp: 12 }, questions: { long_goal: question, mid_goal: question, near_goal: question } },
      answers: { long_goal: answer, mid_goal: answer, near_goal: answer },
    }, 4, false, URL);
    const parsed = (await exportRows(store)).trim().split("\n").map((line) => JSON.parse(line) as { id: string });
    expect(parsed.map((row) => row.id)).toEqual([
      rowId(INSTALL, "run-9", 4, "squire_goal", "long"),
      rowId(INSTALL, "run-9", 4, "squire_goal", "mid"),
      rowId(INSTALL, "run-9", 4, "squire_goal", "near"),
    ]);
  });

  it("logs the tactical pack's escape gate and option choice as one row per pilot over the same budgeted state, with unique stable ids", async () => {
    const sent: Record<string, unknown>[] = [];
    const net: NetLike = {
      transport: "relay",
      async request(request) {
        sent.push(JSON.parse(request.body ?? "{}") as Record<string, unknown>);
        return { ok: true, status: 200, headers: {}, body: reply(request) };
      },
    };
    const escape = { type: "noul" as const, instructions: "Should the character stop what it is doing and get to safety now?", criteria: { true: "Get out.", false: "Stay." } };
    const ready = { type: "noul" as const, instructions: "Ready to go down?", criteria: { true: "Yes.", false: "No." } };
    const layers = contextOf([
      ["memory", "health", "Wounded: 12 of 40 HP."],
      ["memory", "creatures", "A cave spider is next to the character."],
      ["knowledge", "lessons", "Spiders come in swarms. ".repeat(600)],
    ]);
    const record = {
      ...decision(),
      request: { state: stateOf(fitToBudget(layers, STATE_TOKEN_CAP).context), questions: { goal, escape, ready_to_descend: ready } },
      answers: { goal: goalAnswer, escape: { type: "noul" as const, p: 0.8 }, ready_to_descend: { type: "noul" as const, p: 0.4 } },
    };
    const ids: string[][] = [];
    for (const run of [0, 1]) {
      const store = memoryStore();
      const shadow = createShadow({ net, rows: createRows(store, "run-2"), install: Promise.resolve(INSTALL), runId: "run-2", now: () => 0, log: () => {} });
      await shadow.record(record, 5, run === 0, URL, [], layers);
      ids.push((await exportRows(store)).trim().split("\n").map((line) => (JSON.parse(line) as { id: string }).id));
    }
    expect(ids[0]).toEqual([
      rowId(INSTALL, "run-2", 5, "squire_goal"),
      rowId(INSTALL, "run-2", 5, "squire_gate"),
      rowId(INSTALL, "run-2", 5, "squire_gate", "escape"),
    ]);
    expect(new Set(ids[0]).size).toBe(3);
    expect(ids[1]).toEqual(ids[0]);
    expect(sent.map((body) => body["model"])).toEqual(["laya:squire_goal", "laya:squire_gate", "laya:squire_gate"]);
    expect(sent.find((body) => "escape" in (body["questions"] as object))?.["questions"]).toEqual({ escape });
    for (const body of sent) {
      expect(body["state"]).toEqual(sent[0]!["state"]);
      expect(stateTokens(body["state"] as Record<string, unknown>)).toBeLessThanOrEqual(LAYA_STATE_TOKENS);
    }
  });

  it("logs the revise-goal question as a gate row with its own suffix, numbered with the goal rows", async () => {
    const store = memoryStore();
    const rows = createRows(store, "run-7");
    const shadow = createShadow({ net: null, rows, install: Promise.resolve(INSTALL), runId: "run-7", now: () => 0, log: () => {} });
    const question = { type: "noul" as const, instructions: "Should the character drop its current mid-term goal and choose again?", criteria: { true: "Drop it.", false: "Keep it." } };
    const seq = await goalSeqCounter(rows)();
    await shadow.record({ ...decision(), request: { state: { hp: 12 }, questions: { revise_goal: question } }, answers: { revise_goal: { type: "noul", p: 0.7 } } }, seq, false, URL);
    const parsed = (await exportRows(store)).trim().split("\n").map((line) => JSON.parse(line) as { id: string; pilot: string });
    expect(parsed).toEqual([expect.objectContaining({ id: rowId(INSTALL, "run-7", GOAL_SEQ_BASE, "squire_gate", "revise"), pilot: "squire_gate" })]);
    expect(await goalSeqCounter(createRows(store, "run-7"))()).toBe(GOAL_SEQ_BASE + 1);
  });

  it("numbers goal rows past a reload and keeps them when old decision chunks are pruned", async () => {
    const store = memoryStore();
    const question = { type: "choice" as const, instructions: "Which aim?", criteria: { depth: "Depth.", none_of_these: null } };
    const answer = { type: "choice" as const, choice: "depth", confidence: 0.8, probabilities: { depth: 1 } };
    const goalRecord = { ...decision(), request: { state: { hp: 12 }, questions: { mid_goal: question } }, answers: { mid_goal: answer } };
    const before = createRows(store, "run-5");
    const first = createShadow({ net: null, rows: before, install: Promise.resolve(INSTALL), runId: "run-5", now: () => 0, log: () => {} });
    const seq = await goalSeqCounter(before)();
    expect(seq).toBe(GOAL_SEQ_BASE);
    await first.record(goalRecord, seq, false, URL);
    const after = createRows(store, "run-5");
    const second = createShadow({ net: null, rows: after, install: Promise.resolve(INSTALL), runId: "run-5", now: () => 0, log: () => {} });
    const next = await goalSeqCounter(after)();
    expect(next).toBe(GOAL_SEQ_BASE + 1);
    await second.record(goalRecord, next, false, URL);
    for (let n = 0; n < 2_600; n += 1) await second.record({ ...decision(), request: { state: {}, questions: { goal } }, answers: { goal: goalAnswer } }, n, false, URL);
    const ids = (await exportRows(store)).trim().split("\n").map((line) => (JSON.parse(line) as { id: string }).id);
    expect(ids).toContain(rowId(INSTALL, "run-5", GOAL_SEQ_BASE, "squire_goal", "mid"));
    expect(ids).toContain(rowId(INSTALL, "run-5", GOAL_SEQ_BASE + 1, "squire_goal", "mid"));
  });

  it("holds a long Jev state to the Laya budget, keeps the situation and persona, and saves the state Laya saw", async () => {
    const store = memoryStore();
    const rows = createRows(store, "run-6");
    const sent: Record<string, unknown>[] = [];
    const net: NetLike = {
      transport: "relay",
      async request(request) {
        sent.push(JSON.parse(request.body ?? "{}") as Record<string, unknown>);
        return { ok: true, status: 200, headers: {}, body: reply(request) };
      },
    };
    const layers = contextOf([
      ["memory", "health", "Wounded: 12 of 40 HP."],
      ["memory", "creatures", "A cave spider is next to the character."],
      ["persona", "persona", { name: "Squire", temper: "Careful." }],
      ["knowledge", "lessons", "Spiders come in swarms. ".repeat(600)],
      ["manual", "rules", "Stairs lead to a new level. ".repeat(300)],
    ]);
    const jevState = stateOf(fitToBudget(layers, STATE_TOKEN_CAP).context);
    expect(stateTokens(jevState)).toBeGreaterThan(LAYA_STATE_TOKENS);
    const record = { ...decision(), request: { ...decision().request, state: jevState } };
    const shadow = createShadow({ net, rows, install: Promise.resolve(INSTALL), runId: "run-6", now: () => 0, log: () => {} });
    await shadow.record(record, 1, true, URL, [], layers);
    expect(sent).toHaveLength(2);
    for (const body of sent) {
      const state = body["state"] as Record<string, unknown>;
      expect(stateTokens(state)).toBeLessThanOrEqual(LAYA_STATE_TOKENS);
      expect(Object.keys(state)).toEqual(expect.arrayContaining(["health", "creatures", "persona"]));
    }
    const saved = (await exportRows(store)).trim().split("\n").map((line) => (JSON.parse(line) as { state: unknown }).state);
    expect(saved).toEqual(sent.map((body) => body["state"]));
    expect(record.request.state).toBe(jevState);
  });
});
