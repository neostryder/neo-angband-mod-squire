import { describe, expect, it } from "vitest";
import type { Runtime } from "../runtime.js";
import { ORDER_COMMAND, ORDER_KEYS, ORDER_VERB, registerOrderCommand, type OrderCommandCtx } from "./order-command.js";

const rt = {} as unknown as Runtime;
const done = <T,>(value: T) => Promise.resolve({ ok: true as const, value });

function rig(taken: readonly string[] = []) {
  const registered: string[] = [];
  const verbs: Record<string, string> = {};
  const bound: Record<string, string> = {};
  const logs: string[] = [];
  const ctx = {
    panels: { openPanel: () => { throw new Error("no document"); } },
    commands: { register: (code: string, verb: string) => { registered.push(code); verbs[code] = verb; return done(null); } },
    keys: {
      set: (trigger: string, action: string) => {
        if (taken.includes(trigger)) return Promise.resolve({ ok: false as const, reason: "refused" as const, code: "taken", message: "That key is taken." });
        bound[trigger] = action;
        return done(null);
      },
    },
    log: (m: string) => { logs.push(m); },
  } satisfies OrderCommandCtx;
  return { ctx, registered, verbs, bound, logs };
}

describe("the order command", () => {
  it("registers a command with a verb and binds the first free key", async () => {
    const r = rig();
    expect(await registerOrderCommand(r.ctx, rt)).toBe(ORDER_KEYS[0]);
    expect(r.registered).toEqual([ORDER_COMMAND]);
    expect(r.verbs[ORDER_COMMAND]).toBe(ORDER_VERB);
    expect(r.bound).toEqual({ [ORDER_KEYS[0]!]: ORDER_COMMAND });
  });

  it("falls to the next key when one is taken, and to none when all are", async () => {
    expect(await registerOrderCommand(rig([ORDER_KEYS[0]!]).ctx, rt)).toBe(ORDER_KEYS[1]);
    const all = rig(ORDER_KEYS);
    expect(await registerOrderCommand(all.ctx, rt)).toBeNull();
    expect(all.registered).toEqual([ORDER_COMMAND]);
  });

  it("registers nothing without the command registry or the panel API, and binds no key without key access", async () => {
    const r = rig();
    const { commands: _c, ...noCommands } = r.ctx;
    expect(await registerOrderCommand(noCommands, rt)).toBeNull();
    const { panels: _p, ...noPanels } = r.ctx;
    expect(await registerOrderCommand(noPanels, rt)).toBeNull();
    expect(r.registered).toEqual([]);
    const { keys: _k, ...noKeys } = r.ctx;
    expect(await registerOrderCommand(noKeys, rt)).toBeNull();
    expect(r.registered).toEqual([ORDER_COMMAND]);
  });
});
