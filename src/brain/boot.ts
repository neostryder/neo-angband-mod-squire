/**
 * Choosing between the model and the errands when Squire takes the keyboard.
 *
 * Whether a key is available is an async question for `ctx.net.secrets`, and
 * the host wants a controller back at once. So Squire hands the host a boot
 * controller. It returns null while the key check runs (the game just waits),
 * then passes every later call to the brain when a model is reachable, or to the
 * procedural errands when none is.
 */

import type { AgentController, ModNetSecrets } from "@rpgm-tools/neo-angband-core";
import { JEV_KEY_VARIABLES, type Backend } from "./backend.js";

/** Secret methods used while Squire starts. */
export type SecretsLike = Pick<ModNetSecrets, "has" | "fromEnv">;

/** Whether `backend` can be asked: it needs no key, or its key is set or can be read from the environment. */
export async function keyReady(
  secrets: SecretsLike,
  backend: Backend,
  canReadEnv: boolean,
  log: (message: string) => void,
): Promise<boolean> {
  if (backend.secret === undefined) return true;
  const held = await secrets.has(backend.secret);
  if (held.present) return true;
  if (!canReadEnv) {
    log(`No API key is set for ${backend.label}, so Squire runs its errands without a model.`);
    return false;
  }
  const host = new URL(backend.url).host;
  const read = await secrets.fromEnv(backend.secret, JEV_KEY_VARIABLES, { hosts: [host] });
  if (read.ok) return true;
  log(`${read.problem} Squire runs its errands without a model.`);
  return false;
}

/**
 * A controller that waits for `ready`, then hands every call to the controller
 * it picked. A check that throws counts as no model.
 */
export function bootController(
  ready: Promise<boolean>,
  withModel: () => AgentController,
  withoutModel: () => AgentController,
): AgentController {
  let chosen: AgentController | null = null;
  let picked: boolean | null = null;
  ready.then(
    (ok) => {
      picked = ok;
    },
    () => {
      picked = false;
    },
  );
  return (view, act) => {
    if (chosen === null) {
      if (picked === null) return null;
      chosen = picked ? withModel() : withoutModel();
    }
    return chosen(view, act);
  };
}
