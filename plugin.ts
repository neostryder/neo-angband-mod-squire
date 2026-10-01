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
 * Its whole job is to satisfy the plugin ABI: decide whether to offer to play at
 * all, read the terrain classification out of the bound registries, fold the
 * player's rule toggles into settings, and return a controller. Everything that
 * decides anything lives under src/.
 *
 * ------------------------------------------------------------------
 * WHY THIS DECLARES NO HOOKS AND REGISTERS NOTHING
 * ------------------------------------------------------------------
 *
 * Squire changes no rule, adds no record, and overrides no system. A plugin
 * whose only member is `controller` is a complete plugin, because playing the
 * game is not nothing.
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

import type * as Core from "@rpgm-tools/neo-angband-core";
import type { AgentController, ModPluginContext } from "@rpgm-tools/neo-angband-core";
import { createSquire } from "./src/squire.js";
import { runtime, type SquireHost } from "./src/runtime.js";
import { attachSquire, type AttachHost } from "./src/attach.js";
import { registerOrderCommand, type OrderCommandCtx } from "./src/ui/order-command.js";
import { registerSquireTitle, type TitleCtx } from "./src/title.js";
import { HEIR_KEY, rollOnPresenter, sessionMarks, takeRollOn, type BirthHost } from "./src/birth.js";
import { cfgFromFlags, changedFrom } from "./src/settings.js";
import { noTerrain, readTerrain, type Terrain } from "./src/terrain.js";

type ControllerCtx = Pick<ModPluginContext, "flags" | "settings" | "core" | "log" | "registries"> & SquireHost & {
  readonly log: (msg: string) => void;
  /**
   * The bound content registries (host `ctx.registries`).
   *
   * Required rather than optional. The host's own type declares it optional
   * because the same type also serves `hooks(ctx)`, which runs before a game
   * exists; at the one call site that invokes `controller()` the bound
   * registries are already latched.
   *
   * `Core.CoreRegistries` rather than a hand-written shape, so a change to the
   * feature registry this mod reads fails this repository's build instead of
   * surfacing as an errand that never finds a staircase.
   */
  readonly registries: Core.CoreRegistries;
  readonly state?: { readonly actor: { readonly player: Pick<Core.Player, "noscore"> } };
};

/**
 * NOSCORE_BORG (player.h). Mirrors core's NOSCORE.BORG; kept local so the mod
 * does not need a core import for one bit.
 *
 * The bit is not about any particular autoplayer. It records that this character
 * was handed to one at some point, which is what the score gate reads at death,
 * and Squire earns it on exactly the same terms as any other.
 */
const NOSCORE_BORG = 0x0020;

/**
 * Whether this character has already handed the keyboard to an autoplayer.
 *
 * Enabling a mod and giving away the keyboard are different decisions. The host
 * owns the second one: Ctrl-Z warns, confirms, marks the save and reloads. This
 * plugin returns a controller only once that permanent mark is set, so
 * installing Squire does nothing at all to a character until the player asks it
 * to, and a character that has run an autoplayer before is offered it again
 * through the host's own confirmation rather than silently.
 */
function characterAlreadyAutoplayed(ctx: ControllerCtx): boolean {
  const noscore = ctx.state?.actor?.player?.noscore ?? 0;
  return (noscore & NOSCORE_BORG) !== 0;
}

/**
 * Classify the bound terrain, or say why it could not be.
 *
 * The flag INDICES come from the engine namespace and the FEATURES come from the
 * bound registry, so core's terrain and a mod's are classified by one lookup on
 * the same terms - a mod's own staircase is a staircase here because it carries
 * the flag, not because this file has heard of it.
 *
 * A missing registry degrades to a Squire that walks the floor without ever
 * taking a staircase or opening a door. That is visibly diminished rather than
 * wrong, and it is logged, because "Squire never finds the stairs" and "this
 * floor has no stairs the character has seen" look identical from a chair.
 */
function terrainFrom(ctx: ControllerCtx): Terrain {
  const features = ctx.registries?.features;
  const tf = ctx.core?.TF;
  if (features === undefined || tf === undefined) return noTerrain();
  return readTerrain(features.allFeatures(), tf);
}

/** The host's richer controller return. */
interface ControllerInstall {
  readonly controller: AgentController;
  /** Keep the ordinary death, with its tombstone and run report, instead of reincarnating in place. */
  readonly onDeath: "end";
}

export default {
  api: 1,

  /* The panel, Knight's Lessons and run bookkeeping, for every character with
   * Squire enabled, whether or not it has been handed over. */
  register(host: unknown, ctx: ControllerCtx & AttachHost & OrderCommandCtx & TitleCtx): void {
    const rt = runtime(ctx);
    attachSquire(ctx, rt);
    /* The in-game order key needs registry:command and keymap:write; without them the panel's own key still works. */
    registerOrderCommand(host, ctx, rt);
    /* The title row needs ui:title and profiles:manage; without both there is no row. */
    registerSquireTitle(ctx, rt.store());
  },

  /* Roll-on: accepts the one creation Squire asked for after a death, and
   * declines every other, so the game shows its own birth screens. */
  birth(ctx: BirthHost) {
    return rollOnPresenter(ctx);
  },

  controller(ctx: ControllerCtx): AgentController | ControllerInstall | undefined {
    /* Returning undefined is a decline, and the host leaves the human at the
     * keyboard. This is the normal case: the mod is installed and enabled, and
     * this character has never been handed to an autoplayer. */
    /* A roll-on heir is not marked yet: the birth presenter left a one-time
     * mark saying Squire asked for this character. A character started from
     * Squire's title row arrives with the controller armed. */
    if (!characterAlreadyAutoplayed(ctx) && ctx.controllerArmed !== true && !takeRollOn(sessionMarks(), Date.now(), HEIR_KEY)) return undefined;

    const cfg = cfgFromFlags(ctx.flags, ctx.settings);
    const terrain = terrainFrom(ctx);

    ctx.log(
      terrain.size > 0
        ? `Squire is reading ${String(terrain.size)} terrain features`
        : "Squire has no terrain registry: it will not take stairs or open doors",
    );
    const changed = changedFrom(cfg);
    ctx.log(
      changed.length === 0
        ? "Squire is on its stock settings"
        : `Squire's settings differ from stock: ${changed.join(", ")}`,
    );

    const errands = () => createSquire({ cfg, terrain, log: ctx.log, status: (reason) => ctx.controller?.setStatus({ label: "Errand ended", reason }) }).controller;
    /* An older game has no ctx.net and expects a bare controller back. */
    return { controller: runtime(ctx).controllerFor(cfg, terrain, errands), onDeath: "end" };
  },
};
