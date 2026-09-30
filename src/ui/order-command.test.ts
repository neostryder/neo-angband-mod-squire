import { describe, expect, it } from "vitest";
import type { Runtime } from "../runtime.js";
import { ORDER_COMMAND, ORDER_KEYS, ORDER_VERB, registerOrderCommand } from "./order-command.js";

const rt = {} as unknown as Runtime;

function rig(taken: readonly string[] = []) {
  const registered: string[] = [];
  const verbs: Record<string, string> = {};
  const bound: Record<string, string> = {};
  const logs: string[] = [];
  const host = { commands: { register: (code: string) => { registered.push(code); }, setVerb: (code: string, verb: string) => { verbs[code] = verb; } } };
  const ctx = {
    ui: { openPanel: () => { throw new Error("no document"); } },
    keymaps: { isBindableTriggerKey: (k: string) => k.length === 1, bind: (k: string, action: string) => { if (taken.includes(k)) return false; bound[k] = action; return true; } },
    log: (m: string) => { logs.push(m); },
  };
  return { host, ctx, registered, verbs, bound, logs };
}

describe("the order command", () => {
  it("registers a command with a verb and binds the first free key", () => {
    const r = rig();
    expect(registerOrderCommand(r.host, r.ctx, rt)).toBe(ORDER_KEYS[0]);
    expect(r.registered).toEqual([ORDER_COMMAND]);
    expect(r.verbs[ORDER_COMMAND]).toBe(ORDER_VERB);
    expect(r.bound).toEqual({ [ORDER_KEYS[0]!]: ORDER_COMMAND });
  });

  it("falls to the next key when one is taken, and to none when all are", () => {
    expect(registerOrderCommand(rig([ORDER_KEYS[0]!]).host, rig([ORDER_KEYS[0]!]).ctx, rt)).toBe(ORDER_KEYS[1]);
    const all = rig(ORDER_KEYS);
    expect(registerOrderCommand(all.host, all.ctx, rt)).toBeNull();
    expect(all.registered).toEqual([ORDER_COMMAND]);
  });

  it("registers nothing without the registry, the panel API or keymap access", () => {
    const r = rig();
    expect(registerOrderCommand({}, r.ctx, rt)).toBeNull();
    expect(registerOrderCommand(r.host, { keymaps: r.ctx.keymaps }, rt)).toBeNull();
    expect(r.registered).toEqual([]);
    const { keymaps: _k, ...noKeys } = r.ctx;
    expect(registerOrderCommand(r.host, noKeys, rt)).toBeNull();
    expect(r.registered).toEqual([ORDER_COMMAND]);
  });
});