import { describe, expect, it, vi } from "vitest";
import { world } from "../harness.js";
import type { AgentActions } from "@rpgm-tools/neo-angband-core";
import type { NetLike } from "../brain/backend.js";
import { createTally } from "../brain/tally.js";
import { CONFIG_FORMAT, defaultConfig, readConfig, writeConfig } from "../config.js";
import { memoryStore } from "../memory/kv.js";
import { defaultPersona } from "../persona/persona.js";
import { createRuntime } from "../runtime.js";
import { defaultCfg } from "../settings.js";
import type { Terrain } from "../terrain.js";
import { createOrders } from "./book.js";
import { CHANNEL_POLL_MS, CHANNEL_RETRY_MS, MAX_PAGES, createChannelPoller, readChannelOrders, readChannelReply, type ChannelOrder } from "./channel.js";
import { queueInstruction } from "./input.js";
import { orderLines } from "./panel.js";
import { readInstructions } from "./read.js";

const URL = "http://127.0.0.1:8765/v1/orders";

type Reply = Awaited<ReturnType<NetLike["request"]>>;

function stubNet(replies: Reply[] | (() => Promise<Reply>)): NetLike & { calls: { url: string; method?: string }[] } {
  const calls: { url: string; method?: string }[] = [];
  return {
    transport: "page",
    calls,
    request(request) {
      calls.push({ url: request.url, ...(request.method === undefined ? {} : { method: request.method }) });
      if (typeof replies === "function") return replies();
      const next = replies.shift();
      return next === undefined ? Promise.resolve({ ok: true, status: 200, headers: {}, body: "[]" }) : Promise.resolve(next);
    },
  };
}

const ok = (body: unknown): Reply => ({ ok: true, status: 200, headers: {}, body: JSON.stringify(body) });

function poller(net: NetLike | null, url = URL) {
  let clock = 1_000;
  const queued: ChannelOrder[] = [];
  const logs: string[] = [];
  const p = createChannelPoller({ url: () => url, net: () => net, queue: (o) => queued.push(o), log: (m) => logs.push(m), now: () => clock });
  return { p, queued, logs, advance: (ms: number) => { clock += ms; } };
}

function book() {
  const notes: string[] = [];
  const orders = createOrders({
    backend: () => null,
    send: () => Promise.reject(new Error("no model")),
    tally: createTally({ perSessionUsd: 0, perDayUsd: 0 }),
    now: () => 0,
    persona: () => defaultPersona("T"),
    setPersona: () => {},
    kept: () => 50,
    note: (text) => { notes.push(text); },
    log: () => {},
    save: () => {},
    rng: () => 0.5,
  });
  return { orders, notes };
}

describe("collecting viewer orders", () => {
  it("polls the address with GET and passes each order on, then waits a few seconds", async () => {
    const net = stubNet([ok([{ text: "run from uniques", platform: "twitch", user: "Grip", at: "2026-09-30T12:00:00Z" }, { text: "keep two flasks of oil", platform: "discord", user: "fang", at: "2026-09-30T12:00:01Z" }])]);
    const { p, queued, advance } = poller(net);
    p.tick();
    await p.settled();
    expect(net.calls).toEqual([{ url: URL, method: "GET" }]);
    expect(queued).toEqual([
      { text: "run from uniques", viewer: "Grip", platform: "twitch" },
      { text: "keep two flasks of oil", viewer: "fang", platform: "discord" },
    ]);
    p.tick();
    advance(CHANNEL_POLL_MS - 1);
    p.tick();
    expect(net.calls).toHaveLength(1);
    advance(1);
    p.tick();
    await p.settled();
    expect(net.calls).toHaveLength(2);
  });

  it("asks one collection at a time", async () => {
    let release: (r: Reply) => void = () => {};
    const net = stubNet(() => new Promise<Reply>((resolve) => { release = resolve; }));
    const { p, advance } = poller(net);
    p.tick();
    advance(CHANNEL_POLL_MS * 3);
    p.tick();
    expect(net.calls).toHaveLength(1);
    release(ok([]));
    await p.settled();
  });

  it("does not poll without an address or without a way to send", async () => {
    const net = stubNet([]);
    const none = poller(net, "  ");
    none.p.tick();
    await none.p.settled();
    expect(net.calls).toHaveLength(0);
    const old = poller(null);
    old.p.tick();
    await old.p.settled();
    expect(old.logs).toEqual([]);
  });

  it("logs a failed poll once, never throws, and tries again later", async () => {
    const net = stubNet([
      { ok: false, code: "unreachable", problem: "connection refused" },
      { ok: true, status: 502, headers: {}, body: "" },
      { ok: true, status: 200, headers: {}, body: "not json" },
      ok([{ text: "rest when wounded", platform: "twitch", user: "Grip" }]),
    ]);
    const { p, queued, logs, advance } = poller(net);
    p.tick();
    await p.settled();
    expect(logs).toEqual([`Squire couldn't collect viewer orders from ${URL}: connection refused. It will try again in 30 seconds.`]);
    advance(CHANNEL_POLL_MS);
    p.tick();
    expect(net.calls).toHaveLength(1);
    for (let i = 0; i < 2; i += 1) {
      advance(CHANNEL_RETRY_MS);
      p.tick();
      await p.settled();
    }
    expect(net.calls).toHaveLength(3);
    expect(logs).toHaveLength(1);
    advance(CHANNEL_RETRY_MS);
    p.tick();
    await p.settled();
    expect(queued).toEqual([{ text: "rest when wounded", viewer: "Grip", platform: "twitch" }]);
    expect(logs.at(-1)).toBe("Squire is collecting viewer orders again.");
  });

  it("survives a request that throws", async () => {
    const net = stubNet(() => Promise.reject(new Error("boom")));
    const { p, logs } = poller(net);
    expect(() => p.tick()).not.toThrow();
    await p.settled();
    expect(logs).toEqual([`Squire couldn't collect viewer orders from ${URL}: boom. It will try again in 30 seconds.`]);
  });

  it("reads only well-formed orders and caps their length", () => {
    expect(readChannelOrders("{}")).toBeNull();
    const read = readChannelOrders(JSON.stringify([null, 7, { text: "  " }, { text: `run\n${"x".repeat(400)}`, user: "Grip\u0007", platform: "twitch" }, { text: "rest" }]));
    expect(read).toHaveLength(2);
    expect(read?.[0]?.text).toHaveLength(300);
    expect(read?.[0]?.text.startsWith("run x")).toBe(true);
    expect(read?.[0]?.viewer).toBe("Grip");
    expect(read?.[1]).toEqual({ text: "rest", viewer: "", platform: "" });
  });

  it("reads the paged reply shape as well as the bare list", () => {
    expect(readChannelReply(JSON.stringify([{ text: "rest" }]))).toEqual({ orders: [{ text: "rest", viewer: "", platform: "" }], more: false });
    expect(readChannelReply(JSON.stringify({ orders: [{ text: "rest", user: "Grip" }], more: true }))).toEqual({ orders: [{ text: "rest", viewer: "Grip", platform: "" }], more: true });
    expect(readChannelReply(JSON.stringify({ orders: [], more: "yes" }))).toEqual({ orders: [], more: false });
    expect(readChannelReply(JSON.stringify({ more: true }))).toBeNull();
  });

  it("keeps collecting while the channel says more are waiting", async () => {
    const net = stubNet([
      ok({ orders: [{ text: "one", user: "a" }], more: true }),
      ok({ orders: [{ text: "two", user: "b" }], more: true }),
      ok({ orders: [{ text: "three", user: "c" }], more: false }),
    ]);
    const { p, queued } = poller(net);
    p.tick();
    await p.settled();
    expect(net.calls).toHaveLength(3);
    expect(queued.map((o) => o.text)).toEqual(["one", "two", "three"]);
  });

  it("stops at the page bound and collects again at the next tick", async () => {
    const net = stubNet(() => Promise.resolve(ok({ orders: [{ text: "again" }], more: true })));
    const { p, queued } = poller(net);
    p.tick();
    await p.settled();
    expect(net.calls).toHaveLength(MAX_PAGES);
    expect(queued).toHaveLength(MAX_PAGES);
    p.tick();
    await p.settled();
    expect(net.calls).toHaveLength(MAX_PAGES * 2);
  });

  it("drops a collection that started before a reset", async () => {
    let release: (r: Reply) => void = () => {};
    const net = stubNet(() => new Promise<Reply>((resolve) => { release = resolve; }));
    const { p, queued } = poller(net);
    p.tick();
    p.reset();
    release(ok([{ text: "old character's order", user: "Grip" }]));
    await p.settled();
    expect(queued).toEqual([]);
  });

  it("asks for one batched sort after a collection that queued orders", async () => {
    const net = stubNet([ok([{ text: "one" }, { text: "two" }]), ok([])]);
    let clock = 1_000;
    let flushes = 0;
    const p = createChannelPoller({ url: () => URL, net: () => net, queue: () => {}, flush: () => { flushes += 1; }, log: () => {}, now: () => clock });
    p.tick();
    await p.settled();
    expect(flushes).toBe(1);
    clock += CHANNEL_POLL_MS;
    p.tick();
    await p.settled();
    expect(flushes).toBe(1);
  });
});

describe("a viewer's instruction", () => {
  it("keeps the channel source and the viewer's name, and says who gave it", () => {
    const { orders, notes } = book();
    const r = queueInstruction(orders, "run from uniques", "channel", { viewer: "Grip" });
    if (!r.ok) throw new Error("not taken");
    expect(r.instruction.source).toBe("channel");
    expect(r.instruction.viewer).toBe("Grip");
    expect(notes).toEqual([`New ${r.instruction.kind === "order" ? "order" : "standing instruction"} from viewer Grip: run from uniques`]);
    expect(orderLines(orders.list())[0]).toContain(" from viewer Grip: run from uniques [");
    expect(readInstructions(JSON.parse(JSON.stringify(orders.list())))[0]?.viewer).toBe("Grip");
  });

  it("names nobody for an instruction from the panel", () => {
    const { orders, notes } = book();
    const r = queueInstruction(orders, "Reach 500 ft", "panel");
    if (!r.ok) throw new Error("not taken");
    expect("viewer" in r.instruction).toBe(false);
    expect(notes[0]).toBe("New order: Reach 500 ft");
    expect(readInstructions([{ ...r.instruction, viewer: "   " }])[0]).not.toHaveProperty("viewer");
  });
});

describe("the channel address setting", () => {
  it("is empty by default and survives a save", () => {
    expect(defaultConfig().channelUrl).toBe("");
    expect(readConfig(writeConfig({ ...defaultConfig(), channelUrl: URL })).channelUrl).toBe(URL);
    expect(readConfig({ format: CONFIG_FORMAT, data: { channelUrl: 5 } }).channelUrl).toBe("");
  });
});

describe("polling while Squire plays", () => {
  function host(channelUrl: string, net: NetLike) {
    const prefs = writeConfig({ ...defaultConfig(), backend: "none", channelUrl });
    return { log: () => {}, prefs: { get: () => prefs, set: () => {} }, net: net as NetLike & { secrets: never } };
  }

  it("queues a viewer's order as a channel instruction once the controller runs", async () => {
    const net = stubNet([ok([{ text: "run from uniques", platform: "twitch", user: "Grip" }])]);
    const rt = createRuntime(host(URL, net), { store: memoryStore() });
    expect(net.calls).toHaveLength(0);
    const w = world({ map: ["###", "#@#", "###"] });
    const controller = rt.controllerFor(defaultCfg(), w.terrain, () => () => null);
    controller(w.view, w.act);
    await vi.waitFor(() => expect(rt.orders().list()).toHaveLength(1));
    expect(rt.orders().list()[0]).toMatchObject({ text: "run from uniques", source: "channel", viewer: "Grip" });
  });

  it("asks nothing with no address", async () => {
    const net = stubNet([]);
    const rt = createRuntime(host("", net), { store: memoryStore() });
    const w = world({ map: ["###", "#@#", "###"] });
    const controller = rt.controllerFor(defaultCfg(), w.terrain, () => () => null);
    controller(w.view, w.act);
    await Promise.resolve();
    expect(net.calls).toHaveLength(0);
  });
});
