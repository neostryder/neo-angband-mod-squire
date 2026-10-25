/**
 * What Squire's runtime reads from the game, built over the API 2 object.
 *
 * Squire's code is written against a small set of host members: stored
 * preferences and character data, the controller's status line, the run-end
 * report, the model server's net, the panel API and the world as an AgentView.
 * Under API 2 every one of them is an asynchronous call that answers with a
 * result, and the runtime wants a plain value now. The bridge keeps a copy of
 * each value it reads, fills the copies before the mod does any work (`prime`),
 * and writes a change through to the store as it is made. The world is read
 * fresh for each decision and kept for the handlers that need "the game as the
 * player last saw it" at once.
 */

import type { Api2CombatEvent, Api2CreateCharacter, Api2CommandEvent, Api2Driver, Api2InputState, Api2RunEndEvent, JsonValue, ModApi2 } from "@rpgm-tools/neo-angband-mod-sdk";
import type { AgentView, ModNet, RunReport } from "@rpgm-tools/neo-angband-core";
import { viewWorld, watchMessages, type MessageFeed } from "../host-adapter-api2.js";
import { netFromApi2 } from "./net.js";

type Panels = NonNullable<NonNullable<ModApi2["presentation"]>["panels"]>;

/** One birth option, as the brain reads it. */
export interface HostBirthOption {
  readonly name: string;
  readonly value: boolean;
}

/** What `saves.create` is asked to make. */
export type HostCreateCharacter = Api2CreateCharacter;

/** The members of the bridge that the runtime, the panel and the lessons use. */
export interface Api2Host {
  readonly log: (message: string) => void;
  readonly flags: Readonly<Record<string, boolean>>;
  readonly settings: { get(id: string): number | undefined };
  readonly prefs: { get(): unknown; set(value: unknown): void };
  readonly characterStore: { get(): unknown; set(value: unknown): void };
  readonly controller: {
    setStatus(status: { readonly label?: string; readonly reason?: string }): void;
    markNondeterministic(): void;
    release(reason: string): void;
  };
  readonly saves: { create(options: HostCreateCharacter): Promise<{ readonly ok: boolean; readonly reason?: string }> } | undefined;
  readonly character: { key(): string | null; onRunEnd(listener: (report: RunReport) => void): void };
  readonly net: ModNet | undefined;
  readonly snapshot: () => Api2InputState | null;
  readonly options: { get(): { readonly entries: readonly HostBirthOption[] } };
  readonly controllerArmed: boolean;
  readonly ui: Pick<Panels, "openPanel" | "registerPanelKind"> | undefined;
  readonly events: {
    on(name: "combat-outcome", listener: (payload: Api2CombatEvent) => void): void;
    on(name: "player-command", listener: (payload: Api2CommandEvent) => void): void;
  };
  /** The game as the player last saw it, read fresh for each decision. */
  readonly viewNow: () => AgentView | null;
}

export interface Bridge {
  readonly host: Api2Host;
  /** Read every stored value and the character's key, so the synchronous reads answer. */
  prime(): Promise<void>;
  /** Read the world once, keep it for `viewNow`, and answer it. */
  readWorld(): Promise<AgentView | null>;
  /** Record the input wait the controller was called at. */
  setInput(input: Api2InputState): void;
  /** Whether the character carries the autoplayer mark, as of the last read. */
  autoplayed(): boolean;
  /** Whether the keyboard is Squire's right now, as of the last event. */
  driver(): Api2Driver | null;
  dispose(): Promise<void>;
}

const unit = (): void => undefined;

export function createBridge(mod: ModApi2): Bridge {
  const log = (message: string): void => mod.meta.log(message);
  let settings: Readonly<Record<string, number>> = {};
  let prefs: unknown = null;
  let character: unknown = null;
  let key: string | null = null;
  let birth: readonly HostBirthOption[] = [];
  let input: Api2InputState | null = null;
  let driver: Api2Driver | null = null;
  let autoplayed = false;
  let world: AgentView | null = null;
  let feed: MessageFeed | null = null;
  const stops: (() => Promise<void>)[] = [];

  const kept = <T,>(call: Promise<{ readonly ok: boolean } & ({ readonly ok: true; readonly value: T } | object)>, onValue: (value: T) => void): Promise<void> =>
    call.then((result) => { if (result.ok) onValue((result as { value: T }).value); }, unit);

  const write = (slot: { set(value: JsonValue | null): Promise<{ readonly ok: boolean }> }, value: unknown, what: string): void => {
    void slot.set((value ?? null) as JsonValue | null).then((result) => { if (!result.ok) log(`Squire could not keep ${what}.`); }, () => log(`Squire could not keep ${what}.`));
  };

  const subscribe = <K extends "combat-outcome" | "player-command" | "run-end" | "driver-changed">(
    name: K,
    listener: (payload: K extends "combat-outcome" ? Api2CombatEvent : K extends "player-command" ? Api2CommandEvent : K extends "run-end" ? Api2RunEndEvent : Api2Driver) => void,
  ): void => {
    const call = mod.events.on(name, listener as never);
    void call.then((result) => {
      if (!result.ok) { log(`Squire is not told about ${name}: ${result.message}`); return; }
      stops.push(async () => { await mod.events.off(result.value); });
    }, unit);
  };

  const refreshCharacter = async (): Promise<void> => {
    await kept(mod.view.character(), (value) => { key = value.key; });
    await kept(mod.view.options(), (value) => { birth = Object.entries(value.birth).map(([name, on]) => ({ name, value: on })); });
    await kept(mod.view.player(), (value) => { autoplayed = value.autoplayed; });
  };

  const readWorld = async (): Promise<AgentView | null> => {
    const read = await viewWorld(mod, feed === null ? {} : { messages: feed });
    if (read !== null) world = read;
    return read;
  };

  const host: Api2Host = {
    log,
    flags: mod.meta.flags,
    settings: { get: (id) => settings[id] },
    prefs: { get: () => prefs, set: (value) => { prefs = value ?? null; write(mod.store.prefs, value, "its settings"); } },
    characterStore: { get: () => character, set: (value) => { character = value ?? null; write(mod.store.character, value, "this character's data"); } },
    controller: {
      setStatus: (status) => { void mod.act.controller.setStatus(status).catch(unit); },
      markNondeterministic: () => { void mod.act.controller.markNondeterministic().catch(unit); },
      release: (reason) => { void mod.act.controller.release(reason).catch(unit); },
    },
    saves: mod.manage === undefined ? undefined : {
      create: async (options) => {
        const result = await mod.manage!.saves.create(options);
        return result.ok ? { ok: true } : { ok: false, reason: result.message };
      },
    },
    character: {
      key: () => key,
      onRunEnd: (listener) => subscribe("run-end", (event) => { if (event.report !== null) listener(event.report); }),
    },
    net: mod.net === undefined ? undefined : netFromApi2(mod.net),
    snapshot: () => input,
    options: { get: () => ({ entries: birth }) },
    controllerArmed: mod.meta.controllerArmed,
    ui: mod.presentation?.panels,
    events: {
      on: ((name: "combat-outcome" | "player-command", listener: (payload: never) => void) => subscribe(name, listener as never)) as Api2Host["events"]["on"],
    },
    viewNow: () => world,
  };

  return {
    host,
    async prime() {
      await Promise.all([
        kept(mod.meta.settings(), (value) => { settings = value; }),
        kept(mod.store.prefs.get(), (value) => { prefs = value; }),
        kept(mod.store.character.get(), (value) => { character = value; }),
        refreshCharacter(),
      ]);
      feed = await watchMessages(mod);
      stops.push(() => feed?.stop() ?? Promise.resolve());
      subscribe("driver-changed", (event) => { driver = event; });
      await readWorld();
    },
    readWorld: async () => {
      const read = await readWorld();
      void refreshCharacter();
      return read;
    },
    setInput(next) { input = next; driver = next.driver; },
    autoplayed: () => autoplayed,
    driver: () => driver,
    async dispose() {
      for (const stop of stops.splice(0)) await stop().catch(unit);
    },
  };
}
