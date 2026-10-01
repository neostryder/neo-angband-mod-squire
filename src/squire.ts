/**
 * Default handovers keep playing. A player can choose a bounded errand by
 * switching off model play; the host still owns every keypress and death.
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
  if (cfg.useModel || cfg.errandCampaign) return campaign();
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
    if (mission?.id !== "campaign") log("the keyboard is yours again; press any key to take it back from Squire");
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
