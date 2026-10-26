import { describe, expect, it } from "vitest";
import type { Api2Net } from "@rpgm-tools/neo-angband-mod-sdk";
import { netFromApi2 } from "./net.js";

const ok = <T,>(value: T) => Promise.resolve({ ok: true as const, value });

function fake() {
  const sent: unknown[] = [];
  const net = {
    request: (request: unknown) => { sent.push(request); return ok({ status: 200, headers: { a: "b" }, body: "{}" }); },
    credential: (name: string, prefix?: string) => (prefix === undefined ? { credential: name } : { credential: name, prefix }),
    credentials: {
      status: () => ok({ present: true, storage: "page" as const }),
      set: () => ok({ storage: "os" as const }),
      fromEnvironment: () => Promise.resolve({ ok: false as const, reason: "unavailable" as const, message: "Only the desktop app reads the environment." }),
      remove: () => ok(null),
    },
  } as unknown as Api2Net;
  return { net, sent };
}

describe("Squire's net over API 2", () => {
  it("turns a {secret:name} header into a credential reference with its prefix", async () => {
    const { net, sent } = fake();
    const reply = await netFromApi2(net).request({ url: "https://api.typesafe.ai/x", method: "POST", headers: { Authorization: "Bearer {secret:jev}", "Content-Type": "application/json" }, body: "{}", timeoutMs: 5 });
    expect(reply).toEqual({ ok: true, status: 200, headers: { a: "b" }, body: "{}" });
    expect(sent).toEqual([{ url: "https://api.typesafe.ai/x", method: "POST", headers: { Authorization: { credential: "jev", prefix: "Bearer " }, "Content-Type": "application/json" }, body: "{}", timeoutMs: 5 }]);
  });

  it("answers a refused request as a problem, not a throw", async () => {
    const { net } = fake();
    (net as { request: unknown }).request = () => Promise.resolve({ ok: false, reason: "refused", code: "secret-missing", message: "no key" });
    expect(await netFromApi2(net).request({ url: "https://x.test" })).toEqual({ ok: false, code: "secret-missing", problem: "no key" });
  });

  it("reports where the key lives and reads a refusal from the environment as a problem", async () => {
    const { net } = fake();
    const wrapped = netFromApi2(net);
    expect(wrapped.transport).toBe("relay");
    expect(await wrapped.secrets.has("jev")).toEqual({ present: true, storage: "page" });
    expect(wrapped.secrets.storage).toBe("page");
    expect(wrapped.transport).toBe("page");
    expect(await wrapped.secrets.fromEnv("jev", ["K"], { hosts: ["h"] })).toEqual({ ok: false, problem: "Only the desktop app reads the environment." });
    expect(await wrapped.secrets.set("jev", "v", { hosts: ["h"] })).toEqual({ ok: true, storage: "os" });
  });
});
