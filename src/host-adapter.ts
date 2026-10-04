/**
 * Every read Squire makes of the game's live state, its core namespace and its
 * bound registries, in one file.
 *
 * Mod API 2 takes these away from Squire: it gets `view` (the known world) and
 * `content.records` instead, and never `core`, `state`, `registries` or a raw
 * input snapshot. Each function here is named after the API 2 call that
 * replaces it (`viewWorld` for `view.world()`), so moving to API 2 changes this
 * file and the entry point and nothing else. A test fails when any other source
 * file reads those context members.
 *
 * The decision code imports the agent view types from here too, so the view
 * vocabulary it is written against has one source.
 */

import type { AgentView, InputSnapshot, ModPluginContext } from "@rpgm-tools/neo-angband-core";
import { noTerrain, readTerrain, type Terrain } from "./terrain.js";

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
  readonly core?: Partial<Pick<CoreNamespace, "createAgentView" | "TF" | "turnEnergy">>;
  readonly state?: ModPluginContext["state"];
  readonly registries?: Pick<NonNullable<ModPluginContext["registries"]>, "features">;
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

/**
 * Terrain sorted by what an errand does with it, read from the bound feature
 * registry. Under API 2 the terrain records supply it instead. Without the
 * registry or the flag numbers, nothing is classified.
 */
export function contentTerrain(host: Pick<HostReads, "core" | "registries">): Terrain {
  const features = host.registries?.features;
  const tf = host.core?.TF;
  if (features === undefined || tf === undefined) return noTerrain();
  return readTerrain(features.allFeatures(), tf);
}

/** How much energy a game turn gives at each speed, from the engine's own table. API 2 does not expose it. */
export function engineTurnEnergy(host: Pick<HostReads, "core">): CoreNamespace["turnEnergy"] | undefined {
  return host.core?.turnEnergy;
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
