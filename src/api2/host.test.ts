import { describe, expect, it, vi } from "vitest";
import type { ModApi2 } from "@rpgm-tools/neo-angband-mod-sdk";
import { createBridge } from "./host.js";

const ok = <T,>(value: T) => Promise.resolve({ ok: true as const, value });
const refused = (message: string) => Promise.resolve({ ok: false as const, reason: "refused" as const, message });
const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

interface Rig {
  mod: ModApi2;
  logged: string[];
  prefsSet: unknown[];
  characterSet: unknown[];
  released: string[];
  statuses: unknown[];
  offs: unknown[];
  fire: (name: string, payload: unknown) => void;
}

function rig(over: { prefs?: () => ReturnType<typeof ok> | ReturnType<typeof refused>; withManage?: boolean } = {}): Rig {
  const logged: string[] = [];
  const prefsSet: unknown[] = [];
  const characterSet: unknown[] = [];
  const released: string[] = [];
  const statuses: unknown[] = [];
  const offs: unknown[] = [];
  const listeners = new Map<string, (payload: unknown) => void>();
  const mod = {
    meta: {
      log: (message: string) => logged.push(message),
      flags: { "squire.example": true },
      controllerArmed: true,
      settings: () => ok({ "squire.depth": 4 }),
    },
    store: {
      prefs: { get: over.prefs ?? (() => ok({ version: 1 })), set: (value: unknown) => { prefsSet.push(value); return ok(null); } },
      character: { get: () => ok({ goals: ["win"] }), set: (value: unknown) => { characterSet.push(value); return ok(null); } },
    },
    view: {
      world: () => ok({ player: null }),
      character: () => ok({ key: "hero-1" }),
      options: () => ok({ birth: { birth_connect_stairs: true, birth_force_descend: false } }),
      player: () => ok({ autoplayed: true }),
    },
    content: { records: () => ok([]) },
    events: {
      on: (name: string, listener: (payload: unknown) => void) => { listeners.set(name, listener); return ok({ id: name }); },
      off: (subscription: unknown) => { offs.push(subscription); return ok(null); },
    },
    act: {
      controller: {
        setStatus: (status: unknown) => { statuses.push(status); return Promise.resolve(); },
        markNondeterministic: () => Promise.resolve(),
        release: (reason: string) => { released.push(reason); return Promise.resolve(); },
      },
    },
    manage: over.withManage === false ? undefined : { saves: { create: () => refused("no room") } },
  } as unknown as ModApi2;
  return { mod, logged, prefsSet, characterSet, released, statuses, offs, fire: (name, payload) => listeners.get(name)?.(payload) };
}

describe("createBridge", () => {
  it("answers the synchronous reads from the values prime read", async () => {
    const r = rig();
    const bridge = createBridge(r.mod);
    expect(bridge.host.character.key()).toBeNull();
    expect(bridge.host.settings.get("squire.depth")).toBeUndefined();
    await bridge.prime();
    expect(bridge.host.character.key()).toBe("hero-1");
    expect(bridge.host.settings.get("squire.depth")).toBe(4);
    expect(bridge.host.prefs.get()).toEqual({ version: 1 });
    expect(bridge.host.characterStore.get()).toEqual({ goals: ["win"] });
    expect(bridge.host.options.get().entries).toEqual([
      { name: "birth_connect_stairs", value: true },
      { name: "birth_force_descend", value: false },
    ]);
    expect(bridge.autoplayed()).toBe(true);
    expect(bridge.host.controllerArmed).toBe(true);
    expect(bridge.host.flags["squire.example"]).toBe(true);
    await bridge.dispose();
  });

  it("keeps a value that failed to read as empty and does not throw", async () => {
    const r = rig({ prefs: () => refused("store offline") });
    const bridge = createBridge(r.mod);
    await bridge.prime();
    expect(bridge.host.prefs.get()).toBeNull();
    expect(bridge.host.character.key()).toBe("hero-1");
    await bridge.dispose();
  });

  it("writes a changed preference and character value through to the store and keeps the new copy", async () => {
    const r = rig();
    const bridge = createBridge(r.mod);
    await bridge.prime();
    bridge.host.prefs.set({ version: 2 });
    bridge.host.characterStore.set(undefined);
    await flush();
    expect(bridge.host.prefs.get()).toEqual({ version: 2 });
    expect(bridge.host.characterStore.get()).toBeNull();
    expect(r.prefsSet).toEqual([{ version: 2 }]);
    expect(r.characterSet).toEqual([null]);
    await bridge.dispose();
  });

  it("logs when a write is refused", async () => {
    const r = rig();
    (r.mod as unknown as { store: { prefs: { set: () => unknown } } }).store.prefs.set = () => Promise.resolve({ ok: false });
    const bridge = createBridge(r.mod);
    await bridge.prime();
    bridge.host.prefs.set({ version: 3 });
    await flush();
    expect(r.logged).toContain("Squire could not keep its settings.");
    await bridge.dispose();
  });

  it("passes the controller calls to act.controller", async () => {
    const r = rig();
    const bridge = createBridge(r.mod);
    bridge.host.controller.setStatus({ label: "Playing" });
    bridge.host.controller.release("done");
    await flush();
    expect(r.statuses).toEqual([{ label: "Playing" }]);
    expect(r.released).toEqual(["done"]);
  });

  it("reports saves.create through its result shape, and offers none without the manage domain", async () => {
    const withManage = createBridge(rig().mod);
    await expect(withManage.host.saves!.create({} as never)).resolves.toEqual({ ok: false, reason: "no room" });
    expect(createBridge(rig({ withManage: false }).mod).host.saves).toBeUndefined();
  });

  it("tells the run-end listener only when the event carries a report", async () => {
    const r = rig();
    const bridge = createBridge(r.mod);
    const heard = vi.fn();
    bridge.host.character.onRunEnd(heard);
    await flush();
    r.fire("run-end", { report: null });
    r.fire("run-end", { report: { turns: 9 } });
    expect(heard).toHaveBeenCalledTimes(1);
    expect(heard).toHaveBeenCalledWith({ turns: 9 });
    await bridge.dispose();
  });

  it("tracks the input wait and the driver, and ends every subscription on dispose", async () => {
    const r = rig();
    const bridge = createBridge(r.mod);
    await bridge.prime();
    expect(bridge.driver()).toBeNull();
    r.fire("driver-changed", "squire");
    expect(bridge.driver()).toBe("squire");
    bridge.setInput({ token: "t", phase: "play", prompt: null, driver: "player" } as never);
    expect(bridge.host.snapshot()?.token).toBe("t");
    expect(bridge.driver()).toBe("player");
    await bridge.dispose();
    expect(r.offs.length).toBeGreaterThan(0);
  });

  it("logs an event it could not subscribe to", async () => {
    const r = rig();
    (r.mod.events as unknown as { on: () => unknown }).on = () => refused("not granted");
    const bridge = createBridge(r.mod);
    bridge.host.events.on("combat-outcome", () => {});
    await flush();
    expect(r.logged).toContain("Squire is not told about combat-outcome: not granted");
  });
});
