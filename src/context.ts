/**
 * What every errand is handed on each decision.
 *
 * The view and the act facade are the frozen agent API and nothing here wraps
 * them: an errand reads the same world any other agent reads and issues the same
 * commands a player could issue. The other three fields are the things the view
 * cannot answer - what a terrain index means, what the player asked for, and how
 * far this errand has already got.
 */

import type { AgentActions, AgentView } from "@rpgm-tools/neo-angband-core";
import type { SquireCfg } from "./settings.js";
import type { Terrain } from "./terrain.js";
import type { Progress } from "./progress.js";

/** One decision's worth of context. */
export interface SquireContext {
  /** The frozen read facade. */
  readonly view: AgentView;
  /** The frozen act facade. */
  readonly act: AgentActions;
  /** What the feature indices in the view's cells mean. */
  readonly terrain: Terrain;
  /** The player's settings, fixed for the life of this errand. */
  readonly cfg: SquireCfg;
  /** How far this errand has got, and what it has already done. */
  readonly progress: Progress;
  /** The host's log sink. */
  readonly log: (message: string) => void;
}
