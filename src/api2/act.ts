/**
 * The act verbs Squire's decisions are written in, built here instead of taken
 * from the game.
 *
 * The decision code asks for "walk this way", "quaff that handle", "aim at that
 * monster" and gets back a command. Under API 2 the game no longer hands out
 * those builders; a mod submits an intent under the current input token. This
 * file keeps the verbs and their arguments exactly as the game's own builders
 * shaped them, so the brain is unchanged, and turns the one command chosen at a
 * decision into the intents to submit. A target choice is not a command: it is
 * recorded as it is made and submitted ahead of the command, which is the order
 * the game applied it in before.
 */

import type { AgentActions, AgentCommand } from "@rpgm-tools/neo-angband-core";
import type { Api2Intent, JsonValue } from "@rpgm-tools/neo-angband-mod-sdk";

/** The rest count that means "rest as needed", from the game's own constants. */
const REST_COMPLETE = -2;

type Target = { readonly kind: "target"; readonly midx: number } | { readonly kind: "target"; readonly x: number; readonly y: number };

export interface ActFacade {
  readonly act: AgentActions;
  /** The target choices made since the last `take`, oldest first. */
  take(): readonly Target[];
}

export function createActFacade(): ActFacade {
  let targets: Target[] = [];
  const cmd = (code: string, args?: Record<string, unknown>): AgentCommand => (args ? { code, args } : { code }) as AgentCommand;
  const dirCmd = (code: string, dir: number): AgentCommand => ({ code, dir }) as AgentCommand;
  const itemCmd = (code: string, handle: number): AgentCommand => cmd(code, { handle });
  const act: AgentActions = {
    move: (dir) => dirCmd("walk", dir),
    melee: (dir) => dirCmd("walk", dir),
    hold: () => cmd("hold"),
    rest: (count) => cmd("rest", { count: count ?? REST_COMPLETE }),
    descend: () => cmd("descend"),
    ascend: () => cmd("ascend"),
    tunnel: (dir) => dirCmd("tunnel", dir),
    open: (dir) => dirCmd("open", dir),
    close: (dir) => dirCmd("close", dir),
    disarm: (dir) => dirCmd("disarm", dir),
    quaff: (handle) => itemCmd("quaff", handle),
    read: (handle) => itemCmd("read", handle),
    eat: (handle) => itemCmd("eat", handle),
    wear: (handle) => itemCmd("wield", handle),
    takeoff: (handle) => itemCmd("takeoff", handle),
    drop: (handle, number) => cmd("drop", number !== undefined ? { handle, quantity: number } : { handle }),
    pickup: () => cmd("pickup"),
    destroy: (handle) => itemCmd("destroy", handle),
    aimWand: (handle) => itemCmd("aim-wand", handle),
    zapRod: (handle) => itemCmd("zap-rod", handle),
    useStaff: (handle) => itemCmd("use-staff", handle),
    activate: (handle) => itemCmd("activate", handle),
    fire: (handle) => itemCmd("fire", handle),
    throw: (handle) => itemCmd("throw", handle),
    cast: (spell) => cmd("cast", { spell }),
    setTargetMonster: (midx) => { targets = [...targets, { kind: "target", midx }]; return true; },
    setTargetLocation: (x, y) => { targets = [...targets, { kind: "target", x, y }]; },
    shopBuy: (index, number) => cmd("shop-buy", number !== undefined ? { index, quantity: number } : { index }),
    shopSell: (handle, number) => cmd("shop-sell", number !== undefined ? { handle, quantity: number } : { handle }),
    shopExit: () => cmd("shop-exit"),
    raw: (code, args) => cmd(code, args),
  };
  return {
    act,
    take() {
      const taken = targets;
      targets = [];
      return taken;
    },
  };
}

/** The intent that submits one chosen command. */
export function intentOf(command: AgentCommand): Api2Intent {
  const { code, dir, args } = command as { readonly code: string; readonly dir?: number; readonly args?: Readonly<Record<string, unknown>> };
  return {
    kind: "command",
    command: {
      code,
      ...(dir !== undefined ? { dir } : {}),
      ...(args !== undefined ? { args: args as Readonly<Record<string, JsonValue>> } : {}),
    },
  };
}
