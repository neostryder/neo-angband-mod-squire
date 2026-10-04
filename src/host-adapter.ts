/**
 * Squire reads the game's live state, the engine's view builder, the composed records and the input snapshot here and nowhere else.
 *
 * Mod API 2 takes most of these away from Squire: it gets `view` (the known world) and `content.records` instead, and never `core`, `state` or a raw input snapshot. Each function here is named after the API 2 call that replaces it (`viewWorld` for `view.world()`), and host-adapter-api2.ts implements the same functions over API 2, so moving to API 2 changes the entry point's imports and nothing else. A test fails when any other source file reads those context members.
 *
 * The decision code imports the agent view types from here too, so the view
 * vocabulary it is written against has one source.
 */

import type { AgentView, InputSnapshot, ModPluginContext } from "@rpgm-tools/neo-angband-core";
import { terrainFromRecords, terrainRecords, type Terrain } from "./terrain.js";

export type {
  AgentActions,
  AgentCommand,
  AgentController,
  AgentView,
  CellView,
  CommandFacade,
  ItemView,
  KnownFloorItemView,
  LoadoutSimulation,
  LoadoutView,
  MonsterView,
  PlayerStatusView,
  PlayerView,
  SpellView,
  StoreView,
} from "@rpgm-tools/neo-angband-core";

type CoreNamespace = ModPluginContext["core"];

/** The plugin context members only this file reads. */
export interface HostReads {
  readonly core?: Partial<Pick<CoreNamespace, "createAgentView">>;
  readonly state?: ModPluginContext["state"];
  readonly composedRecords?: ModPluginContext["composedRecords"];
  readonly snapshot?: () => InputSnapshot | null;
  readonly options?: Pick<NonNullable<ModPluginContext["options"]>, "get">;
}

/** What the input snapshot still carries under API 2: the token, the driver, the phase, any pending message and the open prompt. */
export type HostInput = Pick<InputSnapshot, "token" | "driver" | "phase" | "messagePending" | "prompt">;

/**
 * The game as the player knows it, for `view.world()`. The pack and the worn
 * gear come from the input snapshot, whose items carry the names the
 * inventory shows.
 */
export function viewWorld(host: Pick<HostReads, "core" | "state" | "snapshot">): AgentView | null {
  const make = host.core?.createAgentView;
  if (make === undefined || host.state === undefined) return null;
  const base = make(host.state);
  const snap = host.snapshot?.();
  const inventory = [...(snap?.core.inventory ?? [])];
  const equipment = [...(snap?.core.equipment ?? [])];
  return { ...base, inventory: () => inventory, equipment: () => equipment };
}

/** The current input wait, for `view.input()`. */
export function viewInput(host: Pick<HostReads, "snapshot">): HostInput | null {
  return host.snapshot?.() ?? null;
}

/** Terrain sorted by what an errand does with it, for `content.records("terrain")`, read from the composed terrain records. Without them, nothing is classified. */
export function contentTerrain(host: Pick<HostReads, "composedRecords">): Terrain {
  const records = host.composedRecords?.["terrain"];
  return terrainFromRecords(records === undefined ? null : terrainRecords(records));
}

/**
 * NOSCORE_BORG (player.h). Mirrors core's NOSCORE.BORG; kept local so the mod
 * does not need a core import for one bit.
 *
 * The bit is not about any particular autoplayer. It records that this character
 * was handed to one at some point, which is what the score gate reads at death,
 * and Squire earns it on exactly the same terms as any other.
 */
const NOSCORE_BORG = 0x0020;

/** Whether the save carries the autoplayer mark. API 2 has no counterpart. */
export function autoplayedBefore(host: { readonly state?: { readonly actor?: { readonly player?: { readonly noscore?: number } } } }): boolean {
  const noscore = host.state?.actor?.player?.noscore ?? 0;
  return (noscore & NOSCORE_BORG) !== 0;
}

/** The birth options as the options screen lists them. API 2 has no counterpart. */
export function birthOptions(host: Pick<HostReads, "options">): ReturnType<NonNullable<HostReads["options"]>["get"]>["entries"] {
  return host.options?.get().entries.filter((entry) => entry.page === "birth") ?? [];
}
