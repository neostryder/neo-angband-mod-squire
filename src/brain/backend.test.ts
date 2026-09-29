import { describe, expect, it } from "vitest";
import { ask, selfHosted, type NetLike, type ServerMemory } from "./backend.js";
import type { SystemOneRequest } from "./systemone.js";

const REQUEST: SystemOneRequest = {
  state: { situation: "a corridor" },
  questions: { goal: { type: "choice", instructions: "What next?", criteria: { explore: "Walk the floor.", none_of_these: null } } },
};

const GOOD_BODY = JSON.stringify({
  model: "laya",
  answers: { goal: { type: "choice", choice: "explore", confidence: 0.9, probabilities: { explore: 0.95, none_of_these: 0.05 } } },
  usage: { input_tokens: 700, output_tokens: 40 },
});

const PC = "http://192.168.2.100:8010/v1/systemone";
const BILBO = "http://192.168.2.154:8010/v1/systemone";

type Reply = Awaited<ReturnType<NetLike["request"]>>;

/** A fake network: each URL maps to the reply it gives, and every request is recorded. */
function fakeNet(routes: Record<string, Reply>): NetLike & { readonly calls: string[] } {
  const calls: string[] = [];
  return {
    transport: "relay",
    calls,
    async request(request) {
      calls.push(`${request.method ?? "GET"} ${request.url}`);
      return routes[`${request.method ?? "GET"} ${request.url}`] ?? { ok: false, code: "network", problem: "connection refused" };
    },
  };
}

const ok = (body: string): Reply => ({ ok: true, status: 200, headers: {}, body });
const status = (code: number): Reply => ({ ok: true, status: code, headers: {}, body: "" });
const now = () => 1000;

describe("server pool", () => {
  it("asks a single server directly, with no load check", async () => {
    const net = fakeNet({ [`POST ${PC}`]: ok(GOOD_BODY) });
    const result = await ask(net, selfHosted("laya", "Laya", PC), REQUEST, now, new Map());
    expect(result.ok && result.server).toBe(PC);
    expect(net.calls).toEqual([`POST ${PC}`]);
  });

  it("passes over a busy server and records which one answered", async () => {
    const net = fakeNet({
      "GET http://192.168.2.100:8010/load": ok(JSON.stringify({ busy: true, ready: true })),
      "GET http://192.168.2.154:8010/load": ok(JSON.stringify({ busy: false, ready: true })),
      [`POST ${BILBO}`]: ok(GOOD_BODY),
    });
    const memory: ServerMemory = new Map();
    const result = await ask(net, selfHosted("laya", "Laya", PC, undefined, [BILBO]), REQUEST, now, memory);
    expect(result.ok && result.server).toBe(BILBO);
    expect(memory.get(PC)?.reason).toBe("busy");
    expect(net.calls).not.toContain(`POST ${PC}`);
  });

  it("remembers a server that did not answer and skips it next time without checking", async () => {
    const net = fakeNet({
      "GET http://192.168.2.100:8010/load": status(404),
      "GET http://192.168.2.154:8010/load": status(404),
      [`POST ${BILBO}`]: ok(GOOD_BODY),
    });
    const memory: ServerMemory = new Map();
    const backend = selfHosted("laya", "Laya", PC, undefined, [BILBO]);
    expect((await ask(net, backend, REQUEST, now, memory)).ok).toBe(true);
    net.calls.length = 0;
    expect((await ask(net, backend, REQUEST, now, memory)).ok).toBe(true);
    expect(net.calls.some((c) => c.includes("192.168.2.100"))).toBe(false);
  });

  it("moves on from a server error, but never retries a refused request elsewhere", async () => {
    const busy = fakeNet({ "GET http://192.168.2.100:8010/load": status(404), [`POST ${PC}`]: status(503), "GET http://192.168.2.154:8010/load": status(404), [`POST ${BILBO}`]: ok(GOOD_BODY) });
    expect((await ask(busy, selfHosted("laya", "Laya", PC, undefined, [BILBO]), REQUEST, now, new Map())).ok).toBe(true);

    const refused = fakeNet({ "GET http://192.168.2.100:8010/load": status(404), [`POST ${PC}`]: status(400), [`POST ${BILBO}`]: ok(GOOD_BODY) });
    const result = await ask(refused, selfHosted("laya", "Laya", PC, undefined, [BILBO]), REQUEST, now, new Map());
    expect(result.ok).toBe(false);
    expect(refused.calls).not.toContain(`POST ${BILBO}`);
  });

  it("names every server it passed over when none could answer", async () => {
    const result = await ask(fakeNet({}), selfHosted("laya", "Laya", PC, undefined, [BILBO]), REQUEST, now, new Map());
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.failure.kind).toBe("unreachable");
      expect(result.failure.message).toContain(PC);
      expect(result.failure.message).toContain(BILBO);
    }
  });
});
