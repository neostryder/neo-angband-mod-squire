import { describe, expect, it } from "vitest";
import type { Api2InputState, ModApi2 } from "@rpgm-tools/neo-angband-mod-sdk";
import type { AgentController } from "@rpgm-tools/neo-angband-core";
import type { Bridge } from "./host.js";
import { REFUSALS_BEFORE_RELEASE, createTick, promptAnswer } from "./controller.js";

const ok = <T,>(value: T) => Promise.resolve({ ok: true as const, value });
const refused = (message: string) => Promise.resolve({ ok: false as const, reason: "refused" as const, message });

interface Rig {
  mod: ModApi2;
  logged: string[];
  submitted: unknown[];
  answered: unknown[];
  released: string[];
}

function rig(accept: () => boolean = () => true): Rig {
  const logged: string[] = [];
  const submitted: unknown[] = [];
  const answered: unknown[] = [];
  const released: string[] = [];
  const mod = {
    meta: { log: (message: string) => logged.push(message) },
    act: {
      submit: (_token: unknown, intent: unknown) => { submitted.push(intent); return accept() ? ok(null) : refused("no"); },
      answer: (_id: number, answer: unknown) => { answered.push(answer); return ok(null); },
      controller: { release: (reason: string) => { released.push(reason); return ok(null); } },
    },
    view: { input: () => ok({ token: "fresh" }) },
  } as unknown as ModApi2;
  return { mod, logged, submitted, answered, released };
}

function bridge(world: "view" | null): Bridge {
  return { setInput: () => {}, readWorld: () => Promise.resolve(world === null ? null : ({} as never)) } as unknown as Bridge;
}

const input = (over: Partial<Api2InputState> = {}): Api2InputState => ({ token: "t", phase: "play", prompt: null, driver: null, ...over }) as unknown as Api2InputState;

describe("promptAnswer", () => {
  it("acknowledges a pager, confirms a yes/no, takes the default of a quantity or text, and cancels the rest", () => {
    expect(promptAnswer({ kind: "ack", promptId: 1, label: "-more-", tag: "more" })).toEqual({ action: "acknowledge" });
    expect(promptAnswer({ kind: "confirm", promptId: 1, label: "Sure?" })).toBe(true);
    expect(promptAnswer({ kind: "quantity", promptId: 1, label: "How many?", min: 1, max: 5, defaultValue: 2 })).toBe(2);
    expect(promptAnswer({ kind: "text", promptId: 1, label: "Name", maxLength: 9, defaultValue: "x" })).toBe("x");
    expect(promptAnswer({ kind: "direction", promptId: 1, label: "Which way?" } as never)).toEqual({ action: "cancel" });
  });
});

describe("the decision tick", () => {
  it("answers an open prompt and decides nothing", async () => {
    const r = rig();
    const tick = createTick(bridge("view"), () => ({ code: "hold" }) as never);
    await tick(r.mod, input({ prompt: { kind: "ack", promptId: 3, label: "-more-", tag: "more" } }));
    expect(r.answered).toEqual([{ action: "acknowledge" }]);
    expect(r.submitted).toEqual([]);
  });

  it("does nothing outside play and store, and without a world", async () => {
    const r = rig();
    await createTick(bridge("view"), () => ({ code: "hold" }) as never)(r.mod, input({ phase: "dead" as never }));
    await createTick(bridge(null), () => ({ code: "hold" }) as never)(r.mod, input());
    expect(r.submitted).toEqual([]);
  });

  it("submits the chosen command as an intent and says once that Squire is playing", async () => {
    const r = rig();
    const tick = createTick(bridge("view"), ((_view, act) => act.move(6)) as AgentController);
    await tick(r.mod, input());
    await tick(r.mod, input());
    expect(r.submitted).toEqual([
      { kind: "command", command: { code: "walk", dir: 6 } },
      { kind: "command", command: { code: "walk", dir: 6 } },
    ]);
    expect(r.logged.filter((line) => line === "Squire is playing.")).toHaveLength(1);
  });

  it("submits a target choice ahead of the command", async () => {
    const r = rig();
    const tick = createTick(bridge("view"), ((_view, act) => { act.setTargetMonster(4); return act.fire(2); }) as AgentController);
    await tick(r.mod, input());
    expect(r.submitted).toEqual([
      { kind: "target", midx: 4 },
      { kind: "command", command: { code: "fire", args: { handle: 2 } } },
    ]);
  });

  it("submits nothing when the decision is to wait", async () => {
    const r = rig();
    await createTick(bridge("view"), () => null)(r.mod, input());
    expect(r.submitted).toEqual([]);
  });

  it("gives the keyboard back after a run of refusals", async () => {
    const r = rig(() => false);
    const tick = createTick(bridge("view"), () => ({ code: "hold" }) as never);
    for (let i = 0; i < REFUSALS_BEFORE_RELEASE; i += 1) await tick(r.mod, input());
    expect(r.released).toHaveLength(1);
    expect(r.logged.some((line) => line.includes("was refused"))).toBe(true);
  });
});
