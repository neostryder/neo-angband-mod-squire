/**
 * Squire itself: choose one errand, run it, and hand the keyboard back.
 *
 * ------------------------------------------------------------------
 * HOW HANDING BACK ACTUALLY WORKS
 * ------------------------------------------------------------------
 *
 * An AgentController returns a command, or null. Returning null is the seam's
 * own way of saying "I have nothing to say": the game loop reports that it needs
 * input and waits, exactly as it waits for a human. So the whole of this mod's
 * central claim comes down to one line - when the errand ends, this controller
 * returns null and never issues another command.
 *
 * From there the host finishes the job. Any real keypress while an autoplayer
 * holds the keyboard releases it, and the key that did the releasing is consumed
 * rather than passed on, so a player pressing something to get attention does not
 * also swing a weapon with it. That means a player NEVER has to fight this mod
 * for their own keyboard, and it means the release is not something this mod
 * could get wrong even if it tried: it is the game's, not this mod's.
 *
 * WHAT THIS COSTS TODAY, said plainly. One handover is one errand. There is no
 * seam a mod can use to bind a key to its own code in play, so asking for a
 * second errand means handing the keyboard over again. PLANNED.md carries what a
 * host-side fix would need and why it belongs in the game rather than here.
 *
 * ------------------------------------------------------------------
 * CHOOSING THE ERRAND
 * ------------------------------------------------------------------
 *
 * From the world, not from a menu, because the world already says what the
 * player meant. Hand over with something in sight and the errand is to deal with
 * it; hand over in an empty corridor and the errand is to walk the floor out.
 * Both rules can be switched off, and the long errand overrides both.
 */

import type { AgentController } from "@rpgm-tools/neo-angband-core";
import type { SquireContext } from "./context.js";
import type { Mission, Stop } from "./mission.js";
import { isStop } from "./mission.js";
import type { SquireCfg } from "./settings.js";
import type { Terrain } from "./terrain.js";
import { newProgress, type Progress } from "./progress.js";
import { pickTarget } from "./threat.js";
import { AUTOFIGHT_REACH, autofight } from "./missions/autofight.js";
import { autoexplore } from "./missions/autoexplore.js";
import { campaign } from "./missions/campaign.js";

/** What building a Squire needs. */
export interface SquireOptions {
  /** The player's settings, resolved from the manifest rules. */
  readonly cfg: SquireCfg;
  /** What the view's terrain indices mean. */
  readonly terrain: Terrain;
  /** The host's log sink. */
  readonly log: (message: string) => void;
}

/** A live Squire. */
export interface Squire {
  /** The controller to hand to the host. */
  readonly controller: AgentController;
  /** The errand chosen, or null before the first decision. */
  mission(): string | null;
  /** How the errand ended, or null while it is still running. */
  outcome(): Stop | null;
}

/**
 * Pick the errand from the world.
 *
 * Returns null when the player has switched off every errand that applies, which
 * is a legitimate configuration: a Squire with both short errands off and the
 * long one off is a Squire that has been told to do nothing, and it says so and
 * gives the keyboard straight back rather than picking something anyway.
 */
export function chooseMission(
  cfg: SquireCfg,
  at: { readonly x: number; readonly y: number },
  monsters: Parameters<typeof pickTarget>[0],
): Mission | null {
  if (cfg.errandCampaign) return campaign();
  const target = pickTarget(monsters, at, {
    wakeSleepers: cfg.wakeSleepers,
    reach: AUTOFIGHT_REACH,
  });
  if (target !== null && cfg.errandAutofight) return autofight();
  if (cfg.errandAutoexplore) return autoexplore();
  return null;
}

/** Build a Squire. One per handover: it holds the errand and its progress. */
export function createSquire(options: SquireOptions): Squire {
  const { cfg, terrain, log } = options;
  let mission: Mission | null = null;
  let progress: Progress | null = null;
  let finished: Stop | null = null;

  function finish(stop: Stop): null {
    finished = stop;
    log(`errand ended (${stop.reason}): ${stop.detail}`);
    log("the keyboard is yours again; press any key to take it back from Squire");
    return null;
  }

  const controller: AgentController = (view, act) => {
    /* Standby. The errand is over and this controller has nothing further to
     * say, for as long as it is installed. */
    if (finished !== null) return null;

    if (mission === null) {
      const chosen = chooseMission(cfg, view.player().grid, view.monsters());
      if (chosen === null) {
        return finish({
          reason: "nothing-to-do",
          detail: "Every errand is switched off in Squire's settings.",
        });
      }
      mission = chosen;
      progress = newProgress(view.player().depth);
      const ctx: SquireContext = { view, act, terrain, cfg, progress, log };
      const declined = mission.begin(ctx);
      if (declined !== null) return finish(declined);
      log(`errand: ${mission.label}`);
    }

    if (progress === null) {
      return finish({
        reason: "nothing-to-do",
        detail: "The errand had no progress to record against.",
      });
    }

    const ctx: SquireContext = { view, act, terrain, cfg, progress, log };
    const decision = mission.step(ctx);
    if (isStop(decision)) return finish(decision.stop);
    return decision.command;
  };

  return {
    controller,
    mission: () => mission?.id ?? null,
    outcome: () => finished,
  };
}
