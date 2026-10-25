/**
 * The in-game key for giving an order. The game's own keymap runs it, so it
 * works during play whether or not the Squire panel is mounted; the panel's
 * Ctrl+Shift+O listener stays for when the panel has the keyboard.
 */

import type { Runtime } from "../runtime.js";
import type { Api2DomPanel, Api2DomUi, Api2Manage, Api2Ui } from "@rpgm-tools/neo-angband-mod-sdk";
import { h, STYLE } from "./dom.js";
import { mountOrders } from "./orders.js";

export const ORDER_COMMAND = "squire:order";
export const ORDER_VERB = "give an order";
/** Single keys tried in turn; the keymap only hands out a key nobody holds. */
export const ORDER_KEYS: readonly string[] = ["O", "N"];
export const ORDER_PANEL_LABEL = "Give Squire an order";

/** The parts of the mod object this command reads. */
export interface OrderCommandCtx {
  readonly log?: (message: string) => void;
  readonly panels?: Pick<Api2DomUi, "openPanel">;
  readonly commands?: Api2Ui["commands"];
  readonly keys?: Pick<Api2Manage["keys"], "set">;
}

/** Register the command and bind a key to it. Returns the key bound, or null. */
export async function registerOrderCommand(ctx: OrderCommandCtx, rt: Runtime): Promise<string | null> {
  const { commands, panels } = ctx;
  if (commands === undefined || panels === undefined) return null;
  let shown: Api2DomPanel | null = null;

  function prompt(): void {
    if (shown?.open === true) return;
    const panel = panels!.openPanel({ id: "order", modal: true, label: ORDER_PANEL_LABEL });
    const body = h("div", { class: "body" });
    panel.root.append(h("style", {}, STYLE), h("div", { class: "squire" }, body));
    const cleanup = mountOrders(body, rt, "hotkey");
    shown = panel;
    void panel.closed.then(() => {
      cleanup();
      if (shown === panel) shown = null;
    });
  }

  /* Opening the prompt takes no game time. */
  const registered = await commands.register(ORDER_COMMAND, ORDER_VERB, () => {
    try {
      prompt();
    } catch (error) {
      ctx.log?.(`Squire couldn't open the order prompt: ${String(error)}`);
    }
  });
  if (!registered.ok) {
    ctx.log?.(`Squire's order command isn't registered: ${registered.message}`);
    return null;
  }
  const keys = ctx.keys;
  if (keys === undefined) {
    ctx.log?.("Squire's order key isn't bound, because this game doesn't let mods bind keys.");
    return null;
  }
  for (const key of ORDER_KEYS) {
    const bound = await keys.set(key, ORDER_COMMAND);
    if (bound.ok) {
      ctx.log?.(`Squire's order key is ${key}.`);
      return key;
    }
  }
  ctx.log?.("Squire's order key isn't bound, because every key it tried is taken.");
  return null;
}
