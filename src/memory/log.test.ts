import { expect, it } from "vitest";
import { memoryStore } from "./kv.js";
import { createDecisionLog, deleteRun, listRuns } from "./log.js";

const input = {
  at: 1, turn: 1, trigger: "start", backend: "Jev", question: "move", choice: "north",
  confidence: 0.8, probs: { north: 0.8 }, state: {}, options: ["north"], plan: "walk north",
  latencyMs: 5, inputTokens: 20, outputTokens: 1, estimatedTokens: false,
};

it("persists outcomes in chunks and exports JSONL", async () => {
  const store = memoryStore();
  const log = createDecisionLog(store, "run-1");
  const id = log.append(input);
  log.attachOutcome(id, "reached stair");
  await log.flush();
  const loaded = createDecisionLog(store, "run-1");
  await loaded.load();
  expect(loaded.records()[0]?.outcome).toBe("reached stair");
  expect(loaded.exportJsonl()).toBe(`${JSON.stringify(loaded.records()[0])}\n`);
  expect(await listRuns(store)).toEqual(["run-1"]);
  const second = loaded.append(input);
  const end = { stop: "interrupted", reason: "a creature appeared", commands: 2, refused: 1, hpBefore: 20, hpAfter: 14 } as const;
  loaded.attachOutcome(second, "interrupted, 2 commands, 1 refused, hp -6", end);
  expect(loaded.records()[1]?.result).toEqual(end);
  await deleteRun(store, "run-1");
  expect(await listRuns(store)).toEqual([]);
});

it("keeps the newest 20,000 records and removes old chunks", async () => {
  const store = memoryStore();
  const log = createDecisionLog(store, "long-run");
  for (let i = 0; i < 20_001; i++) log.append(input);
  await log.flush();
  expect(log.records()).toHaveLength(19_801);
  expect(log.records()[0]?.seq).toBe(200);
  expect(await store.keys("squire/log/long-run/")).toHaveLength(100);
  const loaded = createDecisionLog(store, "long-run");
  await loaded.load();
  expect(loaded.records()[0]?.seq).toBe(200);
  for (let i = 0; i < 199; i++) log.append(input);
  await log.flush();
  expect(log.records()).toHaveLength(20_000);
});
