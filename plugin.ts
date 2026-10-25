/**
 * Squire, as a mod's entry point.
 *
 * ------------------------------------------------------------------
 * WHAT SQUIRE IS
 * ------------------------------------------------------------------
 *
 * An alternative autoplayer. The distinction it exists to make: an autoplayer
 * plays the game, and Squire runs an errand and hands control back. Its stop
 * conditions are the feature rather than a safety net bolted onto one, and every
 * errand is written from its ending backwards.
 *
 * It adds nothing to the game's rules. Every decision it makes comes out as a
 * command a player could have typed, over the frozen perceive/act agent API that
 * any third-party agent uses, with no privileged access to the engine.
 *
 * ------------------------------------------------------------------
 * WHY THIS FILE IS SHORT
 * ------------------------------------------------------------------
 *
 * Its whole job is to satisfy the mod API: decide whether to offer to play at all, read the terrain classification out of the terrain records, fold the player's rule toggles into settings, and take a decision at each input wait. Everything that decides anything lives under src/.
 *
 * ------------------------------------------------------------------
 * WHY THIS DECLARES NO HOOKS AND REGISTERS NOTHING
 * ------------------------------------------------------------------
 *
 * Squire changes no rule, adds no record, and overrides no system. A mod whose
 * only decision-making member is `controller` is a complete mod, because
 * playing the game is not nothing.
 *
 * ------------------------------------------------------------------
 * ONE AUTOPLAYER AT A TIME
 * ------------------------------------------------------------------
 *
 * The host installs a single controller, so Squire and any other autoplayer mod
 * are alternatives rather than companions: enable both and the host refuses the
 * second by name and says which one is already playing. That is the correct
 * behaviour and not a conflict to work around - two things driving one character
 * is one thing driving it and one thing that believes it is.
 */

import type { Api2ControllerContext, Api2InputState, Api2ModDefinition, ModApi2 } from "@rpgm-tools/neo-angband-mod-sdk";
import { createSquire } from "./src/squire.js";
import { runtime, type Runtime } from "./src/runtime.js";
import { attachSquire } from "./src/attach.js";
import { registerOrderCommand } from "./src/ui/order-command.js";
import { registerSquireTitle } from "./src/title.js";
import { HEIR_KEY, rollOnPresenter, sessionMarks, takeRollOn } from "./src/birth.js";
import { cfgFromFlags, changedFrom } from "./src/settings.js";
import type { Terrain } from "./src/terrain.js";
import { contentTerrain } from "./src/host-adapter-api2.js";
import { createBridge, type Bridge } from "./src/api2/host.js";
import { createTick, type Tick } from "./src/api2/controller.js";

/** The autoplayer mark on a save (NOSCORE_BORG): this character was handed to an autoplayer at some point. */
const NOSCORE_BORG = 0x0020;

/**
 * Whether this character has already handed the keyboard to an autoplayer.
 *
 * Enabling a mod and giving away the keyboard are different decisions. The host
 * owns the second one: Ctrl-Z warns, confirms, marks the save and reloads. Squire
 * offers to play only once that permanent mark is set, so installing it does
 * nothing at all to a character until the player asks it to, and a character
 * that has run an autoplayer before is offered it again through the host's own
 * confirmation rather than silently.
 */
function characterAlreadyAutoplayed(context: Api2ControllerContext): boolean {
  const state = context.engine?.state as { readonly actor?: { readonly player?: { readonly noscore?: number } } } | undefined;
  return ((state?.actor?.player?.noscore ?? 0) & NOSCORE_BORG) !== 0;
}

/** What one running mod holds: the bridge to the game, the runtime built over it, and the decision tick. */
interface Running {
  readonly bridge: Bridge;
  readonly rt: Runtime;
  readonly tick: Tick;
  readonly detach: () => void;
}

let bridge: Bridge | undefined;
let running: Promise<Running | null> | undefined;

function bridgeFor(mod: ModApi2): Bridge {
  bridge ??= createBridge(mod);
  return bridge;
}

async function begin(mod: ModApi2): Promise<Running | null> {
  const made = bridgeFor(mod);
  await made.prime();
  const host = made.host;
  const cfg = cfgFromFlags(mod.meta.flags, host.settings);
  const terrain: Terrain = await contentTerrain(mod);
  host.log(
    terrain.size > 0
      ? `Squire is reading ${String(terrain.size)} terrain features`
      : "Squire has no terrain records: it will not take stairs or open doors",
  );
  const changed = changedFrom(cfg);
  host.log(
    changed.length === 0
      ? "Squire is on its stock settings"
      : `Squire's settings differ from stock: ${changed.join(", ")}`,
  );
  const rt = runtime(host);
  const attached = attachSquire(host, rt, terrain);
  const errands = () => createSquire({ cfg, terrain, log: host.log, status: (reason) => host.controller.setStatus({ label: "Errand ended", reason }), release: (reason: string) => host.controller.release(reason) }).controller;
  const tick = createTick(made, rt.controllerFor(cfg, terrain, errands));
  /* The in-game order key needs ui:commands and keymap:edit; without them the panel's own key still works. */
  void registerOrderCommand({ log: host.log, ...(mod.presentation?.panels ? { panels: mod.presentation.panels } : {}), commands: mod.ui.commands, ...(mod.manage ? { keys: mod.manage.keys } : {}) }, rt);
  /* The title row needs ui:title and profiles:manage; without both there is no row. */
  registerSquireTitle({ id: mod.meta.id, ...(mod.presentation?.title ? { title: mod.presentation.title } : {}), ...(mod.manage ? { profiles: mod.manage.profiles } : {}) }, rt.store());
  return { bridge: made, rt, tick, detach: attached.detach };
}

const definition: Api2ModDefinition = {
  api: ">=2.0.0 <3.0.0",

  /* Stored preferences keep the shape they had before the move to API 2. */
  prefs: { version: 1, migrate: (value) => value },

  /* The panel, Knight's Lessons and run bookkeeping, for every character with
   * Squire enabled, whether or not it has been handed over. */
  async start(mod) {
    running = begin(mod).catch((error: unknown) => {
      mod.meta.log(`Squire could not start: ${error instanceof Error ? error.message : String(error)}`);
      return null;
    });
    await running;
  },

  /* The game tears its mods down before it reloads, and the headless runner registers them again on the same page after a save and reload. The panel kind leaves the game's panel list here, or that second registration is refused. */
  stop() {
    const done = running;
    running = undefined;
    const held = bridge;
    bridge = undefined;
    void done?.then((r) => { r?.detach(); }).then(() => held?.dispose());
  },

  /* Offer to play only when this character was handed to an autoplayer before, was armed from Squire's title row, or is the roll-on heir the birth presenter marked. */
  armed(context) {
    return context.armed || characterAlreadyAutoplayed(context) || takeRollOn(sessionMarks(), Date.now(), HEIR_KEY);
  },

  /* Roll-on: accepts the one creation Squire asked for after a death, and
   * declines every other, so the game shows its own birth screens. */
  birth(mod) {
    return rollOnPresenter(bridgeFor(mod).host);
  },

  async controller(mod: ModApi2, input: Api2InputState) {
    const live = await running;
    if (live === undefined || live === null) return;
    await live.tick(mod, input);
  },
};

export default definition;
