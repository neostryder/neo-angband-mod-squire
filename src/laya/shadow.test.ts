import { describe, expect, it, vi } from "vitest";
import type { NetLike } from "../brain/backend.js";
import type { DecisionRecord } from "../brain/brain.js";
import { createTally } from "../brain/tally.js";
import { memoryStore } from "../memory/kv.js";
import { attachHuman, createRows, exportRows, rowId } from "./rows.js";
import { createShadow } from "./shadow.js";

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
    const net: NetLike = { transport: "page", async request() { calls++; return { ok: false, code: "offline", problem: "offline" }; } };
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
});
