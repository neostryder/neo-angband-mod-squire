import { expect, it, vi } from "vitest";
import type { NetLike } from "../brain/backend.js";
import { memoryStore } from "../memory/kv.js";
import { createRuntime, type RunReportLike } from "../runtime.js";
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

it("deletes the persistent queue across senders and sends only a new batch afterwards", async () => {
  const store = memoryStore();
  await sender(net(503, { ok: false }), store).client.send(batch);
  const posted: string[] = [];
  const network: NetLike = {
    transport: "page",
    async request(request) {
      if (request.method === "POST") posted.push((JSON.parse(request.body ?? "{}") as Batch).run_id);
      return { ok: true, status: request.method === "DELETE" ? 200 : 202, headers: {}, body: JSON.stringify({ ok: true }) };
    },
  };
  expect((await sender(network, store).client.deleteInstall(batch.install_id)).ok).toBe(true);
  expect(await store.keys("squire/telemetry/queue/")).toEqual([]);
  const resumed = sender(network, store).client;
  await resumed.drain();
  expect(posted).toEqual([]);
  expect((await resumed.send({ ...batch, run_id: "run-2" })).ok).toBe(true);
  expect(posted).toEqual(["run-2"]);
});

it("cancels an older sender's retry and queued sends before deleting server records", async () => {
  let retryStarted = () => {};
  const retry = new Promise<void>((resolve) => { retryStarted = resolve; });
  const methods: string[] = [];
  const network: NetLike = {
    transport: "page",
    async request(request) {
      methods.push(request.method ?? "");
      return { ok: true, status: request.method === "POST" ? 503 : 200, headers: {}, body: JSON.stringify({ ok: true }) };
    },
  };
  const store = memoryStore();
  const old = sender(network, store, vi.fn((_ms: number) => { retryStarted(); return new Promise<void>(() => {}); })).client;
  const sending = old.send(batch);
  const waiting = old.send({ ...batch, run_id: "run-2" });
  await retry;
  expect((await sender(network, store).client.deleteInstall(batch.install_id)).ok).toBe(true);
  expect(await sending).toMatchObject({ ok: false, queued: false });
  expect(await waiting).toMatchObject({ ok: false, queued: false });
  await old.drain();
  expect(methods).toEqual(["POST", "DELETE"]);
  expect(await store.keys("squire/telemetry/queue/")).toEqual([]);
});

it("waits for an in-flight upload before DELETE and preserves a new send made during deletion", async () => {
  let started = () => {};
  const uploading = new Promise<void>((resolve) => { started = resolve; });
  let finish = () => {};
  const flight = new Promise<void>((resolve) => { finish = resolve; });
  const methods: string[] = [];
  const network: NetLike = {
    transport: "page",
    async request(request) {
      methods.push(request.method ?? "");
      if (methods.length === 1) { started(); await flight; }
      return { ok: true, status: request.method === "DELETE" ? 200 : 202, headers: {}, body: JSON.stringify({ ok: true }) };
    },
  };
  const { client, store } = sender(network);
  const old = client.send(batch);
  await uploading;
  const deletion = sender(network, store).client.deleteInstall(batch.install_id);
  const fresh = client.send({ ...batch, run_id: "run-2" });
  expect(methods).toEqual(["POST"]);
  finish();
  expect(await old).toMatchObject({ ok: false, queued: false });
  expect((await deletion).ok).toBe(true);
  expect((await fresh).ok).toBe(true);
  expect(methods).toEqual(["POST", "DELETE", "POST"]);
});

it("clears queued uploads even when the server rejects deletion", async () => {
  const store = memoryStore();
  await store.set("squire/telemetry/queue/old", batch);
  const { client } = sender(net(500, { ok: false }), store);
  expect((await client.deleteInstall(batch.install_id)).ok).toBe(false);
  expect(await store.keys("squire/telemetry/queue/")).toEqual([]);
});

it("discards remaining chunks of a run recorded before deletion", async () => {
  const request = vi.fn(net(200, { ok: true }).request);
  const { client, store } = sender({ transport: "page", request });
  expect((await client.send(batch)).ok).toBe(true);
  expect((await sender({ transport: "page", request }, store).client.deleteInstall(batch.install_id)).ok).toBe(true);
  expect(await client.send({ ...batch, seq: 1 })).toMatchObject({ ok: false, queued: false });
  expect((await client.send({ ...batch, run_id: "run-2" })).ok).toBe(true);
  expect(request.mock.calls.map(([req]) => req.method)).toEqual(["POST", "DELETE", "POST"]);
});

it("keeps an empty endpoint disabled for new batches after clearing the queue", async () => {
  const store = memoryStore();
  await store.set("squire/telemetry/queue/old", batch);
  const request = vi.fn();
  const client = createSender({ net: { transport: "page", request }, store, endpoint: "", now: () => 1, log: vi.fn() });
  expect((await client.deleteInstall(batch.install_id)).ok).toBe(false);
  expect(await store.keys("squire/telemetry/queue/")).toEqual([]);
  expect(await client.send({ ...batch, run_id: "run-2" })).toMatchObject({ ok: false, queued: false });
  expect(request).not.toHaveBeenCalled();
});

it.each(["off", "summary"] as const)("keeps consent %s for a new finished run after deletion", async (level) => {
  const store = memoryStore();
  await store.set("squire/telemetry/queue/old", batch);
  const request = vi.fn(net(200, { ok: true }).request);
  let ended: ((report: RunReportLike) => void) | undefined;
  const rt = createRuntime({
    log: vi.fn(),
    net: { transport: "page", request, secrets: { storage: "page", async has() { return { present: false }; }, async fromEnv() { return { ok: false, problem: "unavailable" }; }, async set() { return { ok: true, storage: "page" }; }, async delete() { return { ok: true }; } } },
    character: { key: () => null, onRunEnd(listener) { ended = listener; return () => {}; } },
  }, { store });
  rt.saveConfig({ ...rt.config(), telemetry: { ...rt.config().telemetry, level, endpoint: "https://example.test" } });
  expect((await sender({ transport: "page", request }, store).client.deleteInstall(batch.install_id)).ok).toBe(true);
  ended!({ outcome: "winner", cause: "winning", key: null, name: "Beren", race: "Human", cls: "Warrior", level: 50, maxLevel: 50, maxDepth: 100, depth: 100, gold: 0, turn: 100, score: 0, scored: false, endedAt: 1, history: [], messages: [], belongings: [], sheet: null, birth: { name: "Beren", race: "Human", cls: "Warrior", stats: [] } });
  await vi.waitFor(async () => expect(await rt.lastSummary()).not.toBeNull());
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
  expect(rt.config().telemetry.level).toBe(level);
  const posted = request.mock.calls.filter(([req]) => req.method === "POST");
  expect(posted).toHaveLength(level === "off" ? 0 : 1);
  if (level === "summary") expect((JSON.parse(posted[0]![0].body ?? "{}") as Batch).run_id).toBe(rt.character().runId);
  expect(await store.keys("squire/telemetry/queue/")).toEqual([]);
});
