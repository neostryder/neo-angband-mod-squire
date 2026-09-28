import { expect, it, vi } from "vitest";
import type { NetLike } from "../brain/backend.js";
import { memoryStore } from "../memory/kv.js";
import type { Batch } from "./batch.js";
import { createSender } from "./sender.js";

const batch: Batch = {
  schema: 1, level: "summary", install_id: "3f2b8c1e-4d5a-4b6c-9d7e-0a1b2c3d4e5f", run_id: "run-1",
  seq: 0, sent_at: "2026-09-27T20:00:00Z", mod_version: "0.2.0", game_version: "0.22.0",
  summary: {
    persona: { name: "Beren", race: "Human", class: "Warrior" },
    outcome: { ended: false, won: false, depth_max: 1, turns: 1, cause_of_death: null },
    top_kills: [], tokens: { input: 1, output: 1, calls: 1 }, calibration: {},
  },
};

function net(status: number, response: object, headers: Record<string, string> = {}): NetLike {
  return { transport: "page", async request() { return { ok: true, status, headers, body: JSON.stringify(response) }; } };
}

function sender(network: NetLike, store = memoryStore(), sleep = vi.fn(async (_ms: number) => {})) {
  const log = vi.fn();
  return { client: createSender({ net: network, store, endpoint: "https://example.test", now: () => 100, log, sleep }), store, sleep, log };
}

it("accepts a duplicate response and returns its chronicle", async () => {
  const chronicle = {
    run_id: "run-1", status: "waiting", flagged: null, category: null,
    review: null, decision: null, message: "Your run is waiting. Check again later.",
  };
  const { client, store } = sender(net(200, { ok: true, duplicate: true, chronicle }));
  expect(await client.send(batch)).toEqual({ ok: true, duplicate: true, chronicle });
  expect(await store.keys("squire/telemetry/queue/")).toEqual([]);
});

it("waits for Retry-After on 429", async () => {
  let calls = 0;
  const network: NetLike = {
    transport: "page",
    async request() {
      calls++;
      return calls === 1
        ? { ok: true, status: 429, headers: { "Retry-After": "7" }, body: JSON.stringify({ ok: false, error: "Slow down." }) }
        : { ok: true, status: 202, headers: {}, body: JSON.stringify({ ok: true }) };
    },
  };
  const { client, sleep } = sender(network);
  expect((await client.send(batch)).ok).toBe(true);
  expect(sleep).toHaveBeenCalledWith(7000);
  expect(calls).toBe(2);
});

it("drops a 400 with its field in the log", async () => {
  const { client, store, log } = sender(net(400, { ok: false, field: "summary.tokens.input", error: "must be positive" }));
  expect(await client.send(batch)).toEqual({ ok: false, queued: false, field: "summary.tokens.input", reason: "must be positive" });
  expect(log.mock.calls[0]?.[0]).toContain("summary.tokens.input");
  expect(await store.keys("squire/telemetry/queue/")).toEqual([]);
});

it("drops an oversized batch after a 413", async () => {
  const { client, store, log } = sender(net(413, { ok: false, error: "Too large." }));
  expect(await client.send(batch)).toEqual({ ok: false, queued: false, field: "batch", reason: "Too large." });
  expect(log.mock.calls[0]?.[0]).toContain("batch");
  expect(await store.keys("squire/telemetry/queue/")).toEqual([]);
});

it("recovers a queued batch through a new sender", async () => {
  const store = memoryStore();
  const first = sender(net(503, { ok: false, error: "unavailable" }), store);
  expect(await first.client.send(batch)).toMatchObject({ ok: false, queued: true });
  expect(first.sleep.mock.calls.map(([ms]) => ms)).toEqual([1000, 4000, 15000, 60000]);
  expect(await store.keys("squire/telemetry/queue/")).toHaveLength(1);
  const second = sender(net(202, { ok: true }), store);
  await second.client.drain();
  expect(await store.keys("squire/telemetry/queue/")).toEqual([]);
});

it("uses GET and DELETE for an install", async () => {
  const methods: string[] = [];
  const network: NetLike = {
    transport: "page",
    async request(request) {
      methods.push(request.method ?? "");
      return { ok: true, status: 200, headers: {}, body: JSON.stringify({ ok: true, chronicle: [] }) };
    },
  };
  const { client } = sender(network);
  expect((await client.status(batch.install_id)).ok).toBe(true);
  expect((await client.deleteInstall(batch.install_id)).ok).toBe(true);
  expect(methods).toEqual(["GET", "DELETE"]);
});

it("sends nothing with an empty endpoint", async () => {
  const store = memoryStore();
  const request = vi.fn();
  const client = createSender({ net: { transport: "page", request }, store, endpoint: "", now: () => 1, log: vi.fn() });
  expect(await client.send(batch)).toMatchObject({ ok: false, queued: false });
  expect(request).not.toHaveBeenCalled();
  expect(await store.keys("squire/telemetry/queue/")).toEqual([]);
});
